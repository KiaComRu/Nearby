'use strict';
const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
let authToken = fragment.get('admin') || sessionStorage.getItem('nearby-token') || '';
const adminLink = fragment.has('admin');
const suggestedPin = fragment.get('pin');
history.replaceState(null, '', location.pathname);
if (fragment.has('admin')) sessionStorage.setItem('nearby-token', authToken);
let state;
let rendered = '';
let qrUrl = '';
let addressSignature;
let sending = false;
let peerMode = false;
let joinMode = false;
let refreshing;
let discoverySignature = '', discoveryRefreshing = false, diagnoseGeneration = 0;
const selectedDiscoveryAddresses = new Map();
let trustState = { enabled: false, devices: [], requests: [] }, discoveredDevices = [], trustSignature = '', trustRefreshing = false;
const peerRoute = url => peerMode && (url === '/api/state' || url === '/api/offers' || /^\/api\/(?:offers|shares)\//.test(url)) ? '/api/peer/remote' + url : url;

function message(text) {
  $('message').textContent = text;
  $('message').hidden = !text;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sizes = bytes => {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
};
const statusNames = {
  pending: 'Ожидает подтверждения', accepted: 'Приём подтверждён',
  uploading: 'Получение', completed: 'Получено и сохранено',
  rejected: 'Получатель отклонил файл', expired: 'Время ожидания истекло', failed: 'Передача прервана',
};

async function api(url, { method = 'GET', data, anonymous = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(peerRoute(url), {
      method, signal: controller.signal,
      headers: { ...(anonymous ? {} : { Authorization: `Bearer ${authToken}` }),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status, code: body.code });
    return body;
  } finally { clearTimeout(timeout); }
}

function row(name, meta) {
  const element = document.createElement('div');
  element.className = 'file-row';
  const icon = document.createElement('div'); icon.className = 'file-icon'; icon.textContent = '↗';
  const info = document.createElement('div'); info.className = 'file-info';
  const title = document.createElement('div'); title.className = 'file-name'; title.textContent = name;
  const detail = document.createElement('div'); detail.className = 'file-meta'; detail.textContent = meta;
  info.append(title, detail); element.append(icon, info);
  return { element, info, detail };
}

function button(label, action, secondary = false) {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = label;
  if (secondary) element.className = 'secondary';
  element.addEventListener('click', async () => {
    element.disabled = true;
    try { await action(); }
    catch (error) { message(error.message || 'Соединение прервано.'); }
    finally { element.disabled = false; }
  });
  return element;
}

function empty(parent, text) {
  const element = document.createElement('div'); element.className = 'empty'; element.textContent = text;
  parent.append(element);
}

async function updateQR() {
  const url = $('address').value;
  $('share-address').value = url ? `${url}/#pin=${state.pin}` : '';
  $('qr').hidden = !url;
  if (!url) { $('qr').removeAttribute('src'); qrUrl = ''; return; }
  if (!url || url === qrUrl) return;
  const response = await fetch(`/api/qr?ip=${encodeURIComponent(new URL(url).hostname)}`,
    { headers: { Authorization: `Bearer ${authToken}` } });
  if (!response.ok) throw new Error('Не удалось создать QR-код. Используйте адрес и PIN.');
  const svg = await response.text();
  $('qr').src = `data:image/svg+xml;base64,${btoa(svg)}`;
  qrUrl = url;
}

function render() {
  $('join').hidden = true; $('workspace').hidden = false;
  $('connection').hidden = !state.admin || joinMode;
  $('received-location').hidden = !(state.admin || state.localAdmin) || !state.receivedDirectory;
  $('pc-connect').hidden = !(state.admin || state.localAdmin) || (!peerMode && !joinMode);
  $('pc-mode-switch').hidden = !state.admin || peerMode;
  $('pc-show-invite').setAttribute('aria-pressed', String(!joinMode));
  $('pc-show-connect').setAttribute('aria-pressed', String(joinMode));
  $('pc-connect-form').hidden = peerMode;
  $('pc-connect-hint').hidden = peerMode;
  $('pc-connected').hidden = !peerMode;
  $('discovery').hidden = !state.admin || peerMode;
  $('pc-diagnose').hidden = peerMode;
  $('secure-pair').hidden = peerMode || !trustState.enabled;
  $('legacy-hint').hidden = peerMode;
  $('trusted-panel').hidden = !(state.admin || state.localAdmin) || !trustState.enabled;
  $('pc-transport').textContent = state.peer?.secure ? 'Защищённое соединение · TLS 1.3 · ключ устройства проверен' : 'Подключение по PIN · HTTP · доверенная локальная сеть';
  $('pc-peer-address').textContent = state.peer?.origin || '';
  if (state.admin || state.localAdmin) $('received-path').textContent = state.receivedDirectory || '';
  if (state.admin) {
    $('shown-pin').textContent = state.pin;
    $('send-title').textContent = 'Отдать файлы';
    $('send-description').textContent = 'Добавьте файлы. Подключённые устройства смогут их скачать.';
    $('receive-title').textContent = 'Входящие запросы';
    $('receive-description').textContent = 'Подтвердите файлы, которые хотите получить.';
    $('save-hint').textContent = 'Полученные файлы можно найти кнопкой «Открыть папку» в разделе «Входящие запросы».';
    $('received-path').textContent = state.receivedDirectory || '';
    const urlsSignature = JSON.stringify(state.urls);
    if (addressSignature !== urlsSignature) {
      addressSignature = urlsSignature;
      const previousAddress = $('address').value;
      $('address').replaceChildren();
      for (const url of state.urls) {
        const option = document.createElement('option'); option.value = url; option.textContent = url;
        $('address').append(option);
      }
      if (state.urls.includes(previousAddress)) $('address').value = previousAddress;
      if (!state.urls.length) message('Сетевая карта не найдена. Подключите компьютер к Wi-Fi или Ethernet и перезапустите приложение.');
      updateQR().catch(error => message(error.message));
    }
  } else {
    $('send-title').textContent = peerMode ? 'Отправить на другой ПК' : 'Отправить на компьютер';
    $('send-description').textContent = 'Выберите файлы. Получатель подтвердит приём на своём компьютере.';
    $('receive-title').textContent = 'Файлы для вас';
    $('receive-description').textContent = 'Скачайте файлы, которыми поделился другой компьютер.';
    $('save-hint').textContent = peerMode ? 'При отправке получатель нажимает «Принять» на другом ПК. При скачивании выберите, куда сохранить файл на этом ПК.' : 'Оставьте страницу открытой до завершения. Получатель увидит имя и размер каждого файла.';
  }
  const signature = JSON.stringify([state.offers, state.shares]);
  if (rendered === signature) return;
  rendered = signature;
  $('incoming').replaceChildren(); $('shared').replaceChildren(); $('history').replaceChildren();
  const pending = state.admin ? state.offers.filter(x => x.state === 'pending') : [];
  for (const offer of pending) {
    const item = row(offer.name, `${sizes(offer.size)} · ${offer.device} · ${offer.secure ? 'TLS · доверенное устройство' : 'HTTP · PIN'}`);
    const actions = document.createElement('div'); actions.className = 'actions';
    for (const [label, action] of [['Принять', 'accept'], ['Нет', 'reject']]) {
      actions.append(button(label, async () => {
        await api(`/api/offers/${offer.id}`, { method: 'POST', data: { action } });
        await refresh();
      }, action === 'reject'));
    }
    item.element.append(actions); $('incoming').append(item.element);
  }
  if (state.admin && !pending.length) empty($('incoming'), 'Пока нет запросов. Отправьте файл со второго устройства.');
  if (!state.admin && !state.shares.length) empty($('shared'), 'Здесь появятся файлы, которыми поделится компьютер.');
  for (const share of state.shares) {
    const item = row(share.name, `${sizes(share.size)} · ${state.admin ? (share.recipientName ? `Только для «${share.recipientName}»` : 'Доступен подключённым устройствам') : 'Готов к скачиванию'}`);
    item.element.append(button('Скачать', async () => {
      const ticket = await api(`/api/shares/${share.id}/ticket`, { method: 'POST' });
      const link = document.createElement('a'); link.href = ticket.url; link.download = share.name;
      document.body.append(link); link.click(); link.remove();
      message('Скачивание передано браузеру. Прогресс и сохранение файла доступны в его списке загрузок.');
    }));
    if (state.admin) item.element.append(button('Убрать', async () => {
      await api(`/api/shares/${share.id}`, { method: 'DELETE' }); await refresh();
    }, true));
    $('shared').append(item.element);
  }
  if (!state.offers.length) empty($('history'), 'Пока тихо. Начните первую передачу.');
  for (const offer of [...state.offers].reverse()) {
    const item = row(offer.name, `${sizes(offer.size)} · ${statusNames[offer.state] || offer.state}${offer.error ? ` · ${offer.error}` : ''}`);
    if (offer.state === 'uploading') {
      const progress = document.createElement('progress'); progress.max = offer.size || 1; progress.value = offer.received;
      progress.setAttribute('aria-label', `Получение ${offer.name}`); item.info.append(progress);
    }
    $('history').append(item.element);
  }
}

async function refresh() {
  if (refreshing) return refreshing;
  const mode = peerMode;
  refreshing = api('/api/state').then(async result => {
    if (mode !== peerMode) return;
    if (result.admin && result.peerConnection && !peerMode) { peerMode = true; rendered = ''; result = await api('/api/state'); }
    state = result; render();
  }).finally(() => { refreshing = null; });
  return refreshing;
}

async function poll() {
  if (authToken) {
    try { await refresh(); if (state?.admin || state?.localAdmin) await refreshTrust(); if (state?.admin && !peerMode) await refreshDiscovery(); }
    catch (error) {
      if (error.status === 401) {
        authToken = ''; sessionStorage.removeItem('nearby-token');
        $('workspace').hidden = true; $('join').hidden = false;
        message(adminLink ? 'Откройте новую ссылку владельца из консоли приложения.' : 'Сеанс истёк или компьютер перезапущен. Введите новый PIN.');
      } else message(error.message || 'Нет связи с компьютером. Проверьте Wi-Fi.');
    }
  }
  setTimeout(poll, 1500);
}

async function refreshDiscovery() {
  if (discoveryRefreshing || peerMode || !state?.admin) return;
  discoveryRefreshing = true;
  try {
    const result = await api('/api/discovery');
    if (peerMode || !state?.admin) return;
    discoveredDevices = result.devices; renderTrust();
    const statuses = {
      starting: 'Запускаем поиск устройств…',
      listening: result.devices.length ? 'Выберите компьютер и введите PIN из его окна Nearby.' : 'Пока ничего не найдено. Откройте Nearby на втором ПК или подключитесь по адресу.',
      'no-network': 'Нет доступной локальной IPv4-сети. Подключите ПК к Wi-Fi или Ethernet; поиск обновится автоматически.',
      unavailable: result.errorCode === 'EADDRINUSE' ? 'Порт поиска занят. Подключитесь по адресу; поиск повторится автоматически.' : 'Поиск устройств недоступен. Проверьте сеть и разрешение Nearby в брандмауэре. Можно подключиться по адресу.',
      disabled: 'Автопоиск отключён в этом запуске. Подключитесь по адресу.',
    };
    $('discovery-state').textContent = statuses[result.status] || 'Не удалось получить состояние поиска.';
    $('discovery-name').textContent = result.name ? `Этот ПК виден в сети как «${result.name}». PIN и имена файлов в поиске не передаются.` : '';
    const signature = JSON.stringify(result.devices);
    if (signature === discoverySignature) return;
    discoverySignature = signature; $('nearby-devices').replaceChildren();
    const aliveIds = new Set(result.devices.map(device => device.id));
    for (const id of selectedDiscoveryAddresses.keys()) if (!aliveIds.has(id)) selectedDiscoveryAddresses.delete(id);
    for (const device of result.devices) {
      const item = row(device.name, `Nearby ${device.version}`);
      item.element.dataset.deviceId = device.id;
      const addresses = document.createElement('select'); addresses.className = 'discovery-address';
      addresses.setAttribute('aria-label', `Адрес устройства ${device.name}`);
      const score = origin => new URL(origin).hostname.startsWith('192.168.') ? 0 : new URL(origin).hostname.startsWith('10.') ? 1 : 2;
      for (const origin of [...device.origins].sort((a, b) => score(a) - score(b) || a.localeCompare(b))) {
        const option = document.createElement('option'); option.value = origin; option.textContent = origin; addresses.append(option);
      }
      if (device.origins.includes(selectedDiscoveryAddresses.get(device.id))) addresses.value = selectedDiscoveryAddresses.get(device.id);
      addresses.addEventListener('change', () => selectedDiscoveryAddresses.set(device.id, addresses.value));
      item.info.append(addresses);
      const known = device.secure && trustState.devices.some(item => item.fingerprint === device.secure.fingerprint);
      item.element.append(button(device.secure && trustState.enabled ? known ? 'Подключиться защищённо' : 'Сопрячь устройства' : 'Выбрать ПК', async () => {
        if (sending || state?.offers.some(offer => offer.state === 'uploading')) { message('Дождитесь завершения текущей передачи.'); return; }
        const origin = addresses.value;
        if (device.secure && trustState.enabled) {
          if (known) await connectTrusted(device.secure.fingerprint, origin); else await beginPair(origin);
          return;
        }
        const changed = $('pc-address').value !== origin;
        $('pc-address').value = origin; if (changed) $('pc-pin').value = '';
        joinMode = true; render(); $('pc-connect').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        $('pc-pin').focus(); await diagnoseAddress();
      }, true));
      $('nearby-devices').append(item.element);
    }
  } catch { $('discovery-state').textContent = 'Не удалось обновить список. Подключитесь по адресу или повторите поиск.'; }
  finally { discoveryRefreshing = false; }
}
async function refreshTrust() {
  if (trustRefreshing || !(state?.admin || state?.localAdmin)) return;
  trustRefreshing = true;
  try { trustState = await api('/api/trust'); renderTrust(); render(); }
  catch { /* A transient trust-list error cannot downgrade a TLS connection. */ }
  finally { trustRefreshing = false; }
}
function renderTrust() {
  $('trusted-panel').hidden = !(state?.admin || state?.localAdmin) || !trustState.enabled;
  if (!trustState.enabled) return;
  const signature = JSON.stringify([trustState, discoveredDevices]);
  if (signature === trustSignature) return;
  trustSignature = signature; discoverySignature = '';
  $('trusted-identity').textContent = `Это устройство: ${trustState.identity.name}. Имя и ключ сохраняются между запусками.`;
  $('pairing-requests').replaceChildren(); $('trusted-devices').replaceChildren();
  for (const request of trustState.requests) {
    const card = document.createElement('article'); card.className = 'pairing-card'; card.dataset.pairingId = request.id;
    const title = document.createElement('strong'); title.textContent = `Сопряжение с «${request.name}»`;
    const instruction = document.createElement('p'); instruction.textContent = 'Сверьте все 8 групп этой строки на обоих ПК. Подтверждайте только при полном совпадении.';
    const code = document.createElement('code'); code.className = 'pairing-code'; code.textContent = request.code;
    const detail = document.createElement('p'); detail.className = 'pairing-state';
    detail.textContent = request.rejected ? 'Сопряжение отклонено. Создайте новый запрос.' : request.localConfirmed ? 'Вы подтвердили. Ожидаем подтверждения второго ПК…' : request.remoteConfirmed ? 'Другой ПК подтвердил. Проверьте строку и подтвердите здесь.' : 'Ожидаем проверки на обоих ПК.';
    if (request.error) detail.textContent += ' ' + request.error;
    const actions = document.createElement('div'); actions.className = 'actions';
    if (!request.localConfirmed && !request.rejected) actions.append(button('Строки совпадают — подтвердить', async () => { await api('/api/trust/confirm', { method: 'POST', data: { id: request.id } }); await refreshTrust(); }));
    if (!request.rejected) actions.append(button('Отклонить сопряжение', async () => { await api('/api/trust/reject', { method: 'POST', data: { id: request.id } }); await refreshTrust(); }, true));
    card.append(title, instruction, code, detail, actions); $('pairing-requests').append(card);
  }
  if (!trustState.devices.length) empty($('trusted-devices'), 'Пока нет сохранённых устройств. Выберите ПК в «Устройства рядом» и нажмите «Сопрячь устройства».');
  for (const device of trustState.devices) {
    const found = discoveredDevices.find(item => item.secure?.fingerprint === device.fingerprint);
    const item = row(device.name, `Ключ ${device.fingerprint.slice(0, 16)}… · ${found ? 'Найден в сети' : 'Адрес последнего подключения'}`);
    item.element.dataset.fingerprint = device.fingerprint;
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(button('Подключиться защищённо', () => connectTrusted(device.fingerprint, found ? preferredAddress(found.origins) : device.address)),
      button('Переименовать', () => {
        if (item.info.querySelector('.rename-device')) return;
        const editor = document.createElement('div'); editor.className = 'rename-device';
        const input = document.createElement('input'); input.value = device.name; input.maxLength = 60; input.setAttribute('aria-label', 'Новое имя устройства');
        editor.append(input, button('Сохранить имя', async () => { await api('/api/trust/rename', { method: 'POST', data: { fingerprint: device.fingerprint, name: input.value } }); await refreshTrust(); }));
        item.info.append(editor); input.focus();
      }, true),
      button('Забыть устройство', async () => {
        await api('/api/trust/revoke', { method: 'POST', data: { fingerprint: device.fingerprint } });
        if (state.peer?.fingerprint === device.fingerprint) { peerMode = false; joinMode = false; rendered = ''; await refresh(); }
        message('Доверие отозвано. Для нового подключения потребуется сопряжение на обоих ПК.'); await refreshTrust();
      }, true));
    item.element.append(actions); $('trusted-devices').append(item.element);
  }
}
function preferredAddress(origins) { return origins.find(value => new URL(value).hostname.startsWith('192.168.')) || origins.find(value => new URL(value).hostname.startsWith('10.')) || origins[0]; }
async function beginPair(address) {
  if (sending || peerMode) { message('Завершите текущую передачу и подключение перед сопряжением.'); return; }
  await api('/api/trust/pair', { method: 'POST', data: { address } });
  message('Запрос создан. Сверьте строку проверки на экранах обоих ПК.'); await refreshTrust();
  $('trusted-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
async function connectTrusted(fingerprint, address) {
  if (sending || peerMode) { message('Сначала завершите текущее подключение.'); return; }
  if (refreshing) await refreshing.catch(() => {});
  const result = await api('/api/peer/connect', { method: 'POST', data: { fingerprint, address } });
  peerMode = true; state = result; rendered = ''; $('queue').replaceChildren();
  message('Устройства соединены с проверкой ключей и шифрованием.'); render();
}
$('secure-pair').addEventListener('click', async () => {
  $('secure-pair').disabled = true;
  try { await beginPair($('pc-address').value.trim()); } catch (error) { message(error.message || 'Сопряжение не удалось. Проверьте адрес и версию Nearby.'); }
  finally { $('secure-pair').disabled = false; }
});
async function diagnoseAddress() {
  const address = $('pc-address').value.trim(), generation = ++diagnoseGeneration;
  $('pc-diagnostic-state').hidden = false;
  if (!address) { $('pc-diagnostic-state').textContent = 'Выберите найденный ПК или вставьте его адрес.'; return; }
  $('pc-diagnostic-state').textContent = 'Проверяем доступность Nearby по этому адресу…'; $('pc-diagnose').disabled = true;
  try {
    const result = await api('/api/peer/diagnose', { method: 'POST', data: { address } });
    if (generation !== diagnoseGeneration) return;
    $('pc-diagnostic-state').textContent = result.message + (result.ok && result.version ? ` Версия ${result.version}.` : '');
    $('pc-diagnostic-state').dataset.code = result.code;
  } catch (error) { if (generation === diagnoseGeneration) $('pc-diagnostic-state').textContent = error.message || 'Проверка не завершена. Повторите её.'; }
  finally { $('pc-diagnose').disabled = false; }
}
$('pc-diagnose').addEventListener('click', diagnoseAddress);
$('discovery-refresh').addEventListener('click', async () => {
  $('discovery-refresh').disabled = true;
  try { await api('/api/discovery/refresh', { method: 'POST', data: {} }); await refreshDiscovery(); }
  catch (error) { message(error.message || 'Не удалось обновить поиск.'); }
  finally { $('discovery-refresh').disabled = false; }
});

function upload(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', peerRoute(url));
    xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = event => onProgress(event.loaded);
    xhr.onerror = () => reject(new Error('Передача прервана. Проверьте Wi-Fi и отправьте файл заново.'));
    xhr.onabort = () => reject(new Error('Передача отменена.'));
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('Компьютер вернул некорректный ответ.')); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Не удалось отправить файл.'));
    };
    xhr.send(file);
  });
}

async function sendFiles(files) {
  if (!state || sending || !files.length) return;
  sending = true; $('files').disabled = true; $('drop').classList.add('disabled');
  try {
    for (const file of files) {
      const item = row(file.name, `${sizes(file.size)} · Подготовка`);
      const progress = document.createElement('progress'); progress.max = file.size || 1; progress.value = 0;
      progress.setAttribute('aria-label', `Отправка ${file.name}`); item.info.append(progress); $('queue').append(item.element);
      try {
        if (file.size > state.maxSize) throw new Error(`Максимальный размер файла: ${sizes(state.maxSize)}.`);
        let url;
        if (state.admin) {
          url = `/api/shares?name=${encodeURIComponent(file.name)}&size=${file.size}`;
        } else {
          const offer = await api('/api/offers', { method: 'POST', data: { name: file.name, size: file.size } });
          item.detail.textContent = `${sizes(file.size)} · Ожидаем подтверждения на компьютере`;
          const deadline = Date.now() + 5 * 60_000;
          let accepted = false;
          while (Date.now() < deadline) {
            const current = await api('/api/state');
            const status = current.offers.find(x => x.id === offer.id)?.state;
            if (status === 'accepted') { accepted = true; break; }
            if (status !== 'pending') throw new Error(statusNames[status] || 'Запрос больше не доступен.');
            await pause(1500);
          }
          if (!accepted) throw new Error('Время ожидания истекло. Отправьте файл заново.');
          url = `/api/offers/${offer.id}/upload`;
        }
        const start = Date.now();
        let lastUpdate = 0;
        await upload(url, file, bytes => {
          if (Date.now() - lastUpdate < 200 && bytes < file.size) return;
          lastUpdate = Date.now(); progress.value = bytes;
          const rate = bytes / Math.max((Date.now() - start) / 1000, .1);
          item.detail.textContent = bytes >= file.size ? 'Проверяем сохранение на компьютере…' : `${sizes(bytes)} / ${sizes(file.size)} · ${sizes(rate)}/с`;
        });
        progress.value = progress.max;
        item.detail.textContent = state.admin ? 'Готов к скачиванию на втором устройстве' : 'Получено и сохранено на компьютере';
        await refresh();
      } catch (error) {
        item.detail.textContent = error.message || 'Соединение прервано.';
        progress.remove();
      }
    }
  } finally {
    sending = false; $('files').disabled = false; $('drop').classList.remove('disabled'); $('files').value = '';
  }
}

$('join-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = event.currentTarget.querySelector('button'); submit.disabled = true;
  try {
    const result = await api('/api/join', { method: 'POST', anonymous: true, data: { pin: $('pin').value, device: $('device').value } });
    authToken = result.token; sessionStorage.setItem('nearby-token', authToken); message(''); rendered = ''; await refresh();
  } catch (error) { message(error.message || 'Не удалось подключиться. Проверьте Wi-Fi.'); }
  finally { submit.disabled = false; }
});

