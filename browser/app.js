import { MEMORY_LIMIT, DISK_LIMIT, validateFileSpec } from './transfer.mjs';
import { newRelaySecret } from './relay.mjs';
import { normalizeInvitationId, formatInvitationId, invitationCredentials, shortInvitationLookup, invitationKeyExchange, sharedInvitationSecret } from './invitation-id.mjs?v=numeric-1';
import { Connection, requestApi } from './connection.mjs?v=devices-1';
const $ = id => document.getElementById(id);
const mobileDevice = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Mac/i.test(navigator.platform || '') && navigator.maxTouchPoints > 1);
const diskSupported = !mobileDevice && typeof window.showDirectoryPicker === 'function';
const connections = new Map(), rows = new Map(), objectUrls = new Set();
let receiveDirectory = null, bufferedBytes = 0, selectedId = null, selectionLost = false, everConnected = false;
let setup = null, creating = false, joining = false, sending = false, appClosed = false;
let invitation = null, invitationId = null, joinInvite = null, idExpiryTimer, connectionNumber = 0, deviceListSignature = '';
const sizes = n => n < 1024 ? `${n} Б` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} КиБ` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} МиБ` : `${(n / 1024 ** 3).toFixed(1)} ГиБ`;
const rowKey = (connection, id) => `${connection.id}:${id}`;
const liveConnections = () => [...connections.values()].filter(connection => connection.hasConnected && !connection.stopped);
const selectedConnection = () => connections.get(selectedId);
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); $('notice').hidden = !text; }
function status(title, detail, connected = false) { $('connection-title').textContent = title; $('connection-detail').textContent = detail; $('status-dot').classList.toggle('connected', connected); }
const confirmationStorageKey = 'nearby.confirm-invitation';
let confirmInvitation = false;
try { confirmInvitation = localStorage.getItem(confirmationStorageKey) === 'true'; } catch {}
const confirmationControl = $('confirm-invitation');
if (confirmationControl) confirmationControl.checked = confirmInvitation;
confirmationControl?.addEventListener('change', () => {
  confirmInvitation = confirmationControl.checked;
  try { localStorage.setItem(confirmationStorageKey, String(confirmInvitation)); } catch {}
  if (!confirmInvitation && joinInvite) void join(joinInvite);
});
const nameStorageKey = 'nearby.device-name';
const nameVersionKey = 'nearby.device-name.version';
function cleanDeviceName(value) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : ''; }
function suggestedDeviceName() {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const device = /iPhone|iPod/i.test(ua) ? 'iPhone'
    : /iPad/i.test(ua) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/i.test(ua + platform) ? 'Android'
    : /Win/i.test(platform + ua) ? 'Windows'
    : /Mac/i.test(platform + ua) ? 'Mac'
    : /Linux/i.test(platform + ua) ? 'Linux' : 'Устройство';
  const names = ['Эльбрус', 'Дыхтау', 'Шхара', 'Коштантау', 'Пик Пушкина', 'Джангитау', 'Мижирги', 'Казбек'];
  const random = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(random);
  else random[0] = Math.floor(Math.random() * 2 ** 32);
  return `${device} · ${names[random[0] % names.length]}`;
}
let initialDeviceName = '';
try {
  initialDeviceName = cleanDeviceName(localStorage.getItem(nameStorageKey));
  // The first naming version saved no origin flag. Migrate only its exact default format, once.
  if (localStorage.getItem(nameVersionKey) !== '2' && /^(?:iPhone|iPad|Android|Windows|Mac|Linux|Устройство) · (?:Луна|Клён|Маяк|Облако|Искра|Ветер|Сосна|Комета|Ручей|Сокол|Кедр|Луч)$/.test(initialDeviceName)) initialDeviceName = '';
} catch { /* Storage may be disabled. */ }
initialDeviceName ||= suggestedDeviceName();
$('device-name').value = initialDeviceName;
function rememberDeviceName() {
  const name = cleanDeviceName($('device-name').value);
  try {
    if (name) { localStorage.setItem(nameStorageKey, name); localStorage.setItem(nameVersionKey, '2'); }
  } catch { /* Naming still works without storage. */ }
}
function deviceName() {
  $('device-name').value = cleanDeviceName($('device-name').value) || initialDeviceName;
  rememberDeviceName();
  return $('device-name').value;
}
$('device-name').addEventListener('input', rememberDeviceName);
$('device-name').addEventListener('blur', deviceName);
rememberDeviceName();
function parseInvite(value) {
  const url = new URL(value, location.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname) throw new Error('Нужна ссылка-приглашение Nearby с этого сайта.');
  const params = new URLSearchParams(url.hash.slice(1));
  const room = params.get('room'), token = params.get('key');
  if (!/^[a-f0-9]{32}$/.test(room || '') || !/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Ссылка-приглашение неполная. Скопируйте её целиком.');
  const mode = params.get('mode') || 'lan', relaySecret = params.get('secret');
  if (!['lan', 'internet', 'auto'].includes(mode) || (mode !== 'lan' && !/^[a-f0-9]{64}$/.test(relaySecret || ''))) throw new Error('Нужна полная ссылка с ключом интернет-передачи. Скопируйте приглашение заново.');
  return { room, token, mode, relaySecret };
}

function displayName(connection) {
  const name = connection.peerName || 'Устройство';
  return liveConnections().filter(item => item.peerName === connection.peerName).length > 1 ? `${name} · ${connection.number}` : name;
}
function renderRecipient() {
  const connection = selectedConnection(), usable = connection && !connection.stopped;
  $('recipient-name').classList.toggle('device-name', Boolean(usable));
  $('recipient-name').textContent = usable ? displayName(connection) : 'Устройство не выбрано';
  $('transport-label').textContent = usable ? connection.ready ? connection.transport === 'relay' ? 'Интернет · сквозное шифрование' : 'WebRTC · напрямую' : 'Восстанавливаем соединение' : 'Не подключено';
  const disabled = sending || !usable || !connection.ready;
  $('files').disabled = disabled; $('drop').classList.toggle('disabled', disabled);
  $('disconnect-selected').disabled = !usable;
  $('file-limit').textContent = usable && connection.link?.peerLimit ? `До ${sizes(connection.link.peerLimit)} на файл для этого получателя` : 'Выберите получателя на вкладке «Устройства».';
  const live = liveConnections();
  $('select-remaining').hidden = usable || live.length !== 1;
  if (!$('select-remaining').hidden) $('remaining-name').textContent = displayName(live[0]);
}
function selectRecipient(id) {
  const connection = connections.get(id);
  if (sending || !connection || connection.stopped || !connection.ready) return;
  selectedId = id; selectionLost = false; renderDevices();
}
function renderDevices() {
  if (appClosed) return;
  const live = liveConnections();
  window.NearbyWorkspace.setDevices(live.length);
  window.NearbyWorkspace.setConnected(live.some(connection => connection.ready));
  $('connected-count').textContent = String(live.length);
  $('connection-summary').hidden = !everConnected && !setup;
  $('devices-transfer').disabled = sending || !selectedConnection()?.ready;
  const signature = JSON.stringify(live.map(connection => [connection.id, connection.peerName, connection.ready, connection.transport, connection.id === selectedId, sending]));
  if (signature !== deviceListSignature) {
    deviceListSignature = signature;
    $('device-list').replaceChildren();
    for (const connection of live) {
      const card = document.createElement('label'); card.className = 'device-target';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'send-target'; radio.value = connection.id; radio.checked = connection.id === selectedId; radio.disabled = sending || !connection.ready;
      radio.addEventListener('change', () => selectRecipient(connection.id));
      const info = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small');
      name.className = 'device-name'; name.textContent = displayName(connection);
      detail.textContent = connection.ready ? connection.transport === 'relay' ? 'Интернет · сквозное шифрование' : 'WebRTC · напрямую' : 'Восстанавливаем соединение';
      info.append(name, detail); card.append(radio, info); $('device-list').append(card);
    }
  }
  $('devices-empty').hidden = live.length > 0;
  if (!setup) {
    $('connection-summary').append($('disconnect'));
    $('disconnect').textContent = live.length ? 'Отключить выбранное устройство' : 'Новое подключение';
    $('disconnect').disabled = live.length > 0 && !selectedConnection();
  }
  renderRecipient();
}
function hideInvitationId() { clearTimeout(idExpiryTimer); $('invitation-id').hidden = true; }
function showInvitationId(code, expires) {
  invitationId = formatInvitationId(code);
  $('connection-id').replaceChildren(...invitationId.match(/[^-]+-?/g).map(group => { const span = document.createElement('span'); span.textContent = group; return span; }));
  $('id-status').textContent = 'Одно приглашение · 15 минут'; $('invitation-id').hidden = false; $('copy-id').disabled = false; $('copy').disabled = false;
  idExpiryTimer = setTimeout(() => { $('id-status').textContent = 'Срок приглашения истёк. Создайте новое подключение.'; $('copy-id').disabled = true; $('copy').disabled = true; }, Math.max(0, expires * 1000 - Date.now()));
}
function lockSetup(locked) {
  for (const control of $('start').querySelectorAll('.start-settings input,.start-settings select,.connection-entry input,.connection-entry button')) control.disabled = locked;
}
function showSetup(connection) {
  setup = connection;
  const card = $(connection.session.role === 'host' ? 'invite-card' : 'connect-card');
  card.querySelector('.connection-entry').hidden = true; card.append($('session'));
  $('session').querySelector('.connection-panel').append($('disconnect'));
  $('disconnect').disabled = false; $('disconnect').textContent = 'Отменить подключение';
  $('peer-request').hidden = true; $('approve').disabled = false;
  $('invitation').hidden = connection.session.role !== 'host'; $('session').hidden = false;
  lockSetup(true); window.NearbyWorkspace.selectTab('connection'); notice(''); renderDevices();
}
function resetSetup(connection) {
  if (setup !== connection) return;
  setup = null; hideInvitationId(); $('peer-request').hidden = true; $('session').hidden = true; $('start').append($('session'));
  for (const entry of document.querySelectorAll('.connection-entry')) entry.hidden = false;
  $('create').hidden = false; $('join-form').hidden = false; $('join-invite').hidden = true;
  $('connect-card').querySelector('h2').textContent = 'Подключиться';
  lockSetup(false); renderDevices();
}
function register(session, peerName = '') {
  const connection = new Connection(session, {
    receiveLimit: connection => connection.transport === 'relay' || !receiveDirectory ? MEMORY_LIMIT : DISK_LIMIT,
    onStatus: (connection, title, detail) => { if (setup === connection) status(title, detail); renderDevices(); },
    onNotice: (connection, message) => { if (setup === connection || selectedId === connection.id) notice(message); },
    onPeerRequest: (connection, name) => { if (setup !== connection) return; $('peer-name').textContent = name; $('peer-request').hidden = false; $('invitation').hidden = true; hideInvitationId(); },
    onApproved: connection => { if (setup === connection) { $('peer-request').hidden = true; $('invitation').hidden = true; hideInvitationId(); } },
    onReady: connection => {
      const firstReady = !connection.announced; connection.announced = true; everConnected = true;
      if (!selectedId && !selectionLost) selectedId = connection.id;
      if (setup === connection) { status('Устройства соединены', `Подключено: ${connection.peerName || 'Второе устройство'}. Файлы принимаются автоматически.`, true); resetSetup(connection); }
      renderDevices(); notice('');
      if (firstReady && liveConnections().length > 1 && !sending) window.NearbyWorkspace.selectTab('devices');
    },
    onOffer: (connection, spec, receivingLink) => { void showIncoming(connection, spec, receivingLink); },
    onProgress: (connection, id, bytes, direction) => { const row = rows.get(rowKey(connection, id)); if (row) { row.progress.value = bytes; row.detail.textContent = `${direction === 'sending' ? 'Отправляем' : 'Принимаем'}: ${sizes(bytes)} / ${sizes(row.size)}`; } },
    onComplete: complete,
    onError: (connection, id, message) => { const row = rows.get(rowKey(connection, id)); if (row) { row.element.classList.add('error'); row.detail.textContent = message; row.actions.replaceChildren(); row.progress.remove(); row.done = true; } },
    onClosed: (connection, message, expected) => {
      if (appClosed) return;
      if (selectedId === connection.id) { selectedId = null; selectionLost = true; }
      resetSetup(connection); renderDevices(); notice(message, !expected);
    },
  });
  connection.number = ++connectionNumber; connection.peerName = peerName; connections.set(connection.id, connection); return connection;
}
async function create() {
  if (setup || creating || joining || appClosed) return;
  creating = true; lockSetup(true);
  try {
    const mode = $('connection-mode').value, exchange = await invitationKeyExchange();
    const result = await requestApi('create', { name: deviceName(), mode, shortId: true, idPublicKey: exchange.publicKey });
    if (appClosed) { void requestApi('close', {}, { room: result.room, token: result.token }); return; }
    if (result.shortId !== true || !/^\d{9}$/.test(result.id || '') || result.mode !== mode) throw new Error('Обновите страницу на обоих устройствах и создайте новое приглашение.');
    const session = { room: result.room, token: result.token, role: 'host', mode, relaySecret: mode !== 'lan' ? newRelaySecret() : null, idPrivateKey: exchange.privateKey };
    const connection = register(session);
    const url = new URL(location.pathname, location.origin); url.hash = new URLSearchParams({ room: result.room, key: result.invite, ...(mode !== 'lan' ? { mode, secret: session.relaySecret } : {}) }).toString();
    invitation = url.href; $('share-link').value = invitation; showSetup(connection); showInvitationId(result.id, result.inviteExpires);
    try { await window.QRCode.toCanvas($('qr'), invitation, { width: 190, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#080d18', light: '#ffffff' } }); } catch { notice('QR-код не удалось создать. Используйте ссылку-приглашение.'); }
    connection.start();
  } catch (error) { notice(error.message, true); if (!setup) lockSetup(false); }
  finally { creating = false; }
}
async function join(value) {
  if (joining || creating || setup || appClosed) return;
  joining = true; lockSetup(true); $('join-invite').disabled = true;
  try {
    let invite;
    if (/^[\da-z\s-]+$/i.test(value.trim())) {
      const code = normalizeInvitationId(value);
      if (code.length === 9) {
        const resolved = await requestApi('resolve-id', { lookup: await shortInvitationLookup(code) });
        if (connections.has(resolved.room)) throw new Error('Это приглашение уже открыто на этом устройстве.');
        const exchange = await invitationKeyExchange();
        invite = { room: resolved.room, token: resolved.token, mode: resolved.mode, idPublicKey: exchange.publicKey, relaySecret: await sharedInvitationSecret(exchange.privateKey, resolved.idPublicKey, resolved.room) };
      } else {
        const credentials = await invitationCredentials(code), resolved = await requestApi('resolve-id', { lookup: credentials.lookup });
        invite = { room: resolved.room, token: credentials.token, mode: resolved.mode, relaySecret: resolved.mode !== 'lan' ? credentials.relaySecret : null };
      }
    } else invite = parseInvite(value);
    if (connections.has(invite.room)) throw new Error('Это приглашение уже открыто на этом устройстве.');
    if (appClosed) return;
    const result = await requestApi('join', { room: invite.room, token: invite.token, name: deviceName(), ...(invite.idPublicKey ? { idPublicKey: invite.idPublicKey } : {}) });
    if (appClosed) { void requestApi('close', {}, { room: invite.room, token: result.token }); return; }
    if ((result.mode || 'lan') !== invite.mode) throw new Error('Режим приглашения изменён. Попросите новую полную ссылку.');
    const connection = register({ room: invite.room, token: result.token, role: 'guest', mode: invite.mode, relaySecret: invite.relaySecret }, result.hostName);
    $('connection-mode').value = invite.mode; describeMode(); joinInvite = null; history.replaceState(null, '', location.pathname);
    showSetup(connection); status('Ожидаем подтверждения', `${result.hostName}: подтвердите подключение на первом устройстве.`); connection.start();
  } catch (error) { notice(error.message, true); $('join-invite').hidden = !joinInvite; $('join-invite').disabled = false; if (!setup) lockSetup(false); }
  finally { joining = false; }
}
function rowFor(connection, spec, direction) {
  if (direction === 'incoming') $('empty').hidden = true;
  const element = document.createElement('article'); element.className = 'transfer'; element.dataset.id = spec.id;
  const title = document.createElement('div'); title.className = 'transfer-title'; title.textContent = spec.name;
  const meta = document.createElement('div'); meta.className = 'transfer-meta'; meta.textContent = `${direction === 'incoming' ? '↓ Входящий' : '↑ Исходящий'} · ${sizes(spec.size)}`;
  const detail = document.createElement('div'); detail.className = 'transfer-detail'; detail.textContent = direction === 'incoming' ? 'Принимаем автоматически…' : 'Подготавливаем передачу…';
  const progress = document.createElement('progress'); progress.max = spec.size || 1; progress.value = 0; progress.setAttribute('aria-label', 'Прогресс передачи');
  const actions = document.createElement('div'); actions.className = 'transfer-actions';
  const peerName = document.createElement('div'); peerName.className = 'transfer-peer'; peerName.textContent = displayName(connection);
  element.append(title, peerName, meta, detail, progress, actions); $(direction === 'incoming' ? 'transfers' : 'outgoing-transfers').prepend(element);
  const row = { element, detail, progress, actions, size: spec.size, done: false, direction, connection }; rows.set(rowKey(connection, spec.id), row); return row;
}
function button(label, action, primary = false) { const b = document.createElement('button'); b.className = `button ${primary ? 'primary' : 'secondary'}`; b.textContent = label; b.onclick = action; return b; }
function cancelButton(fileLink, id, actions) { actions.append(button('Отменить', () => fileLink.cancel(id))); }
function memorySink(spec, row) {
  if (spec.size > MEMORY_LIMIT) throw new Error('Для обычного скачивания доступны файлы до 100 МиБ. Для больших файлов используйте Chrome/Edge на ПК с разрешённой записью на диск.');
  if (bufferedBytes + spec.size > MEMORY_LIMIT) throw new Error('Сначала сохраните принятые файлы и нажмите «Убрать из памяти». Вкладка хранит не более 100 МиБ.');
  bufferedBytes += spec.size;
  let parts = [], reserved = true;
  row.releaseMemory = () => { if (reserved) { bufferedBytes -= spec.size; reserved = false; } };
  return { write: async data => { parts.push(data); }, close: async () => { const blob = new Blob(parts, { type: 'application/octet-stream' }); parts = []; return blob; }, abort: async () => { parts = []; row.releaseMemory(); } };
}
async function showIncoming(connection, spec, receivingLink) {
  const row = rowFor(connection, spec, 'incoming');
  window.NearbyWorkspace.incoming();
  try {
    let sink;
    if (receiveDirectory) {
      const destination = `${crypto.randomUUID()}-${spec.name}`;
      const handle = await receiveDirectory.getFileHandle(destination, { create: true });
      const writable = await handle.createWritable();
      sink = { write: data => writable.write(data), close: async () => { await writable.close(); return null; }, abort: async () => { await writable.abort(); await receiveDirectory.removeEntry(destination); } };
    } else sink = memorySink(spec, row);
    await receivingLink.accept(spec.id, sink);
    if (!row.done) cancelButton(receivingLink, spec.id, row.actions);
  } catch (error) { receivingLink.cancel(spec.id, error.message || 'Не удалось сохранить файл.'); }
}

for (const control of document.querySelectorAll('[data-choose-folder]')) {
  control.hidden = !diskSupported;
  control.addEventListener('click', async () => {
    if (Array.from(rows.values()).some(row => !row.done)) { notice('Дождитесь завершения текущей передачи.'); return; }
    try {
      receiveDirectory = await window.showDirectoryPicker({ mode: 'readwrite' });
      for (const name of document.querySelectorAll('.receive-folder-name')) name.textContent = receiveDirectory.name ? `Папка: ${receiveDirectory.name}` : 'Папка выбрана.';
      $('save-hint').textContent = 'Файлы сохраняются автоматически в выбранную папку.';
      if (liveConnections().some(connection => connection.link?.peerLimit && connection.transport !== 'relay')) notice('Папка выбрана. Для файлов больше 100 МиБ создайте новое подключение.');
    } catch (error) { if (error.name !== 'AbortError') notice('Выбор папки недоступен. Файлы будут загружаться через браузер.'); }
  });
}
function complete(connection, id, direction, blob) {
  const row = rows.get(rowKey(connection, id)); if (!row || row.done) return;
  row.done = true; row.progress.value = row.progress.max; row.actions.replaceChildren();
  row.detail.textContent = direction === 'sent' ? 'Передан получателю.' : blob ? 'Файл принят. Загрузка началась автоматически.' : 'Сохранён в выбранную папку.';
  if (direction === 'received') void connection.reportStatistics('record-transfer', { id, size: row.size });
  if (blob) {
    const url = URL.createObjectURL(blob); objectUrls.add(url);
    const save = document.createElement('a'); save.className = 'button primary'; save.href = url; save.download = row.element.querySelector('.transfer-title').textContent; save.textContent = 'Сохранить файл ↓'; row.actions.append(save);
    // Browsers may apply their own multiple-download policy. Keep a visible save
    // link and retain the blob as a fallback instead of silently losing a file.
    save.click();
    row.actions.append(button('Убрать из памяти', () => { URL.revokeObjectURL(url); objectUrls.delete(url); row.releaseMemory?.(); row.actions.replaceChildren(); row.detail.textContent = 'Файл удалён из памяти вкладки.'; }));
  }
}
async function sendFiles(files) {
  const connection = selectedConnection(), fileLink = connection?.link;
  if (sending || appClosed || !connection?.ready || !fileLink?.peerLimit) return;
  sending = true; renderDevices();
  try {
    for (const file of files) {
      if (appClosed || connection.stopped || !connection.ready || connection.link !== fileLink) break;
      const id = crypto.randomUUID();
      try {
        validateFileSpec({ id, name: file.name, size: file.size }, fileLink.peerLimit);
        const row = rowFor(connection, { id, name: file.name, size: file.size }, 'outgoing'); cancelButton(fileLink, id, row.actions);
        await fileLink.sendFile(file, id);
      } catch (error) { if (!rows.has(rowKey(connection, id))) notice(`${file.name}: ${error.message}`, true); }
    }
  } finally { sending = false; $('files').value = ''; renderDevices(); }
}
$('create').onclick = create;
$('join-form').onsubmit = event => { event.preventDefault(); void join($('invite-input').value.trim()); };
$('join-invite').onclick = () => join(joinInvite);
$('approve').onclick = async () => {
  const connection = setup; if (!connection) return; $('approve').disabled = true;
  try { await connection.api('approve'); if (setup === connection) $('peer-request').hidden = true; }
  catch (error) { notice(error.message, true); if (setup === connection) $('approve').disabled = false; }
};
$('reject').onclick = () => setup?.disconnect();
$('disconnect').onclick = () => { const connection = setup || selectedConnection(); if (connection) void connection.disconnect(); else { window.NearbyWorkspace.selectTab('connection'); $('invite-input').focus(); } };
$('disconnect-selected').onclick = () => selectedConnection()?.disconnect();
$('select-remaining').onclick = () => { const live = liveConnections(); if (live.length === 1) selectRecipient(live[0].id); };
$('devices-transfer').onclick = () => window.NearbyWorkspace.selectTab('transfer');
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(invitation); $('copy').textContent = 'Ссылка скопирована ✓'; }
  catch { $('share-link').focus(); $('share-link').select(); notice('Скопируйте выделенную ссылку.'); }
};
$('copy-id').onclick = async () => {
  try { await navigator.clipboard.writeText(invitationId); $('copy-id').textContent = 'ID скопирован ✓'; }
  catch { const selection = getSelection(), range = document.createRange(); range.selectNodeContents($('connection-id')); selection.removeAllRanges(); selection.addRange(range); notice('Скопируйте выделенный ID.'); }
};
$('files').onchange = event => void sendFiles(Array.from(event.target.files));
for (const type of ['dragover', 'dragleave', 'drop']) $('drop').addEventListener(type, event => { event.preventDefault(); $('drop').classList.toggle('drag', type === 'dragover' && !sending); if (type === 'drop') void sendFiles(Array.from(event.dataTransfer.files)); });
document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => event.preventDefault());
window.addEventListener('beforeunload', event => { if (sending || Array.from(rows.values()).some(row => !row.done)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => {
  appClosed = true; clearTimeout(idExpiryTimer);
  for (const connection of connections.values()) connection.stop('Соединение закрыто.', true);
  for (const url of objectUrls) URL.revokeObjectURL(url);
});
window.addEventListener('hashchange', () => {
  if (setup || creating || joining || appClosed) return;
  if (new URLSearchParams(location.hash.slice(1)).has('room')) openInvitation(location.href);
});
$('save-hint').textContent = diskSupported ? 'Приём автоматический. Можно один раз выбрать папку получения.' : 'Приём автоматический · до 100 МиБ. Сохраните файлы перед закрытием.';
function describeMode() {
  const internet = $('connection-mode').value === 'internet', automatic = $('connection-mode').value === 'auto';
  $('mode-help').textContent = automatic ? 'Соединение выбирается автоматически: напрямую, а если недоступно — через зашифрованный интернет-канал (до 100 МиБ на файл).' : internet ? 'Для разных Wi-Fi и мобильного интернета. До 100 МиБ на файл; оба устройства остаются онлайн. Зашифрованные части временно проходят через сервер.' : 'Для устройств в одной доступной локальной сети. Файлы идут напрямую через WebRTC.';
  $('web-discovery-hint').hidden = internet || automatic;
}
$('connection-mode').addEventListener('change', describeMode);
const initialParams = new URLSearchParams(location.hash.slice(1));
if (['lan', 'internet', 'auto'].includes(initialParams.get('mode'))) $('connection-mode').value = initialParams.get('mode');
describeMode(); renderDevices();
if (!window.isSecureContext || !crypto.subtle) { notice('Откройте Nearby по HTTPS в современном браузере. На Windows рекомендуем Chrome или Edge.', true); $('create').disabled = true; $('join-form').hidden = true; }
else if (initialParams.has('room')) openInvitation(location.href);
else if (location.hash) history.replaceState(null, '', location.pathname);
function openInvitation(value) {
  try {
    const invite = parseInvite(value); $('connection-mode').value = invite.mode; describeMode();
    joinInvite = value; history.replaceState(null, '', location.pathname);
    $('create').hidden = true; $('join-form').hidden = true; $('join-invite').hidden = !confirmInvitation; $('join-invite').disabled = false;
    $('connect-card').querySelector('h2').textContent = 'Вас пригласили в Nearby';
    window.NearbyWorkspace.selectTab('connection');
    if (!confirmInvitation) void join(joinInvite);
  } catch (error) { notice(error.message, true); history.replaceState(null, '', location.pathname); }
}
