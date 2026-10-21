import { FileLink, MEMORY_LIMIT } from './transfer.mjs';
import { HttpsRelayChannel } from './relay.mjs';
import { ProbeChannel } from './probe-channel.mjs';
import { sharedInvitationSecret } from './invitation-id.mjs?v=numeric-1';

export async function requestApi(action, extra = {}, session = null) {
  const response = await fetch(action.startsWith('relay-') ? 'api.php?transport=relay' : 'api.php', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(15000), body: JSON.stringify({ action, ...(session ? { room: session.room, token: session.token } : {}), ...extra }),
  });
  const result = await response.json().catch(() => { throw new Error('Сервер вернул неожиданный ответ. Попробуйте позже.'); });
  if (!response.ok || result.error) { const error = new Error(result.error || 'Ошибка соединения.'); error.status = response.status; throw error; }
  return result;
}

// One independent pairing. No selected-device or shared DOM state is used here.
export class Connection {
  constructor(session, callbacks = {}) {
    this.session = session; this.id = session.room; this.callbacks = callbacks;
    this.peerName = ''; this.peer = null; this.link = null; this.relay = null; this.probe = null; this.channel = null;
    this.transport = null; this.ready = false; this.hasConnected = false; this.started = false; this.stopped = false;
    this.cursor = 0; this.candidates = []; this.signalChain = Promise.resolve(); this.pollFailures = 0; this.polling = false;
    this.directBroken = false; this.recovering = false;
  }
  emit(name, ...args) { this.callbacks[name]?.(this, ...args); }
  status(title, detail) { this.emit('onStatus', title, detail); }
  api(action, extra) { return requestApi(action, extra, this.session); }
  start() { void this.poll(); }
  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.stopped && (!this.ready || (this.session.mode === 'auto' && this.transport === 'direct'))) this.pollTimer = setTimeout(() => void this.poll(), this.ready ? 5000 : 1500);
  }
  sendSignal(message) {
    this.signalChain = this.signalChain.then(() => this.api('signal', { message }));
    this.signalChain.catch(error => { if (!this.stopped) this.fail(error.message); });
    return this.signalChain;
  }
  async startRelay() {
    if (this.stopped || this.relay) return;
    this.transport = 'relay'; this.ready = false; clearTimeout(this.connectionTimer); clearTimeout(this.disconnectTimer);
    this.channel = null;
    this.link?.close('Прямое соединение прервано. Отправьте незавершённый файл заново после восстановления связи.'); this.link = null;
    const oldPeer = this.peer; this.peer = null; this.probe?.close(); this.probe = null; oldPeer?.close(); this.candidates = [];
    this.status('Устанавливаем интернет-связь', 'Проверяем зашифрованное соединение с другим устройством.');
    this.relay = new HttpsRelayChannel({ room: this.id, secret: this.session.relaySecret, role: this.session.role, request: (action, body) => this.api(action, body) });
    this.bindChannel(this.relay);
    this.connectionTimer = setTimeout(() => { if (!this.ready) this.fail('Интернет-связь не установлена. Проверьте доступ к сайту и передайте приглашение целиком.'); }, 45000);
    await this.relay.start();
  }
  async applyTransport(choice) {
    if (this.stopped || this.session.mode !== 'auto' || this.transport === 'relay') return;
    if (choice === 'relay') await this.startRelay();
    else if (choice === 'direct' && this.transport === 'probing') {
      this.transport = 'direct'; clearTimeout(this.connectionTimer);
      if (this.probe?.readyState !== 'open') { await this.recoverDirect(); return; }
      this.bindChannel(this.probe); this.probe.activate();
      this.connectionTimer = setTimeout(() => { if (!this.ready) void this.recoverDirect(); }, 10000);
    }
  }
  async transportEvent(event) {
    if (this.stopped || !['probing', 'direct'].includes(this.transport)) return;
    try { const result = await this.api('transport', { event }); await this.applyTransport(result.transport); }
    catch (error) { if (!this.stopped) { if ([400, 403, 404, 410].includes(error.status)) this.fail(error.message); else this.emit('onNotice', 'Проверяем соединение с сайтом…'); } }
  }
  async recoverDirect() {
    if (this.stopped || this.session.mode !== 'auto' || !['probing', 'direct'].includes(this.transport)) return;
    this.directBroken = true; this.ready = false; clearTimeout(this.disconnectTimer);
    this.status('Восстанавливаем соединение', 'Прямой канал недоступен. Переключаемся на зашифрованный интернет-канал.');
    if (this.recovering) return;
    this.recovering = true;
    try { await this.transportEvent(this.transport === 'direct' ? 'direct-failed' : 'fallback'); }
    finally { this.recovering = false; this.schedulePoll(); }
  }
  directChannel(channel) {
    if (this.stopped || this.transport === 'relay') { channel.close(); return; }
    if (this.session.mode !== 'auto') { this.bindChannel(channel); return; }
    this.probe = new ProbeChannel(channel);
    this.probe.addEventListener('open', () => void this.transportEvent('direct-ready'), { once: true });
    for (const type of ['close', 'error']) this.probe.addEventListener(type, () => { if (!this.stopped && this.transport === 'probing') void this.recoverDirect(); });
    if (channel.readyState === 'open') void this.transportEvent('direct-ready');
  }
  async startPeer() {
    this.started = true;
    if (this.session.mode === 'internet') { await this.startRelay(); return; }
    this.transport = this.session.mode === 'auto' ? 'probing' : 'direct';
    if (this.session.mode === 'auto') this.connectionTimer = setTimeout(() => void this.transportEvent('fallback'), 12500);
    try {
      if (!window.RTCPeerConnection) throw new Error('Локальный WebRTC недоступен в этом браузере. Выберите режим «Через интернет».');
      this.status('Устанавливаем связь', this.session.mode === 'auto' ? 'Nearby автоматически выбирает прямое или интернет-соединение.' : 'Разрешите доступ к локальной сети, если браузер попросит.');
      const rtc = new RTCPeerConnection({ iceServers: [] }); this.peer = rtc;
      rtc.onicecandidate = event => { if (!this.stopped && this.peer === rtc && event.candidate) this.sendSignal({ type: 'candidate', candidate: event.candidate.toJSON() }); };
      rtc.ondatachannel = event => { if (this.peer === rtc) this.directChannel(event.channel); else event.channel.close(); };
      rtc.onconnectionstatechange = () => {
        if (this.stopped || this.peer !== rtc) return;
        if (rtc.connectionState === 'failed') {
          if (this.session.mode === 'auto') void this.recoverDirect(); else this.fail('Прямое соединение не удалось. Создайте новое подключение.');
        }
        if (rtc.connectionState === 'disconnected') {
          this.ready = false; this.status('Связь прервалась', 'Проверяем соединение с другим устройством…');
          if (this.session.mode === 'auto' && !this.disconnectTimer) this.disconnectTimer = setTimeout(() => { this.disconnectTimer = null; if (this.peer === rtc && rtc.connectionState === 'disconnected') void this.recoverDirect(); }, 5000);
        }
        if (rtc.connectionState === 'connected') { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; if (this.link?.peerLimit && !this.directBroken) this.protocolReady(this.link.peerLimit); }
      };
      if (this.session.mode !== 'auto') this.connectionTimer = setTimeout(() => { if (!this.ready) this.fail('Устройства не смогли соединиться напрямую. Подключите их к одной обычной сети Wi-Fi; гостевая сеть может изолировать устройства.'); }, 45000);
      if (this.session.role === 'host') {
        this.directChannel(rtc.createDataChannel('nearby-files', { ordered: true }));
        const offer = await rtc.createOffer(); if (this.stopped || this.peer !== rtc) return;
        await rtc.setLocalDescription(offer);
        if (!this.stopped && this.peer === rtc) await this.sendSignal({ type: 'offer', sdp: offer.sdp });
      }
    } catch (error) { if (!this.stopped && this.transport === 'probing') await this.transportEvent('fallback'); else if (!this.stopped && this.transport !== 'relay') throw error; }
  }
  async receiveSignal(message) {
    const rtc = this.peer;
    if (this.stopped || !rtc || this.transport === 'relay') return;
    try {
      if (message.type === 'candidate') { if (!rtc.remoteDescription) this.candidates.push(message.candidate); else await rtc.addIceCandidate(message.candidate); return; }
      if ((message.type === 'offer' && this.session.role !== 'guest') || (message.type === 'answer' && this.session.role !== 'host')) throw new Error('Неожиданное описание соединения.');
      await rtc.setRemoteDescription({ type: message.type, sdp: message.sdp });
      for (const candidate of this.candidates) { if (this.stopped || this.peer !== rtc) return; await rtc.addIceCandidate(candidate); }
      this.candidates = [];
      if (message.type === 'offer') {
        const answer = await rtc.createAnswer(); if (this.stopped || this.peer !== rtc) return;
        await rtc.setLocalDescription(answer);
        if (!this.stopped && this.peer === rtc) await this.sendSignal({ type: 'answer', sdp: answer.sdp });
      }
    } catch (error) { if (!this.stopped && this.transport === 'probing') await this.transportEvent('fallback'); else if (!this.stopped && this.peer === rtc) throw error; }
  }
  async poll() {
    if (this.stopped || this.polling || (this.ready && !(this.session.mode === 'auto' && this.transport === 'direct'))) return;
    this.polling = true;
    try {
      const result = await this.api('poll', { after: this.cursor }); if (this.stopped) return; this.pollFailures = 0;
      this.peerName = this.session.role === 'host' ? result.guestName || this.peerName : result.hostName || this.peerName;
      if (this.session.role === 'host' && result.guestName && !result.approved) {
        this.status('Разрешить подключение?', 'Убедитесь, что приглашение открыл ваш получатель.'); this.emit('onPeerRequest', result.guestName);
      }
      if (result.approved && !this.started) {
        if (this.session.role === 'host' && this.session.idPrivateKey && result.guestPublicKey) {
          const secret = await sharedInvitationSecret(this.session.idPrivateKey, result.guestPublicKey, this.id); if (this.stopped) return; this.session.relaySecret = secret;
        }
        this.session.idPrivateKey = null; this.emit('onApproved'); await this.startPeer();
      }
      if (this.started) await this.applyTransport(result.transport);
      if (this.transport === 'direct' && this.directBroken) await this.recoverDirect();
      if (this.started && this.transport !== 'relay') for (const message of result.messages) await this.receiveSignal(message.body);
      this.cursor = result.cursor;
    } catch (error) {
      if ([400, 403, 404, 410].includes(error.status) || (++this.pollFailures >= 4 && !this.ready)) { this.fail(error.message); return; }
      this.emit('onNotice', 'Проверяем соединение с сайтом…');
    } finally { this.polling = false; this.schedulePoll(); }
  }
  protocolReady(limit) {
    if (this.stopped || (this.transport === 'direct' && this.directBroken)) return;
    this.ready = true; this.hasConnected = true; clearTimeout(this.connectionTimer);
    if (!this.polling) this.schedulePoll(); void this.reportStatistics('record-usage'); this.emit('onReady', limit);
  }
  bindChannel(channel) {
    this.channel = channel;
    const open = () => {
      if (this.stopped || this.channel !== channel) return;
      const maxReceive = this.callbacks.receiveLimit?.(this) ?? MEMORY_LIMIT;
      this.link = new FileLink(channel, {
        maxReceive, onReady: limit => { if (this.channel === channel) this.protocolReady(limit); },
        onOffer: spec => { if (this.channel === channel) this.emit('onOffer', spec, this.link); },
        onProgress: (...args) => this.emit('onProgress', ...args), onComplete: (...args) => this.emit('onComplete', ...args), onError: (...args) => this.emit('onError', ...args),
      });
    };
    if (channel.readyState === 'open') open(); else channel.addEventListener('open', open, { once: true });
    for (const type of ['close', 'error']) channel.addEventListener(type, () => {
      if (this.stopped || this.channel !== channel) return;
      if (this.session.mode === 'auto' && this.transport === 'direct') void this.recoverDirect(); else this.fail(channel.error || 'Соединение с другим устройством закрыто. Создайте новое подключение.');
    });
  }
  async reportStatistics(action, extra = {}) {
    const body = JSON.stringify({ action, room: this.id, token: this.session.token, ...extra });
    for (const delay of [0, 1500, 5000]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        const response = await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', keepalive: true, signal: AbortSignal.timeout(10000), body });
        if (response.ok) { document.dispatchEvent(new Event(action === 'record-usage' ? 'nearby-connection-complete' : 'nearby-transfer-complete')); return; }
        if (response.status < 500 && response.status !== 429) return;
      } catch { /* Statistics failures never stop a transfer. */ }
    }
  }
  stop(message, expected = false) {
    if (this.stopped) return;
    this.stopped = true; this.ready = false;
    for (const timer of [this.pollTimer, this.connectionTimer, this.disconnectTimer]) clearTimeout(timer);
    this.link?.close(message); this.probe?.close(); this.peer?.close(); this.relay?.close(); this.session.relaySecret = null; this.session.idPrivateKey = null;
    this.emit('onClosed', message, expected);
  }
  fail(message) { this.stop(message); }
  async disconnect() {
    try { await this.api('close'); } catch { /* Always close local resources. */ }
    this.stop('Соединение завершено. Принятые файлы можно сохранить ниже.', true);
  }
}