function invitationPin() {
  try { const pin = new URLSearchParams(new URL($('pc-address').value.trim()).hash.slice(1)).get('pin'); if (/^[0-9]{6}$/.test(pin || '')) $('pc-pin').value = pin; } catch {}
}
$('pc-address').addEventListener('input', () => { invitationPin(); diagnoseGeneration++; $('pc-diagnostic-state').hidden = true; });
$('pc-connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || state?.offers.some(offer => offer.state === 'uploading')) { message('Дождитесь завершения текущей передачи.'); return; }
  const submit = $('pc-connect-submit'); submit.disabled = true;
  try {
    if (refreshing) await refreshing.catch(() => {});
    const result = await api('/api/peer/connect', { method: 'POST', data: { address: $('pc-address').value.trim(), pin: $('pc-pin').value, device: $('pc-device').value.trim() } });
    peerMode = true; state = result; rendered = ''; $('queue').replaceChildren(); message('ПК соединены. Можно передавать файлы в обе стороны.'); render();
  } catch (error) { message(error.message || 'Не удалось подключиться к другому ПК.'); }
  finally { submit.disabled = false; }
});
$('pc-disconnect').addEventListener('click', async () => {
  if (sending) { message('Дождитесь завершения отправки.'); return; }
  $('pc-disconnect').disabled = true;
  try {
    if (refreshing) await refreshing.catch(() => {});
    await api('/api/peer/disconnect', { method: 'POST', data: {} });
    peerMode = false; joinMode = false; rendered = ''; $('queue').replaceChildren(); message('Подключение к другому ПК завершено.'); await refresh();
  } catch (error) { message(error.message); }
  finally { $('pc-disconnect').disabled = false; }
});
$('copy-address').addEventListener('click', async () => {
  if (!$('share-address').value) return;
  try { await navigator.clipboard.writeText($('share-address').value); message('Ссылка с PIN скопирована. Вставьте её в Nearby на другом ПК.'); }
  catch { $('share-address').focus(); $('share-address').select(); message('Ссылка выделена. Нажмите Ctrl+C, чтобы скопировать.'); }
});
$('pc-show-invite').addEventListener('click', () => { joinMode = false; render(); });
$('pc-show-connect').addEventListener('click', () => { joinMode = true; render(); $('pc-address').focus(); });
$('files').addEventListener('change', event => sendFiles(Array.from(event.target.files)));
$('address').addEventListener('change', () => updateQR().catch(error => message(error.message)));
$('open-received').addEventListener('click', async () => {
  $('open-received').disabled = true;
  try {
    await api('/api/received/open', { method: 'POST' });
    message('Папка с полученными файлами открыта на компьютере.');
  } catch (error) { message(error.message || 'Не удалось открыть папку. Скопируйте показанный путь в Проводник.'); }
  finally { $('open-received').disabled = false; }
});
for (const type of ['dragover', 'dragleave', 'drop']) {
  $('drop').addEventListener(type, event => {
    event.preventDefault(); $('drop').classList.toggle('drag', type === 'dragover');
    if (type === 'drop') sendFiles(Array.from(event.dataTransfer.files));
  });
}
// Dropping outside the file area must not navigate away during an active transfer.
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
window.addEventListener('beforeunload', event => { if (sending) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('hashchange', () => {
  if (/^#(?:admin|pin)=/u.test(location.hash)) location.reload();
});
if (suggestedPin && /^[0-9]{6}$/u.test(suggestedPin)) $('pin').value = suggestedPin;
$('join').hidden = Boolean(authToken);
poll();
