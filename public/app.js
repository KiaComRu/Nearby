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
window.nearbyUpdateBusy = () => sending || !state ||
  state.offers.some(offer => ['pending', 'accepted', 'uploading'].includes(offer.state)) ||
  [...records.values()].some(record => record.nativeDownloadStatus) ||
  document.querySelector('#shell-send')?.open === true || internetClient.busy() || internetBufferedBytes > 0;
let peerMode = false;
let connectionAvailable = false;
let joinMode = false;
let refreshing;
let discoverySignature = '', discoveryRefreshing = false, diagnoseGeneration = 0;
const selectedDiscoveryAddresses = new Map();
let trustState = { enabled: false, devices: [], requests: [] }, discoveredDevices = [], trustSignature = '', trustRefreshing = false;
const incomingSeen = new Set(), automaticDownloads = new Map();
const nativeDownloads = new Map();
let nativeDownloadQueue = Promise.resolve();
const pairingSeen = new Set();
let downloadedShares = new Set();
try { downloadedShares = new Set(JSON.parse(sessionStorage.getItem('nearby-downloaded-shares') || '[]')); } catch {}
let targets = [], lanTargets = [], selectedTargetId = '', selectionLost = false, previousDeviceCount = 0, deviceSignature = '', remoteState = null;
const records = new Map(), hiddenRecords = new Set(), nativeFiles = new Set(), nativePending = new Map(), nativePreviewPending = new Map();
let recordSequence = 0;
try { for (const key of JSON.parse(sessionStorage.getItem('nearby-hidden-records') || '[]')) hiddenRecords.add(key); } catch {}
const selectedTarget = () => targets.find(target => target.id === selectedTargetId);
const targetPrefix = target => target?.kind === 'peer' ? '/api/peer/remote' : '';
const nativeBridge = window.chrome?.webview;
let internetBufferedBytes = 0;
const internetUI = {invitation:null,liveSignature:'',expiryTimer:null};
const internetRecord = (connection,id) => [...records.values()].find(record=>record.internetRoom===connection.id&&record.internetFileId===id);
const channelName = target => !target.ready ? 'Восстанавливаем связь' : target.transport === 'direct' ? 'WebRTC · напрямую' : 'Интернет · сквозное шифрование';
const internetClient = new window.NearbyInternet.Client({
  request:(action,extra,session)=>api('/api/internet',{method:'POST',data:{action,...(session?{room:session.room,token:session.token}:{}),...extra}}),
  onChange:()=>{if(state){targets=[...lanTargets,...internetClient.targets()];renderConnection();renderInternet();}},
  onNotice:text=>{$('internet-status').textContent=text;},
  onStatus:(connection,title,detail)=>{if(internetClient.pending===connection)$('internet-status').textContent=title+'. '+detail;},
  onInvitation:(connection,invite)=>{
    internetUI.invitation=invite;$('internet-code').textContent=invite.id;$('internet-link').value=invite.url;
    $('internet-expiry').textContent='Одно приглашение · 15 минут';$('internet-copy-id').disabled=false;$('internet-copy-link').disabled=false;
    void window.NearbyInternet.drawQR($('internet-qr'),invite.url).catch(()=>{$('internet-status').textContent='Используйте ID или ссылку: QR-код недоступен.';});
    clearTimeout(internetUI.expiryTimer);internetUI.expiryTimer=setTimeout(()=>{$('internet-expiry').textContent='Приглашение истекло. Создайте новое.';$('internet-copy-id').disabled=true;$('internet-copy-link').disabled=true;},Math.max(0,invite.expires*1000-Date.now()));
    $('internet-status').textContent='Ожидаем другое устройство.';renderInternet();$('internet-invitation').scrollIntoView({block:'nearest'});
  },
  onPeerRequest:(connection,name)=>{$('internet-peer').textContent=name;$('internet-approval').hidden=false;},
  onApproved:()=>{internetUI.invitation=null;clearTimeout(internetUI.expiryTimer);$('internet-approval').hidden=true;$('internet-invitation').hidden=true;},
  onReady:connection=>{internetUI.invitation=null;clearTimeout(internetUI.expiryTimer);$('internet-approval').hidden=true;$('internet-status').textContent=`${connection.transport==='direct'?'Подключено напрямую':'Подключено через интернет'}: ${connection.peerName}.`;},
  onOffer:(connection,spec,link)=>{void receiveInternetFile(connection,spec,link);},
  onProgress:(connection,id,bytes,direction)=>{
    const record=internetRecord(connection,id);if(record){record.received=bytes;record.status=`${direction==='sending'?'Отправляем':'Принимаем'}: ${sizes(bytes)} / ${sizes(record.size)}`;rendered='';renderTransfers();}
    if(connection.extraProgress?.id===id)connection.extraProgress.onProgress?.(bytes);
  },
  onComplete:(connection,id,direction)=>{
    const record=internetRecord(connection,id);if(!record)return;record.busy=false;record.status=direction==='sent'?'Передан получателю':'Получено и сохранено';
    if(direction==='received')void connection.reportStatistics('record-transfer',{id,size:record.size});rendered='';renderTransfers();
  },
  onError:(connection,id,text)=>{const record=internetRecord(connection,id);if(record){record.busy=false;record.failed=true;record.status=text;rendered='';renderTransfers();}},
  onClosed:(connection,text,expected)=>{if(!internetClient.pending){internetUI.invitation=null;clearTimeout(internetUI.expiryTimer);$('internet-approval').hidden=true;$('internet-status').textContent=text;}if(!expected)message(text);}
});

