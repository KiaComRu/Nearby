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
let sending = false;

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
    const response = await fetch(url, {
      method, signal: controller.signal,
      headers: { ...(anonymous ? {} : { Authorization: `Bearer ${authToken}` }),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status });
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
  $('connection').hidden = !state.admin;
  $('received-location').hidden = !state.admin || !state.receivedDirectory;
  if (state.admin) {
    $('shown-pin').textContent = state.pin;
    $('send-title').textContent = 'Отдать файлы';
    $('send-description').textContent = 'Добавьте файлы. Подключённые устройства смогут их скачать.';
    $('receive-title').textContent = 'Входящие запросы';
    $('receive-description').textContent = 'Подтвердите файлы, которые хотите получить.';
    $('save-hint').textContent = 'Полученные файлы можно найти кнопкой «Открыть папку» в разделе «Входящие запросы».';
    $('received-path').textContent = state.receivedDirectory || '';
    if (!$('address').options.length) {
      for (const url of state.urls) {
        const option = document.createElement('option'); option.value = url; option.textContent = url;
        $('address').append(option);
      }
      if (!state.urls.length) message('Сетевая карта не найдена. Подключите компьютер к Wi-Fi или Ethernet и перезапустите приложение.');
      updateQR().catch(error => message(error.message));
    }
  } else {
    $('save-hint').textContent = 'Оставьте страницу открытой до завершения. Получатель увидит имя и размер каждого файла.';
  }
  const signature = JSON.stringify([state.offers, state.shares]);
  if (rendered === signature) return;
  rendered = signature;
  $('incoming').replaceChildren(); $('shared').replaceChildren(); $('history').replaceChildren();
  const pending = state.admin ? state.offers.filter(x => x.state === 'pending') : [];
  for (const offer of pending) {
    const item = row(offer.name, `${sizes(offer.size)} · ${offer.device}`);
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
    const item = row(share.name, `${sizes(share.size)} · ${state.admin ? 'Доступен подключённым устройствам' : 'Готов к скачиванию'}`);
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
  state = await api('/api/state'); render();
}

async function poll() {
  if (authToken) {
    try { await refresh(); }
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

function upload(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', url);
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
