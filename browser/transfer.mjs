export const MEMORY_LIMIT = 100 * 1024 ** 2;
export const DISK_LIMIT = 10 * 1024 ** 3;
export const CHUNK_SIZE = 16 * 1024;
const idValid = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
export function validateFileSpec(value, maximum = DISK_LIMIT) {
  if (!value || !idValid(value.id) || typeof value.name !== 'string' || !value.name.trim() ||
      new TextEncoder().encode(value.name).length > 180 || /[\x00-\x1f\x7f<>:"/\\|?*]/u.test(value.name) ||
      /[. ]$/.test(value.name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value.name) ||
      !Number.isSafeInteger(value.size) || value.size < 0 || value.size > maximum) {
    throw new Error('Недопустимое имя или размер файла.');
  }
  return { id: value.id, name: value.name, size: value.size };
}
async function digest(data) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), v => v.toString(16).padStart(2, '0')).join('');
}

// One active file in each direction. Every chunk is acknowledged only after
// hash verification and sink.write(), keeping memory bounded on the sender.
export class FileLink {
  constructor(channel, { maxReceive = MEMORY_LIMIT, onOffer, onProgress, onComplete, onError, onReady } = {}) {
    this.channel = channel; this.maxReceive = maxReceive;
    this.callbacks = { onOffer, onProgress, onComplete, onError, onReady };
    this.pending = new Map(); this.incoming = null; this.outgoing = null; this.closed = false;
    this.peerLimit = null; this.chain = Promise.resolve();
    this.cancelled = new Set(); this.discardBinary = false;
    channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 65536;
    channel.addEventListener('message', event => {
      this.chain = this.chain.then(() => this.handle(event.data)).catch(error => this.protocolError(error));
    });
    channel.addEventListener('close', () => this.close('Соединение закрыто.'));
    channel.addEventListener('error', () => this.close('Ошибка передачи данных.'));
    this.send({ type: 'hello', version: 1, maxReceive });
  }
  emit(name, ...args) { this.callbacks[name]?.(...args); }
  send(message) {
    if (this.closed || this.channel.readyState !== 'open') throw new Error('Нет соединения с устройством.');
    this.channel.send(JSON.stringify(message));
  }
  wait(id, type, timeout = 45000) {
    const key = `${id}:${type}`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(key); reject(new Error('Устройство не ответило вовремя.')); }, timeout);
      this.pending.set(key, { resolve, reject, timer });
    });
    promise.catch(() => {}); // send() may fail before its caller reaches await.
    return promise;
  }
  settle(id, type, value) {
    const key = `${id}:${type}`, pending = this.pending.get(key);
    if (pending) { clearTimeout(pending.timer); this.pending.delete(key); pending.resolve(value); }
  }
  rejectWaits(id, reason) {
    for (const [key, pending] of this.pending) {
      if (key.startsWith(id + ':')) { clearTimeout(pending.timer); this.pending.delete(key); pending.reject(new Error(reason)); }
    }
  }
  async sendFile(file, id = crypto.randomUUID()) {
    if (this.outgoing) throw new Error('Дождитесь завершения текущей отправки.');
    if (!this.peerLimit) throw new Error('Устройство ещё не готово.');
    const spec = validateFileSpec({ id, name: file.name, size: file.size }, this.peerLimit);
    const outgoing = { ...spec, cancelled: false }; this.outgoing = outgoing;
    try {
      const accepted = this.wait(id, 'accept', 120000);
      this.send({ type: 'offer', ...spec });
      await accepted;
      this.emit('onProgress', id, 0, 'sending');
      for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        if (outgoing.cancelled || this.closed) throw new Error('Передача отменена.');
        const data = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        const hash = await digest(data);
        if (outgoing.cancelled || this.closed) throw new Error('Передача отменена.');
        const acknowledged = this.wait(id, 'ack');
        this.send({ type: 'chunk', id, offset, size: data.byteLength, hash });
        this.channel.send(data);
        const ack = await acknowledged;
        if (ack.offset !== offset + data.byteLength) throw new Error('Ошибка подтверждения части файла.');
        this.emit('onProgress', id, ack.offset, 'sending');
      }
      const complete = this.wait(id, 'complete');
      this.send({ type: 'finish', id });
      await complete;
      this.emit('onComplete', id, 'sent');
    } catch (error) {
      this.rejectWaits(id, error.message);
      try { this.send({ type: 'cancel', id }); } catch {}
      this.emit('onError', id, error.message);
      throw error;
    } finally { if (this.outgoing?.id === id) this.outgoing = null; }
    return id;
  }
  async accept(id, sink) {
    const current = this.incoming;
    if (!current || current.id !== id || current.accepted) { await sink.abort?.(); throw new Error('Запрос уже недоступен.'); }
    clearTimeout(current.timer); current.sink = sink; current.accepted = true; current.received = 0;
    this.touch(current);
    this.send({ type: 'accept', id });
    this.emit('onProgress', id, 0, 'receiving');
  }
  touch(current) {
    clearTimeout(current.timer);
    current.timer = setTimeout(() => { this.cancel(current.id, 'Передача прервана: устройство не отвечает.'); }, 90000);
  }
  cancel(id, reason = 'Передача отменена.', notify = true) {
    this.cancelled.add(id);
    if (this.cancelled.size > 256) this.cancelled.delete(this.cancelled.values().next().value);
    if (this.outgoing?.id === id) this.outgoing.cancelled = true;
    this.rejectWaits(id, reason);
    if (this.incoming?.id === id) {
      const current = this.incoming; this.incoming = null;
      if (current.chunk) this.discardBinary = true;
      clearTimeout(current.timer); current.sink?.abort?.().catch?.(() => {});
    }
    if (notify) { try { this.send({ type: 'cancel', id }); } catch {} }
    this.emit('onError', id, reason);
  }
  async handle(data) {
    if (this.closed) return;
    if (typeof data !== 'string') {
      if (this.discardBinary) { this.discardBinary = false; return; }
      const current = this.incoming, chunk = current?.chunk;
      if (!current?.accepted || !chunk || !(data instanceof ArrayBuffer) || data.byteLength !== chunk.size) throw new Error('Неожиданная часть файла.');
      current.chunk = null;
      if (await digest(data) !== chunk.hash) throw new Error('Контрольная сумма части файла не совпала.');
      if (this.incoming !== current) return;
      await current.sink.write(data);
      if (this.incoming !== current) return;
      current.received += data.byteLength; this.touch(current);
      this.send({ type: 'ack', id: current.id, offset: current.received });
      this.emit('onProgress', current.id, current.received, 'receiving');
      return;
    }
    if (data.length > 4096) throw new Error('Слишком большое управляющее сообщение.');
    const message = JSON.parse(data);
    if (!message || typeof message !== 'object') throw new Error('Некорректное сообщение.');
    if (message.type === 'hello') {
      if (this.peerLimit !== null || message.version !== 1 || ![MEMORY_LIMIT, DISK_LIMIT].includes(message.maxReceive)) throw new Error('Несовместимая версия Nearby.');
      this.peerLimit = message.maxReceive; this.emit('onReady', this.peerLimit); return;
    }
    if (!idValid(message.id)) throw new Error('Некорректный идентификатор файла.');
    if (this.cancelled.has(message.id)) {
      if (message.type === 'chunk') this.discardBinary = true;
      return;
    }
    if (message.type === 'offer') {
      const spec = validateFileSpec(message, this.maxReceive);
      if (this.incoming || this.peerLimit === null) { this.send({ type: 'cancel', id: spec.id }); return; }
      this.incoming = { ...spec, accepted: false, timer: setTimeout(() => this.cancel(spec.id, 'Время подтверждения истекло.'), 120000) };
      this.emit('onOffer', spec); return;
    }
    if (message.type === 'cancel') {
      this.cancel(message.id, 'Передача отклонена или отменена другим устройством.', false); return;
    }
    if (['accept', 'ack', 'complete'].includes(message.type)) { this.settle(message.id, message.type, message); return; }
    const current = this.incoming;
    if (!current?.accepted || current.id !== message.id) throw new Error('Файл не был принят.');
    if (message.type === 'chunk') {
      if (current.chunk || message.offset !== current.received || !Number.isInteger(message.size) || message.size < 1 || message.size > CHUNK_SIZE || current.received + message.size > current.size || !/^[a-f0-9]{64}$/.test(message.hash)) throw new Error('Повреждённая последовательность частей файла.');
      current.chunk = message; this.touch(current); return;
    }
    if (message.type === 'finish') {
      if (current.chunk || current.received !== current.size) throw new Error('Файл получен не полностью.');
      clearTimeout(current.timer);
      const result = await current.sink.close();
      this.incoming = null; this.send({ type: 'complete', id: current.id });
      this.emit('onComplete', current.id, 'received', result); return;
    }
    throw new Error('Неизвестное сообщение.');
  }
  protocolError(error) {
    if (this.incoming) this.cancel(this.incoming.id, error.message);
    if (this.outgoing) this.cancel(this.outgoing.id, error.message);
    this.close(error.message); this.channel.close();
  }
  close(reason = 'Соединение закрыто.') {
    if (this.closed) return;
    if (this.incoming) this.cancel(this.incoming.id, reason);
    if (this.outgoing) this.cancel(this.outgoing.id, reason);
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(reason)); }
    this.pending.clear();
  }
}