function renderInternet() {
  if(!state)return;
  const mode=$('connection-mode').value;
  $('internet-shortcuts').hidden=!state.admin||mode!=='lan';
  $('internet-option').hidden=!state.admin||mode==='lan';
  $('back-local').hidden=mode==='auto';
  $('invitation-help').textContent=mode==='internet'
    ? 'Приглашение использует зашифрованный интернет-канал. До 100 МиБ на файл; принятые файлы сохраняются в папку Nearby. Настройка применяется к новым приглашениям.'
    : 'Подключите ПК или телефон по ID, ссылке или QR. Nearby выбирает прямое соединение, а если оно недоступно — зашифрованный интернет-канал. Для создания приглашения нужен доступ к сайту. До 100 МиБ на файл; принятые файлы сохраняются в папку Nearby.';
  if(!$('internet-name').value)$('internet-name').value=state.computerName||'Компьютер';
  const pending=internetClient.pending,busy=Boolean(pending||internetClient.working)||!state.admin;
  $('internet-create').disabled=busy;$('internet-join').disabled=busy;$('internet-id').disabled=busy;$('internet-name').disabled=busy;
  $('internet-invitation').hidden=!pending||pending.session.role!=='host'||!internetUI.invitation;
  $('internet-stop').hidden=!pending;$('internet-stop').disabled=internetClient.working;
  const connected=internetClient.targets(),signature=JSON.stringify(connected);
  if(signature!==internetUI.liveSignature){
    internetUI.liveSignature=signature;$('internet-connections').replaceChildren();
    for(const target of connected){const item=document.createElement('div');item.className='internet-connected';const name=document.createElement('span');name.textContent=target.name+' · '+channelName(target);item.append(name,button('Отключить',()=>internetClient.disconnect(target),true));$('internet-connections').append(item);}
  }
}
async function receiveInternetFile(connection,spec,link) {
  const key=`internet:${connection.id}:${spec.id}`,record=keepRecord(key,{name:spec.name,size:spec.size,direction:'incoming',device:connection.peerName,internet:true,internetRoom:connection.id,internetFileId:spec.id,busy:true,status:'Подготавливаем приём',received:0});
  window.NearbyWorkspace.incoming();rendered='';renderTransfers();
  let reservation,parts=[],reserved=false,finished=false;const controller=new AbortController();
  const release=()=>{parts=[];if(reserved){internetBufferedBytes-=spec.size;reserved=false;}};
  const abort=async()=>{controller.abort();release();if(reservation&&!finished)await api(`/api/internet/receives/${reservation.id}/cancel`,{method:'POST',data:{}}).catch(()=>{});};
  try{
    if(internetBufferedBytes+spec.size>100*1024**2)throw new Error('Дождитесь завершения текущего интернет-приёма.');
    internetBufferedBytes+=spec.size;reserved=true;
    reservation=await api('/api/internet/receives',{method:'POST',data:{name:spec.name,size:spec.size,room:connection.id,device:connection.peerName}});
    record.serverId=reservation.id;record.serverKind='offer';records.delete('offer:'+reservation.id);
    if(connection.stopped||link.closed)throw new Error('Интернет-соединение закрыто.');
    await link.accept(spec.id,{
      write:async data=>{parts.push(data);},
      close:async()=>{
        try{const blob=new Blob(parts);parts=[];record.status='Сохраняем файл на компьютере…';rendered='';renderTransfers();
          const response=await fetch(`/api/internet/receives/${reservation.id}/upload`,{method:'POST',headers:{Authorization:`Bearer ${authToken}`},body:blob,signal:controller.signal});
          const result=await response.json();if(!response.ok)throw new Error(result.error||'Файл не сохранён.');
          finished=true;record.localStored=true;return null;
        }finally{release();}
      },abort
    });
  }catch(error){await abort();link.cancel(spec.id,error.message||'Не удалось принять интернет-файл.');}
}
function registerNativeFile(id, index, input = 'files') {
  if (!nativeBridge) return Promise.resolve(false);
  return new Promise(resolve => {
    const timer = setTimeout(() => { nativePending.delete(id); resolve(false); }, 5000);
    nativePending.set(id, result => { clearTimeout(timer); resolve(result); });
    nativeBridge.postMessage({ type: 'nearby-register-file', id, index, input });
  });
}
nativeBridge?.addEventListener('message', event => {
  const value = event.data;
  if (value?.type === 'nearby-desktop-settings') {
    $('receive-notifications').checked = value.receiveNotifications === true;
    $('receive-notifications').disabled = false;
    $('receive-notifications-hint').textContent = value.saved === false ? 'Не удалось сохранить настройку. Повторите попытку.' : 'Показывать всплывающее уведомление после сохранения файла, когда Nearby свёрнут в трей.';
  }
  if (value?.type === 'nearby-file-registered') { nativePending.get(value.id)?.(value.ok); nativePending.delete(value.id); if (value.ok) nativeFiles.add(value.id); }
  if (value?.type === 'nearby-download-complete') {
    const pending = nativeDownloads.get(value.id);
    if (value.ok) nativeFiles.add(value.id);
    if (pending) {
      if (value.ok) pending.resolve();
      else pending.reject(new Error(value.error || 'Не удалось сохранить файл.'));
    }
  }
  if (value?.type === 'nearby-file-preview') { nativePreviewPending.get(value.id)?.(value); nativePreviewPending.delete(value.id); }
});
if (nativeBridge) {
  $('desktop-notifications').hidden = false;
  nativeBridge.postMessage({ type: 'nearby-desktop-settings', id: 'desktop-settings' });
  $('receive-notifications').addEventListener('change', () => {
    $('receive-notifications').disabled = true;
    nativeBridge.postMessage({ type: 'nearby-desktop-settings', id: 'desktop-settings', receiveNotifications: $('receive-notifications').checked });
  });
}
function nativePreview(id) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { nativePreviewPending.delete(id); resolve(null); }, 10_000);
    nativePreviewPending.set(id, value => {
      clearTimeout(timer);
      if (!value.base64 || value.base64.length > 12 * 1024 * 1024) { resolve(null); return; }
      try { const bytes = Uint8Array.from(atob(value.base64), char => char.charCodeAt(0)); resolve(new Blob([bytes])); } catch { resolve(null); }
    });
    nativeBridge.postMessage({ type: 'nearby-file-preview', id });
  });
}
function filePreview(record) {
  record.preview ||= window.NearbyFilePresentation.preview(record.name);
  const nativeId = nativeFiles.has(record.key) ? record.key : nativeFiles.has(record.serverId) ? record.serverId : null;
  if (record.size <= window.NearbyFilePresentation.maxPreviewBytes) {
    if (record.file) void record.preview.load(record.file);
    else if (record.localStored || (!state.admin && !record.target && (record.serverKind === 'share' || record.state === 'completed'))) void record.preview.load(async () => {
      const response = await fetch(`/api/files/preview?kind=${encodeURIComponent(record.serverKind)}&id=${encodeURIComponent(record.serverId)}`, { headers: { Authorization: `Bearer ${authToken}` } });
      return response.ok ? response.blob() : null;
    });
    else if (nativeBridge && nativeId) void record.preview.load(() => nativePreview(nativeId));
  }
  return record.preview.element;
}
const confirmationControl = $('confirm-invitation');
try { confirmationControl.checked = localStorage.getItem('nearby.confirm-invitation') === 'true'; } catch {}
confirmationControl.addEventListener('change', () => { try { localStorage.setItem('nearby.confirm-invitation', String(confirmationControl.checked)); } catch {} if (!confirmationControl.checked) attemptAutoJoin(); });
let autoJoinTried = false;
function attemptAutoJoin() {
  if (!authToken && !autoJoinTried && !confirmationControl.checked && /^[0-9]{6}$/.test(suggestedPin || '')) { autoJoinTried = true; $('join-form').requestSubmit(); }
}


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
  pending: 'Подготовка приёма', accepted: 'Готов к приёму',
  uploading: 'Получение', completed: 'Получено и сохранено',
  rejected: 'Получатель отклонил файл', expired: 'Время ожидания истекло', failed: 'Передача прервана',
};

