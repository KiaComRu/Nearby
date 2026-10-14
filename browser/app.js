import { FileLink, MEMORY_LIMIT, DISK_LIMIT, validateFileSpec } from './transfer.mjs';
import { HttpsRelayChannel, newRelaySecret } from './relay.mjs';
const $ = id => document.getElementById(id);
// Some mobile browsers expose the picker but cannot write to its selected handle.
const mobileDevice = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Mac/i.test(navigator.platform || '') && navigator.maxTouchPoints > 1);
const diskSupported = !mobileDevice && typeof window.showSaveFilePicker === 'function';
const ownLimit = diskSupported ? DISK_LIMIT : MEMORY_LIMIT;
const rows = new Map(), objectUrls = new Set();
let session = null, peer = null, link = null, pollTimer, connectionTimer, cursor = 0, started = false, sending = false, incomingCandidates = [], stopped = false;
let invitation = null, joinInvite = null, signalChain = Promise.resolve();
let bufferedBytes = 0;
let relayChannel = null;
const sizes = n => n < 1024 ? `${n} Б` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} КиБ` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} МиБ` : `${(n / 1024 ** 3).toFixed(1)} ГиБ`;
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); $('notice').hidden = !text; }
function status(title, detail, connected = false) { $('connection-title').textContent = title; $('connection-detail').textContent = detail; $('status-dot').classList.toggle('connected', connected); }
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
async function api(action, extra = {}, anonymous = false) {
  const response = await fetch(action.startsWith('relay-') ? 'api.php?transport=relay' : 'api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000), body: JSON.stringify({ action, ...(anonymous ? {} : { room: session.room, token: session.token }), ...extra }) });
  const result = await response.json().catch(() => { throw new Error('Сервер вернул неожиданный ответ. Попробуйте позже.'); });
  if (!response.ok || result.error) { const error = new Error(result.error || 'Ошибка соединения.'); error.status = response.status; throw error; }
  return result;
}
function parseInvite(value) {
  const url = new URL(value, location.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname) throw new Error('Нужна ссылка-приглашение Nearby с этого сайта.');
  const params = new URLSearchParams(url.hash.slice(1));
  const room = params.get('room'), token = params.get('key');
  if (!/^[a-f0-9]{32}$/.test(room || '') || !/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Ссылка-приглашение неполная. Скопируйте её целиком.');
  const mode = params.get('mode') || 'lan', relaySecret = params.get('secret');
  if (!['lan', 'internet'].includes(mode) || (mode === 'internet' && !/^[a-f0-9]{64}$/.test(relaySecret || ''))) throw new Error('Нужна полная ссылка с ключом интернет-передачи. Скопируйте приглашение заново.');
  return { room, token, mode, relaySecret };
}
function showSession() { $('start').hidden = true; $('session').hidden = false; notice(''); }
async function create() {
  $('create').disabled = true;
  try {
    const mode = $('connection-mode').value;
    const result = await api('create', { name: deviceName(), mode }, true);
    session = { room: result.room, token: result.token, role: 'host', mode, relaySecret: mode === 'internet' ? newRelaySecret() : null };
    const url = new URL(location.pathname, location.origin); url.hash = new URLSearchParams({ room: result.room, key: result.invite, ...(mode === 'internet' ? { mode, secret: session.relaySecret } : {}) }).toString();
    invitation = url.href; $('share-link').value = invitation;
    showSession();
    try { await window.QRCode.toCanvas($('qr'), invitation, { width: 190, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#080d18', light: '#ffffff' } }); }
    catch { notice('QR-код не удалось создать. Используйте ссылку-приглашение.'); }
    poll();
  } catch (error) { notice(error.message, true); $('create').disabled = false; }
}
async function join(value) {
  $('join-invite').disabled = true; $('join-form').querySelector('button').disabled = true;
  try {
    const invite = parseInvite(value);
    // The encryption secret stays in memory; it must never be posted to PHP.
    const result = await api('join', { room: invite.room, token: invite.token, name: deviceName() }, true);
    if ((result.mode || 'lan') !== invite.mode) throw new Error('Режим приглашения изменён. Попросите новую полную ссылку.');
    session = { room: invite.room, token: result.token, role: 'guest', mode: invite.mode, relaySecret: invite.relaySecret };
    joinInvite = null; history.replaceState(null, '', location.pathname);
    $('invitation').hidden = true; showSession();
    status('Ожидаем подтверждения', `${result.hostName}: подтвердите подключение на первом устройстве.`);
    poll();
  } catch (error) { notice(error.message, true); $('join-invite').disabled = false; $('join-form').querySelector('button').disabled = false; }
}
function sendSignal(message) {
  signalChain = signalChain.then(() => api('signal', { message }));
  signalChain.catch(error => { if (!stopped) failConnection(error.message); });
  return signalChain;
}
async function startPeer() {
  started = true;
  if (session.mode === 'internet') {
    status('Устанавливаем интернет-связь', 'Проверяем зашифрованное соединение с другим устройством.');
    relayChannel = new HttpsRelayChannel({ room: session.room, secret: session.relaySecret, role: session.role, request: (action, body) => api(action, body) });
    bindChannel(relayChannel);
    connectionTimer = setTimeout(() => { if (!link?.peerLimit) failConnection('Интернет-связь не установлена. Проверьте доступ к сайту и передайте приглашение целиком.'); }, 45000);
    await relayChannel.start(); return;
  }
  if (!window.RTCPeerConnection) throw new Error('Локальный WebRTC недоступен в этом браузере. Выберите режим «Через интернет».');
  status('Устанавливаем связь', 'Разрешите доступ к локальной сети, если браузер попросит.');
  // Direct LAN mode. No third-party STUN/TURN service or relay credentials.
  peer = new RTCPeerConnection({ iceServers: [] });
  peer.onicecandidate = event => { if (event.candidate) sendSignal({ type: 'candidate', candidate: event.candidate.toJSON() }); };
  peer.ondatachannel = event => bindChannel(event.channel);
  peer.onconnectionstatechange = () => {
    if (peer?.connectionState === 'failed') failConnection('Прямое соединение не удалось. Проверьте общую локальную сеть, отключите VPN или используйте Windows-приложение.');
    if (peer?.connectionState === 'disconnected') { $('files').disabled = true; status('Связь прервалась', 'Передача может быть прервана. Если связь не восстановится, создайте новое подключение.'); }
    if (peer?.connectionState === 'connected' && link?.peerLimit) ready(link.peerLimit);
  };
  connectionTimer = setTimeout(() => { if (!link?.peerLimit) failConnection('Устройства не смогли соединиться напрямую. Подключите их к одной обычной сети Wi-Fi; гостевая сеть может изолировать устройства.'); }, 45000);
  if (session.role === 'host') {
    bindChannel(peer.createDataChannel('nearby-files', { ordered: true }));
    const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
    await sendSignal({ type: 'offer', sdp: offer.sdp });
  }
}
async function receiveSignal(message) {
  if (message.type === 'candidate') {
    if (!peer.remoteDescription) incomingCandidates.push(message.candidate); else await peer.addIceCandidate(message.candidate);
    return;
  }
  if ((message.type === 'offer' && session.role !== 'guest') || (message.type === 'answer' && session.role !== 'host')) throw new Error('Неожиданное описание соединения.');
  await peer.setRemoteDescription({ type: message.type, sdp: message.sdp });
  for (const candidate of incomingCandidates) await peer.addIceCandidate(candidate);
  incomingCandidates = [];
  if (message.type === 'offer') {
    const answer = await peer.createAnswer(); await peer.setLocalDescription(answer);
    await sendSignal({ type: 'answer', sdp: answer.sdp });
  }
}
let pollFailures = 0;
async function poll() {
  if (stopped || !session || link?.peerLimit) return;
  try {
    const result = await api('poll', { after: cursor }); pollFailures = 0;
    if (session.role === 'host' && result.guestName && !result.approved) {
      $('peer-name').textContent = result.guestName; $('peer-request').hidden = false; $('invitation').hidden = true;
      status('Разрешить подключение?', 'Убедитесь, что приглашение открыл ваш получатель.');
    }
    if (result.approved && !started) { $('peer-request').hidden = true; $('invitation').hidden = true; await startPeer(); }
    if (started && session.mode !== 'internet') for (const message of result.messages) await receiveSignal(message.body);
    cursor = result.cursor;
  } catch (error) {
    if ([400, 403, 404, 410].includes(error.status) || ++pollFailures >= 4) { failConnection(error.message); return; }
    notice('Проверяем соединение с сайтом…');
  }
  if (!stopped && !link?.peerLimit) pollTimer = setTimeout(poll, 1500);
}
function ready(limit) {
  void reportUsage();
  clearTimeout(connectionTimer); clearTimeout(pollTimer); notice('');
  status('Устройства соединены', 'Выберите файл здесь или на втором устройстве.', true);
  $('transport-label').textContent = session.mode === 'internet' ? 'Интернет · сквозное шифрование' : 'WebRTC · напрямую';
  $('files').disabled = sending; $('drop').classList.toggle('disabled', sending);
  $('file-limit').textContent = `До ${sizes(limit)} на файл для этого получателя`;
}
function bindChannel(channel) {
  const open = () => {
    link = new FileLink(channel, { maxReceive: session.mode === 'internet' ? MEMORY_LIMIT : ownLimit,
      onReady: ready,
      onOffer: showIncoming,
      onProgress: (id, bytes, direction) => { const row = rows.get(id); if (row) { row.progress.value = bytes; row.detail.textContent = `${direction === 'sending' ? 'Отправляем' : 'Принимаем'}: ${sizes(bytes)} / ${sizes(row.size)}`; } },
      onComplete: complete,
      onError: (id, message) => { const row = rows.get(id); if (row) { row.element.classList.add('error'); row.detail.textContent = message; row.actions.replaceChildren(); row.progress.remove(); row.done = true; } }
    });
  };
  if (channel.readyState === 'open') open(); else channel.addEventListener('open', open, { once: true });
  channel.addEventListener('close', () => { if (!stopped) failConnection(channel.error || 'Соединение с другим устройством закрыто. Создайте новое подключение.'); });
}
function rowFor(spec, direction) {
  $('empty').hidden = true;
  const element = document.createElement('article'); element.className = 'transfer'; element.dataset.id = spec.id;
  const title = document.createElement('div'); title.className = 'transfer-title'; title.textContent = spec.name;
  const meta = document.createElement('div'); meta.className = 'transfer-meta'; meta.textContent = `${direction === 'incoming' ? '↓ Входящий' : '↑ Исходящий'} · ${sizes(spec.size)}`;
  const detail = document.createElement('div'); detail.className = 'transfer-detail'; detail.textContent = direction === 'incoming' ? 'Принять файл с другого устройства?' : 'Ожидаем подтверждения получателя…';
  const progress = document.createElement('progress'); progress.max = spec.size || 1; progress.value = 0; progress.setAttribute('aria-label', 'Прогресс передачи');
  const actions = document.createElement('div'); actions.className = 'transfer-actions';
  element.append(title, meta, detail, progress, actions); $('transfers').prepend(element);
  const row = { element, detail, progress, actions, size: spec.size, done: false }; rows.set(spec.id, row); return row;
}
function button(label, action, primary = false) { const b = document.createElement('button'); b.className = `button ${primary ? 'primary' : 'secondary'}`; b.textContent = label; b.onclick = action; return b; }
function cancelButton(id, actions) { actions.append(button('Отменить', () => link.cancel(id))); }
function memorySink(spec, row) {
  if (spec.size > MEMORY_LIMIT) throw new Error('Для обычного скачивания доступны файлы до 100 МиБ. Для больших файлов используйте Chrome/Edge на ПК с разрешённой записью на диск.');
  if (bufferedBytes + spec.size > MEMORY_LIMIT) throw new Error('Сначала сохраните принятые файлы и нажмите «Убрать из памяти». Вкладка хранит не более 100 МиБ.');
  bufferedBytes += spec.size;
  let parts = [], reserved = true;
  row.releaseMemory = () => { if (reserved) { bufferedBytes -= spec.size; reserved = false; } };
  return { write: async data => { parts.push(data); }, close: async () => { const blob = new Blob(parts, { type: 'application/octet-stream' }); parts = []; return blob; }, abort: async () => { parts = []; row.releaseMemory(); } };
}
async function showIncoming(spec) {
  const row = rowFor(spec, 'incoming');
  row.actions.append(button('Принять', async event => {
    event.currentTarget.disabled = true;
    try {
      let sink;
      if (diskSupported) {
        try {
          const handle = await showSaveFilePicker({ suggestedName: spec.name });
          const writable = await handle.createWritable();
          sink = { write: data => writable.write(data), close: async () => { await writable.close(); return null; }, abort: () => writable.abort() };
        } catch (error) {
          // Cancelling the dialog must cancel reception, rather than silently accepting.
          if (!['NotAllowedError', 'SecurityError', 'NotSupportedError', 'TypeError'].includes(error.name)) throw error;
          sink = memorySink(spec, row);
          notice('Браузер не разрешил запись в выбранный файл. После приёма нажмите «Сохранить файл».');
        }
      }
      sink ||= memorySink(spec, row);
      await link.accept(spec.id, sink); row.actions.replaceChildren(); cancelButton(spec.id, row.actions);
    } catch (error) { link.cancel(spec.id, error.name === 'AbortError' ? 'Сохранение отменено.' : error.message); }
  }, true), button('Отклонить', () => link.cancel(spec.id, 'Файл отклонён.')));
}
async function reportTransfer(id, size) {
  return reportStatistics('record-transfer', { id, size });
}
async function reportUsage() {
  return reportStatistics('record-usage');
}
async function reportStatistics(action, extra = {}) {
  // Snapshot credentials; statistics failures must never fail a completed file.
  const body = JSON.stringify({ action, room: session.room, token: session.token, ...extra });
  for (const delay of [0, 1500, 5000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      const response = await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', keepalive: true, signal: AbortSignal.timeout(10000), body });
      if (response.ok) { document.dispatchEvent(new Event(action === 'record-usage' ? 'nearby-connection-complete' : 'nearby-transfer-complete')); return; }
      if (response.status < 500 && response.status !== 429) return;
    } catch { /* Retry transient failures while the tab remains open. */ }
  }
}
function complete(id, direction, blob) {
  const row = rows.get(id); if (!row || row.done) return;
  row.done = true; row.progress.value = row.progress.max; row.actions.replaceChildren();
  row.detail.textContent = direction === 'sent' ? 'Передан получателю.' : blob ? 'Файл принят. Нажмите «Сохранить файл».' : 'Сохранён в выбранный файл.';
  if (direction === 'received') void reportTransfer(id, row.size);
  if (blob) {
    const url = URL.createObjectURL(blob); objectUrls.add(url);
    const save = document.createElement('a'); save.className = 'button primary'; save.href = url; save.download = row.element.querySelector('.transfer-title').textContent; save.textContent = 'Сохранить файл ↓'; row.actions.append(save);
    row.actions.append(button('Убрать из памяти', () => { URL.revokeObjectURL(url); objectUrls.delete(url); row.releaseMemory?.(); row.actions.replaceChildren(); row.detail.textContent = 'Файл удалён из памяти вкладки.'; }));
  }
}
async function sendFiles(files) {
  if (!link?.peerLimit || sending || stopped) return;
  sending = true; $('files').disabled = true; $('drop').classList.add('disabled');
  try {
    for (const file of files) {
      if (stopped) break;
      const id = crypto.randomUUID();
      try {
        validateFileSpec({ id, name: file.name, size: file.size }, link.peerLimit);
        const row = rowFor({ id, name: file.name, size: file.size }, 'outgoing'); cancelButton(id, row.actions);
        await link.sendFile(file, id);
      } catch (error) { if (!rows.has(id)) notice(`${file.name}: ${error.message}`, true); }
    }
  } finally { sending = false; $('files').value = ''; if (!stopped && link?.peerLimit) { $('files').disabled = false; $('drop').classList.remove('disabled'); } }
}
function failConnection(message) { notice(message, true); status('Соединение завершено', 'Нажмите «Новое подключение», чтобы попробовать снова.'); stopLocal(); }
function stopLocal() {
  stopped = true; clearTimeout(pollTimer); clearTimeout(connectionTimer);
  link?.close(); peer?.close(); relayChannel?.close(); if (session) session.relaySecret = null;
  $('files').disabled = true; $('drop').classList.add('disabled');
  $('peer-request').hidden = true; $('invitation').hidden = true; $('transport-label').textContent = 'Не подключено';
  $('disconnect').textContent = 'Новое подключение';
}
$('create').onclick = create;
$('join-form').onsubmit = event => { event.preventDefault(); join($('invite-input').value.trim()); };
$('join-invite').onclick = () => join(joinInvite);
$('approve').onclick = async () => { $('approve').disabled = true; try { await api('approve'); $('peer-request').hidden = true; } catch (error) { notice(error.message, true); $('approve').disabled = false; } };
$('reject').onclick = async () => { try { await api('close'); } catch {} failConnection('Подключение отклонено.'); };
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(invitation); $('copy').textContent = 'Ссылка скопирована ✓'; }
  catch { $('share-link').focus(); $('share-link').select(); notice('Скопируйте выделенную ссылку.'); }
};
$('disconnect').onclick = async () => { if (stopped) { location.href = location.pathname; return; } try { await api('close'); } catch {} failConnection('Соединение завершено. Принятые файлы можно сохранить ниже.'); };
$('files').onchange = event => sendFiles(Array.from(event.target.files));
for (const type of ['dragover', 'dragleave', 'drop']) $('drop').addEventListener(type, event => { event.preventDefault(); $('drop').classList.toggle('drag', type === 'dragover' && !sending); if (type === 'drop') sendFiles(Array.from(event.dataTransfer.files)); });
document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => event.preventDefault());
window.addEventListener('beforeunload', event => { if (sending || Array.from(rows.values()).some(row => !row.done)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { stopLocal(); for (const url of objectUrls) URL.revokeObjectURL(url); });
$('save-hint').textContent = diskSupported ? 'При приёме выберите, куда сохранить файл. Запись идёт частями, без загрузки всего файла в память.' : 'В этом браузере: до 100 МиБ на файл. После приёма нажмите «Сохранить файл». Сохраняйте файлы перед закрытием вкладки.';
function describeMode() {
  const internet = $('connection-mode').value === 'internet';
  $('mode-help').textContent = internet ? 'Для разных Wi-Fi и мобильного интернета. До 100 МиБ на файл; оба устройства остаются онлайн. Зашифрованные части временно проходят через сервер.' : 'Для устройств в одной доступной локальной сети. Файлы идут напрямую через WebRTC.';
}
$('connection-mode').addEventListener('change', describeMode);
const initialParams = new URLSearchParams(location.hash.slice(1));
if (initialParams.get('mode') === 'internet' || !window.RTCPeerConnection) $('connection-mode').value = 'internet';
describeMode();
if (!window.isSecureContext || !crypto.subtle) { notice('Откройте Nearby по HTTPS в современном браузере. На Windows рекомендуем Chrome или Edge.', true); $('create').disabled = true; $('join-form').hidden = true; }
else if (initialParams.has('room')) {
  try { const invite = parseInvite(location.href); $('connection-mode').value = invite.mode; describeMode(); joinInvite = location.href; history.replaceState(null, '', location.pathname); $('create').hidden = true; $('join-form').hidden = true; document.querySelector('.divider').hidden = true; $('join-invite').hidden = false; $('start').querySelector('h2').textContent = 'Вас пригласили в Nearby'; }
  catch (error) { notice(error.message, true); history.replaceState(null, '', location.pathname); }
} else if (location.hash) history.replaceState(null, '', location.pathname);