async function api(url, { method = 'GET', data, anonymous = false, target } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method, signal: controller.signal,
      headers: { ...(anonymous ? {} : { Authorization: `Bearer ${authToken}` }),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(target?.kind === 'peer' ? { 'X-Nearby-Peer': target.id } : {}) },
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

function renderDevices() {
  if (!targets.some(target => target.id === selectedTargetId)) {
    if (selectedTargetId) { selectedTargetId = ''; selectionLost = true; }
    if (!selectionLost && targets.length === 1) selectedTargetId = targets[0].id;
  }
  window.NearbyWorkspace.setDevices(targets.length);
  window.NearbyWorkspace.setConnected(connectionAvailable && targets.length > 0);
  const signature = JSON.stringify([targets, selectedTargetId, sending]);
  if (signature !== deviceSignature) {
    deviceSignature = signature; $('device-list').replaceChildren();
    for (const target of targets) {
      const card = document.createElement('label'); card.className = 'device-target';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'send-target'; radio.value = target.id; radio.checked = target.id === selectedTargetId; radio.disabled = sending;
      radio.addEventListener('change', () => { selectedTargetId = target.id; selectionLost = false; renderConnection(); });
      const info = document.createElement('span'), name = document.createElement('strong'), transport = document.createElement('small');
      name.textContent = target.name; name.className = 'device-name'; transport.textContent = target.kind === 'internet' ? channelName(target) : target.secure ? 'TLS · защищённое соединение' : 'Локальная сеть'; info.append(name, transport); card.append(radio, info); $('device-list').append(card);
    }
  }
  const target = selectedTarget();
  $('recipient-name').textContent = target?.name || 'Устройство не выбрано'; $('devices-transfer').disabled = !target || sending;
  $('files').disabled = !connectionAvailable || !target || target.ready === false || sending; $('drop').classList.toggle('disabled', !target || target.ready === false || sending);
  $('select-remaining').hidden = Boolean(target) || targets.length !== 1;
  if (!$('select-remaining').hidden) $('remaining-name').textContent = targets[0].name;
  if (targets.length > previousDeviceCount && targets.length > 1 && !sending) window.NearbyWorkspace.selectTab('devices');
  previousDeviceCount = targets.length;
}
function renderConnection() {
  renderDevices();
  const connected = connectionAvailable && targets.length > 0;
  $('intro-title').firstChild.nodeValue = connected ? 'Можно передавать файлы' : 'Сначала подключимся';
  $('intro-description').textContent = connected ? 'Выберите получателя и файлы. Приём начнётся автоматически.' : 'Подключите устройства один раз — передавайте без подтверждения каждого файла.';
  $('transfer-workspace').hidden = !connected && records.size === 0;
  $('connection-status').hidden = !connected;
  if (connected) $('connection-status').textContent = `Подключено: ${targets.map(target => target.name).join(', ')}.`;
}

function showTrustedPanel() {
  return (state?.admin || state?.localAdmin) && trustState.enabled && (trustState.devices.length > 0 || trustState.requests.length > 0);
}

function render() {
  renderConnection();
  for(const mode of ['auto','internet'])$('connection-mode').querySelector(`option[value=${mode}]`).disabled=!state.admin;
  setConnectionMode(state.admin?$('connection-mode').value:'lan');
  $('join').hidden = true; $('workspace').hidden = false;
  $('connection').hidden = !state.admin || $('connection-mode').value!=='lan';
  $('received-location').hidden = !(state.admin || state.localAdmin) || !state.receivedDirectory;
  $('pc-connect').hidden = !(state.admin || state.localAdmin);
  $('connected-devices').replaceChildren();
  const devices = targets;
  for (const device of devices) {
    const item = document.createElement('div'); item.className = 'connected-device';
    item.textContent = `${device.name} · ${device.kind === 'internet' ? channelName(device) : device.secure ? 'TLS' : 'Локальная сеть'}`;
    $('connected-devices').append(item);
  }
  if (!devices.length) empty($('connected-devices'), 'Пока нет подключений.');
  $('pc-connect-form').hidden = peerMode;
  $('pc-connect-hint').hidden = peerMode;
  $('pc-connected').hidden = !peerMode;
  $('discovery').hidden = !state.admin || peerMode;
  $('pc-diagnose').hidden = peerMode;
  $('secure-pair').hidden = peerMode || !trustState.enabled;
  $('legacy-hint').hidden = peerMode;
  $('trusted-panel').hidden = !showTrustedPanel();
  $('pc-transport').textContent = state.peer?.secure ? 'Защищённое соединение · TLS 1.3 · ключ устройства проверен' : 'Подключение по PIN · HTTP · доверенная локальная сеть';
  $('pc-peer-address').textContent = state.peer?.origin || '';
  if (state.admin || state.localAdmin) $('received-path').textContent = state.receivedDirectory || '';
  if (state.admin) {
    $('shown-pin').textContent = state.pin;
    $('send-title').textContent = 'Отправка файлов';
    $('send-description').textContent = 'Подключённые устройства начнут получение автоматически.';
    $('receive-title').textContent = 'Получение файлов';
    $('receive-description').textContent = 'Файлы сохраняются автоматически после подключения.';
    $('save-hint').textContent = 'Принятые файлы — в папке Nearby.';
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
    $('send-description').textContent = 'Приём на другом компьютере начнётся автоматически.';
    $('receive-title').textContent = 'Получение файлов';
    $('receive-description').textContent = 'Получение начинается без дополнительного подтверждения.';
    $('save-hint').textContent = 'Оставьте Nearby открытым до завершения передачи.';
  }
  renderTransfers();
}
function keepRecord(key, data) {
  if (hiddenRecords.has(key)) return null;
  const previous = records.get(key) || { key, created: Date.now() };
  Object.assign(previous, data); records.set(key, previous); return previous;
}
function renderTransfers() {
  if (!state) return;
  const queuedShares = new Set([...records.values()].filter(record => record.localSend && record.serverKind === 'share').map(record => record.serverId));
  const queuedOffers = new Set([...records.values()].filter(record => record.localSend && record.serverKind === 'offer').map(record => record.serverId));
  for (const share of state.shares) {
    if (state.admin && queuedShares.has(share.id)) {
      for (const record of records.values()) if (record.localSend && record.serverId === share.id) { record.status = share.state === 'completed' ? 'Передан получателю' : share.state === 'downloading' ? 'Получатель скачивает файл' : share.state === 'failed' ? 'Передача прервана' : 'Ожидаем получение устройством'; record.busy = share.state === 'downloading'; }
      continue;
    }
    const record = keepRecord(`share:${share.id}`, { ...share, serverId: share.id, serverKind: 'share', direction: state.admin ? 'outgoing' : 'incoming', device: share.recipientName || (state.admin ? 'Подключённые устройства' : 'Компьютер'), status: state.admin ? share.state === 'completed' ? 'Передан получателю' : 'Ожидаем получение устройством' : downloadedShares.has(share.id) ? 'Загрузка началась автоматически' : 'Готов к получению', created: share.created || records.get(`share:${share.id}`)?.created || Date.now(), localStored: state.admin, busy: share.state === 'downloading' });
    if (record && !state.admin) receiveShare(record);
  }
  for (const offer of state.offers) {
    if (offer.internet && [...records.values()].some(record=>record.internet && record.serverId===offer.id)) continue;
    if (!state.admin && queuedOffers.has(offer.id)) continue;
    const key = `offer:${offer.id}`;
    const record = keepRecord(key, { ...offer, serverId: offer.id, serverKind: 'offer', direction: state.admin ? 'incoming' : 'outgoing', status: statusNames[offer.state] || offer.state, localStored: state.admin && offer.state === 'completed', busy: ['pending','accepted','uploading'].includes(offer.state), failed: ['failed','rejected','expired'].includes(offer.state) });
    if (record && !incomingSeen.has(key) && record.direction === 'incoming') { incomingSeen.add(key); window.NearbyWorkspace.incoming(); }
  }
  const peerTarget = targets.find(target => target.kind === 'peer');
  if (remoteState && peerTarget) for (const share of remoteState.shares) {
    const key = `peer-share:${peerTarget.id}:${share.id}`;
    const record = keepRecord(key, { ...share, serverId: share.id, serverKind: 'share', direction: 'incoming', device: peerTarget.name, target: peerTarget, status: downloadedShares.has(share.id) ? 'Загрузка началась автоматически' : 'Готов к получению', created: share.created || records.get(key)?.created || Date.now() });
    if (record) receiveShare(record);
  }
  if (remoteState && peerTarget) for (const offer of remoteState.offers) {
    if ([...records.values()].some(record => record.localSend && record.serverKind === 'offer' && record.serverId === offer.id)) continue;
    keepRecord(`peer-offer:${peerTarget.id}:${offer.id}`, { ...offer, serverId: offer.id, serverKind: 'offer', direction: 'outgoing', device: peerTarget.name, target: peerTarget, status: statusNames[offer.state] || offer.state, busy: ['pending','accepted','uploading'].includes(offer.state), failed: ['failed','rejected','expired'].includes(offer.state) });
  }
  for (const record of records.values()) { if (record.nativeDownloadStatus) record.status = record.nativeDownloadStatus; if (record.downloadError) record.status = record.downloadError; if (nativeFiles.has(record.serverId)) record.status = 'Получено и сохранено'; }
  const signature = JSON.stringify([...records.values()].map(({ key, status, busy, failed, received, serverId, localStored }) => [key, status, busy, failed, received, serverId, localStored, nativeFiles.has(key), nativeFiles.has(serverId)]));
  if (signature === rendered) return; rendered = signature;
  for (const body of [$('queue'), $('incoming'), $('shared')]) for (const element of [...body.children]) if (!records.has(element.dataset.record)) element.remove();
  for (const record of records.values()) {
    // Keep the status button in place: polling/progress must preserve keyboard focus and an open tooltip.
    if (!record.ui) {
      const element = document.createElement('tr'); element.className = 'file-row transfer'; element.dataset.record = record.key;
      const name = document.createElement('td'), title = document.createElement('div'), device = document.createElement('div'); title.className = 'file-name transfer-title'; title.textContent = record.name; device.className = 'transfer-peer'; device.textContent = record.device || '';
      const file = document.createElement('div'), info = document.createElement('div'); file.className = 'transfer-file'; info.className = 'transfer-file-info'; info.append(title, device); file.append(filePreview(record), info); name.append(file);
      const size = document.createElement('td'); size.className = 'transfer-size'; size.textContent = sizes(record.size);
      const date = document.createElement('td'), time = document.createElement('time'); time.dateTime = new Date(record.created).toISOString(); time.textContent = new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'medium' }).format(record.created); date.append(time);
      const detail = document.createElement('div'); detail.className = 'file-meta transfer-detail'; const status = window.NearbyFilePresentation.status(detail);
      const actions = status.querySelector('.transfer-file-actions');
      const open = window.NearbyFilePresentation.icon(button('', () => openRecord(record), true), 'open', 'Открыть'); open.classList.add('open-transfer'); actions.append(open);
      const remove = button('×', () => {
        hiddenRecords.add(record.key);
        if (record.serverId) { hiddenRecords.add(`${record.serverKind}:${record.serverId}`); if (record.target) { hiddenRecords.add(`peer-offer:${record.target.id}:${record.serverId}`); hiddenRecords.add(`peer-share:${record.target.id}:${record.serverId}`); } }
        try { sessionStorage.setItem('nearby-hidden-records', JSON.stringify([...hiddenRecords].slice(-2000))); } catch {}
        if (record.url) URL.revokeObjectURL(record.url); record.preview?.dispose(); window.NearbyFilePresentation.closeStatus(); record.file = null; records.delete(record.key); rendered = ''; renderTransfers();
      }, true); remove.classList.add('remove-transfer'); window.NearbyFilePresentation.icon(remove, 'close', 'Удалить из списка'); actions.append(remove);
      element.append(name, size, date, status);
      $(record.direction === 'outgoing' ? 'queue' : record.target || !state.admin ? 'shared' : 'incoming').prepend(element);
      record.ui = { element, info, detail, device, open, remove };
    }
    const ui = record.ui; filePreview(record);
    if (ui.detail.textContent !== record.status) ui.detail.textContent = record.status;
    if (ui.device.textContent !== (record.device || '')) ui.device.textContent = record.device || '';
    ui.element.classList.toggle('error', Boolean(record.failed));
    let progress = ui.info.querySelector('progress');
    if (record.busy) {
      if (!progress) { progress = document.createElement('progress'); progress.setAttribute('aria-label', 'Прогресс передачи'); ui.info.append(progress); }
      progress.max = record.size || 1; progress.value = record.received || 0;
    } else progress?.remove();
    ui.open.disabled = Boolean(record.busy || (record.failed && record.serverKind !== 'share') || !(record.localStored || record.file || record.serverKind === 'share'));
    ui.remove.disabled = Boolean(record.busy);
  }
}
function receiveShare(record) {
  if (downloadedShares.has(record.serverId) || automaticDownloads.has(record.serverId)) return;
  automaticDownloads.set(record.serverId, true);
  void downloadShare(record).catch(error => { record.status = error.message; record.downloadError = error.message; record.failed = true; rendered = ''; renderTransfers(); });
}
function rememberDownloaded(id) {
  downloadedShares.add(id);
  try { sessionStorage.setItem('nearby-downloaded-shares', JSON.stringify([...downloadedShares].slice(-200))); } catch {}
}
async function downloadShare(record) {
  if (nativeBridge && record.target?.kind === 'peer') {
    if (record.nativeDownloadStatus || nativeFiles.has(record.serverId)) return;
    record.busy = true; record.failed = false; record.downloadError = null; record.nativeDownloadStatus = 'В очереди на получение';
    const save = nativeDownloadQueue.then(async () => {
      record.nativeDownloadStatus = 'Сохраняем файл…'; rendered = ''; renderTransfers();
      const ticket = await api(targetPrefix(record.target) + `/api/shares/${record.serverId}/ticket`, { method: 'POST', target: record.target });
      await new Promise((resolve, reject) => {
        nativeDownloads.set(record.serverId, { resolve, reject });
        nativeBridge.postMessage({ type: 'nearby-save-share', id: record.serverId, url: ticket.url, name: record.name, size: record.size });
      });
      rememberDownloaded(record.serverId);
      window.NearbyWorkspace.incoming();
    }).catch(error => {
      record.downloadError = error.message; record.failed = true; throw error;
    }).finally(() => { nativeDownloads.delete(record.serverId); record.nativeDownloadStatus = null; record.busy = false; rendered = ''; renderTransfers(); });
    nativeDownloadQueue = save.catch(() => {});
    return save;
  }
  const ticket = await api(targetPrefix(record.target) + `/api/shares/${record.serverId}/ticket`, { method: 'POST', target: record.target });
  const link = document.createElement('a'); link.href = ticket.url + '&nearbyFile=' + encodeURIComponent(record.serverId); link.download = record.name; document.body.append(link); link.click(); link.remove();
  rememberDownloaded(record.serverId);
  record.failed = false; record.downloadError = null; record.status = 'Загрузка началась автоматически'; window.NearbyWorkspace.incoming(); rendered = ''; renderTransfers();
}
async function openRecord(record) {
  const nativeId = nativeFiles.has(record.key) ? record.key : nativeFiles.has(record.serverId) ? record.serverId : null;
  if (nativeBridge && nativeId) { nativeBridge.postMessage({ type: 'nearby-open-file', id: nativeId }); return; }
  if (record.localStored) { await api('/api/files/open', { method: 'POST', data: { kind: record.serverKind, id: record.serverId } }); return; }
  if (record.file) {
    record.url ||= URL.createObjectURL(record.file); const link = document.createElement('a'); link.href = record.url; link.download = record.name; link.click(); return;
  }
  await downloadShare(record);
}

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const result = await api('/api/state'); state = result; peerMode = Boolean(result.peerConnection); remoteState = null;
    if (result.admin) {
      const responses = await Promise.allSettled([api('/api/send-targets'), peerMode ? api('/api/peer/remote/api/state', { target: { ...result.peerConnection, kind: 'peer' } }) : Promise.resolve(null)]);
      lanTargets = responses[0].status === 'fulfilled' ? responses[0].value.targets : [];
      if (responses[1].status === 'fulfilled') remoteState = responses[1].value;
      else message(responses[1].reason.message || 'Нет связи с другим ПК.');
      state.peer = remoteState?.peer || result.peerConnection;
    } else lanTargets = [{ id: 'host', kind: 'host', name: 'Компьютер', maxSize: result.maxSize }];
    targets = [...lanTargets,...(state.admin ? internetClient.targets() : [])];
    connectionAvailable = true; render();
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function poll() {
  if (authToken) {
    try { await refresh(); if (state?.admin || state?.localAdmin) await refreshTrust(); if (state?.admin && !peerMode) await refreshDiscovery(); }
    catch (error) {
      connectionAvailable = false; renderConnection();
      if (error.status === 401) {
        authToken = ''; sessionStorage.removeItem('nearby-token');
        $('workspace').hidden = true; $('join').hidden = false;
        message(adminLink ? 'Откройте новую ссылку владельца из консоли приложения.' : 'Сеанс истёк или компьютер перезапущен. Введите новый PIN.'); attemptAutoJoin();
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
      listening: result.devices.length ? `Найдено компьютеров: ${result.devices.length}. Выберите нужный.` : 'Откройте Nearby на другом компьютере в этой сети.',
      'no-network': 'Нет доступной локальной IPv4-сети. Подключите ПК к Wi-Fi или Ethernet; поиск обновится автоматически.',
      unavailable: result.errorCode === 'EADDRINUSE' ? 'Порт поиска занят. Подключитесь по адресу; поиск повторится автоматически.' : 'Поиск устройств недоступен. Проверьте сеть и разрешение Nearby в брандмауэре. Можно подключиться по адресу.',
      disabled: 'Автопоиск отключён в этом запуске. Подключитесь по адресу.',
    };
    $('discovery-state').textContent = statuses[result.status] || 'Не удалось получить состояние поиска.';
    $('discovery-empty').hidden = result.devices.length > 0;
    $('discovery-name').textContent = result.name ? `Этот ПК виден в сети как «${result.name}». PIN и имена файлов в поиске не передаются.` : '';
    const signature = JSON.stringify(result.devices);
    if (signature === discoverySignature) return;
    discoverySignature = signature; $('nearby-devices').replaceChildren();
    const aliveIds = new Set(result.devices.map(device => device.id));
    for (const id of selectedDiscoveryAddresses.keys()) if (!aliveIds.has(id)) selectedDiscoveryAddresses.delete(id);
    for (const device of result.devices) {
      const item = row(device.name, `Nearby ${device.version}`);
      item.element.className = 'device-card';
      item.element.setAttribute('role', 'group');
      item.element.setAttribute('aria-label', device.name);
      item.element.dataset.deviceId = device.id;
      item.element.querySelector('.file-icon').innerHTML = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="9" y="10" width="46" height="33" rx="4"/><path d="M24 54h16M32 43v11M16 35h32"/><circle cx="32" cy="38.5" r=".8" fill="currentColor" stroke="none"/></svg>';
      const addresses = document.createElement('select'); addresses.className = 'discovery-address';
      addresses.setAttribute('aria-label', `Адрес устройства ${device.name}`);
      const score = origin => new URL(origin).hostname.startsWith('192.168.') ? 0 : new URL(origin).hostname.startsWith('10.') ? 1 : 2;
      for (const origin of [...device.origins].sort((a, b) => score(a) - score(b) || a.localeCompare(b))) {
        const option = document.createElement('option'); option.value = origin; option.textContent = origin; addresses.append(option);
      }
      if (device.origins.includes(selectedDiscoveryAddresses.get(device.id))) addresses.value = selectedDiscoveryAddresses.get(device.id);
      const ip = document.createElement('div'); ip.className = 'device-ip';
      const updateIp = () => { ip.textContent = `IP ${new URL(addresses.value).hostname}`; };
      updateIp();
      addresses.addEventListener('change', () => { selectedDiscoveryAddresses.set(device.id, addresses.value); updateIp(); });
      item.info.append(ip);
      if (device.origins.length > 1) {
        const alternative = document.createElement('details'); alternative.className = 'device-addresses';
        const summary = document.createElement('summary'); summary.textContent = 'Другой сетевой адрес';
        alternative.append(summary, addresses); item.info.append(alternative);
      }
      const known = device.secure && trustState.devices.some(item => item.fingerprint === device.secure.fingerprint);
      const hint = document.createElement('div'); hint.className = 'device-hint';
      hint.textContent = device.secure && trustState.enabled ? known ? 'Сохранённое устройство · без PIN' : 'Первое подключение · сверка на двух ПК' : 'Понадобится PIN с экрана этого ПК';
      item.element.append(hint, button('Подключиться', async () => {
        if (sending || state?.offers.some(offer => offer.state === 'uploading')) { message('Дождитесь завершения текущей передачи.'); return; }
        const origin = addresses.value;
        if (device.secure && trustState.enabled) {
          if (known) await connectTrusted(device.secure.fingerprint, origin); else await beginPair(origin);
          return;
        }
        const changed = $('pc-address').value !== origin;
        $('pc-address').value = origin; if (changed) $('pc-pin').value = '';
        setConnectionMode('lan');
        joinMode = true; render(); $('pc-connect').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        $('pc-pin').focus(); await diagnoseAddress();
      }));
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
  $('trusted-panel').hidden = !showTrustedPanel();
  const pairing = trustState.requests.filter(request => !request.rejected);
  if (pairing.length) $('saved-devices').open = true;
  if (pairing.some(request => !pairingSeen.has(request.id))) window.NearbyWorkspace.selectTab('connection');
  for (const request of pairing) pairingSeen.add(request.id);
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
  if (!trustState.devices.length) empty($('trusted-devices'), 'После подтверждения на обоих ПК устройство появится здесь.');
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
  peerMode = true; rendered = ''; await refresh();
  message('Устройства соединены с проверкой ключей и шифрованием.');
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

function upload(url, file, onProgress, target) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    if (target?.kind === 'peer') xhr.setRequestHeader('X-Nearby-Peer', target.id);
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
  const target = selectedTarget();
  if (!state || !connectionAvailable || !target || sending || !files.length) return;
  sending = true; renderConnection();
  try {
    const batch = files.map((file, index) => {
      const key = `local-${Date.now()}-${++recordSequence}`;
      const record = keepRecord(key, { name: file.name, size: file.size, direction: 'outgoing', device: target.name, target, file, localSend: true, busy: true, status: 'В очереди на отправку', received: 0 });
      return { file, index, key, record };
    });
    rendered = ''; renderTransfers();
    for (const { file, index, key, record } of batch) {
      try {
        if (!targets.some(current => current.id === target.id && current.kind === target.kind)) throw new Error('Получатель отключился. Подключитесь снова и повторите отправку.');
        record.status = 'Подготовка'; rendered = ''; renderTransfers();
        await registerNativeFile(key, index);
        if (file.size > target.maxSize) throw new Error(`Максимальный размер файла: ${sizes(target.maxSize)}.`);
        if (target.kind === 'internet') { await sendInternetRecord(record,target,file); await refresh().catch(() => {}); continue; }
        let url;
        if (target.kind === 'client') {
          record.serverKind = 'share'; url = `/api/shares?recipient=${encodeURIComponent(target.id)}&name=${encodeURIComponent(file.name)}&size=${file.size}`;
        } else {
          record.serverKind = 'offer';
          const offer = await api(targetPrefix(target) + '/api/offers', { method: 'POST', data: { name: file.name, size: file.size }, target }); record.serverId = offer.id; records.delete(`peer-offer:${target.id}:${offer.id}`); records.delete('offer:' + offer.id);
          const deadline = Date.now() + 5 * 60_000;
          let accepted = offer.state === 'accepted';
          while (!accepted && Date.now() < deadline) {
            const current = await api(targetPrefix(target) + '/api/state', { target }); const status = current.offers.find(item => item.id === offer.id)?.state;
            if (status === 'accepted') accepted = true; else if (status !== 'pending') throw new Error(statusNames[status] || 'Запрос больше не доступен.'); else await pause(1000);
          }
          if (!accepted) throw new Error('Время ожидания истекло. Отправьте файл заново.');
          url = targetPrefix(target) + `/api/offers/${offer.id}/upload`;
        }
        let lastUpdate = 0;
        const uploaded = await upload(url, file, bytes => { if (Date.now() - lastUpdate < 200 && bytes < file.size) return; lastUpdate = Date.now(); record.received = bytes; record.status = bytes >= file.size ? 'Проверяем сохранение на компьютере…' : `Отправляем: ${sizes(bytes)} / ${sizes(file.size)}`; rendered = ''; renderTransfers(); }, target);
        record.serverId = uploaded.id; if (target.kind === 'client') records.delete('share:' + uploaded.id); record.localStored = target.kind === 'client'; record.busy = false; record.status = target.kind === 'client' ? 'Ожидаем получение устройством' : 'Получено и сохранено на компьютере';
        rendered = ''; await refresh().catch(() => {});
      } catch (error) { record.busy = false; record.failed = true; record.status = error.message || 'Соединение прервано.'; rendered = ''; renderTransfers(); }
    }
  } finally { sending = false; $('files').value = ''; renderConnection(); rendered = ''; renderTransfers(); }
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
    peerMode = true; rendered = ''; await refresh(); message('ПК соединены. Можно передавать файлы в обе стороны.');
  } catch (error) { message(error.message || 'Не удалось подключиться к другому ПК.'); }
  finally { submit.disabled = false; }
});
$('pc-disconnect').addEventListener('click', async () => {
  if (sending) { message('Дождитесь завершения отправки.'); return; }
  $('pc-disconnect').disabled = true;
  try {
    if (refreshing) await refreshing.catch(() => {});
    await api('/api/peer/disconnect', { method: 'POST', data: {} });
    peerMode = false; joinMode = false; rendered = ''; message('Подключение к другому ПК завершено.'); await refresh();
  } catch (error) { message(error.message); }
  finally { $('pc-disconnect').disabled = false; }
});
$('copy-address').addEventListener('click', async () => {
  if (!$('share-address').value) return;
  try { await navigator.clipboard.writeText($('share-address').value); message('Ссылка с PIN скопирована. Вставьте её в Nearby на другом ПК.'); }
  catch { $('share-address').focus(); $('share-address').select(); message('Ссылка выделена. Нажмите Ctrl+C, чтобы скопировать.'); }
});
function setConnectionMode(mode) {
  $('connection-mode').value=mode;
  document.body.dataset.connectionMode=mode;
  $('desktop-lan').hidden=false;
  $('connection').hidden=!state?.admin||mode!=='lan';
  document.querySelector('.connection-actions').hidden=mode!=='lan'&&!peerMode;
  renderInternet();
}
$('connection-mode').addEventListener('change', () => setConnectionMode($('connection-mode').value));
$('back-local').addEventListener('click',()=>setConnectionMode('auto'));
$('open-internet').addEventListener('click',()=>{setConnectionMode('auto');$('internet-id').focus();});
$('invite-internet').addEventListener('click',()=>{
  setConnectionMode('auto');
  if(!internetClient.pending&&!internetClient.working)void internetClient.create(internetName()).catch(error=>{$('internet-status').textContent=error.message;});
  else if(internetUI.invitation)$('internet-invitation').scrollIntoView({block:'nearest'});
});
function internetName() { return $('internet-name').value.trim().slice(0,40) || state?.computerName || 'Компьютер'; }
async function sendInternetRecord(record,target,file,options) {
  const connection=internetClient.connection(target);
  if(!connection?.ready||connection.stopped)throw new Error('Интернет-устройство отключилось.');
  record.internet=true;record.internetRoom=connection.id;record.internetFileId=crypto.randomUUID();
  await internetClient.send(target,file,record.internetFileId,options);
  record.busy=false;record.status='Передан получателю';rendered='';renderTransfers();
}
window.NearbyGetInternetTargets = () => internetClient.targets();
window.NearbySendInternet = async(target,file,options={}) => {
  if(sending)throw new Error('Дождитесь завершения текущей отправки.');
  sending=true;renderConnection();
  const key='shell-internet:'+crypto.randomUUID(),record=keepRecord(key,{name:file.name,size:file.size,file,direction:'outgoing',device:target.name,target,localSend:true,busy:true,status:'Подготовка',received:0});
  rendered='';renderTransfers();
  try{if(Number.isInteger(options.nativeIndex))await registerNativeFile(key,options.nativeIndex,'shell-files');await sendInternetRecord(record,target,file,options);}
  catch(error){record.busy=false;record.failed=true;record.status=error.message;throw error;}
  finally{sending=false;renderConnection();rendered='';renderTransfers();}
};
$('internet-create').addEventListener('click',()=>{void internetClient.create(internetName(),{mode:$('connection-mode').value==='internet'?'internet':'auto'}).catch(error=>{$('internet-status').textContent=error.message;});});
$('internet-join-form').addEventListener('submit',event=>{event.preventDefault();$('internet-status').textContent='Подключаемся…';void internetClient.join($('internet-id').value.trim(),internetName()).catch(error=>{$('internet-status').textContent=error.message;});});
$('internet-approve').addEventListener('click',async()=>{try{await internetClient.approve();$('internet-approval').hidden=true;}catch(error){$('internet-status').textContent=error.message;}});
for(const id of ['internet-stop','internet-reject'])$(id).addEventListener('click',()=>{void internetClient.disconnect();});
for(const [id,source]of[['internet-copy-id','internet-code'],['internet-copy-link','internet-link']])$(id).addEventListener('click',async()=>{const value=$(source).value||$(source).textContent;try{await navigator.clipboard.writeText(value);$('internet-status').textContent='Скопировано.';}catch{if($(source).select)$(source).select();$('internet-status').textContent='Выделите и скопируйте приглашение.';}});
window.addEventListener('pagehide',()=>{clearTimeout(internetUI.expiryTimer);internetClient.close();});
document.addEventListener('nearby-shell-transfer', event => {
  const { file, uploaded, target } = event.detail;
  const key = `shell:${target.id}:${uploaded.id}`;
  if (target.kind === 'client') records.delete('share:' + uploaded.id); else records.delete(`peer-offer:${target.id}:${uploaded.id}`);
  keepRecord(key, { name: file.name, size: file.size, file, direction: 'outgoing', localSend: true, localStored: target.kind === 'client', serverKind: target.kind === 'client' ? 'share' : 'offer', serverId: uploaded.id, device: target.name, target, busy: false, status: target.kind === 'client' ? 'Ожидаем получение устройством' : 'Получено и сохранено на компьютере' }); rendered = ''; renderTransfers();
});
$('devices-transfer').onclick = () => window.NearbyWorkspace.selectTab('transfer');
$('select-remaining').onclick = () => { if (targets.length === 1 && !sending) { selectedTargetId = targets[0].id; selectionLost = false; renderConnection(); } };
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
attemptAutoJoin(); poll();
