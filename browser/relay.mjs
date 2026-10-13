const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
export const newRelaySecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
function base64(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
function unbase64(value) {
  if (typeof value !== 'string' || value.length > 349600) throw new Error('Некорректная зашифрованная часть.');
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
export async function relayCipher(room, secret, role) {
  if (!/^[a-f0-9]{32}$/.test(room) || !/^[a-f0-9]{64}$/.test(secret) || !['host', 'guest'].includes(role)) throw new Error('В приглашении отсутствует ключ интернет-передачи. Создайте новую ссылку.');
  const material = await crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g), value => parseInt(value, 16)), 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(room), info: encoder.encode('Nearby HTTPS Relay v1 ' + role) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const parameters = sequence => {
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Нарушен порядок интернет-передачи.');
    const iv = new Uint8Array(12);
    new DataView(iv.buffer).setBigUint64(4, BigInt(sequence));
    return { name: 'AES-GCM', iv, additionalData: encoder.encode(`${room}:${role}:${sequence}`), tagLength: 128 };
  };
  return {
    async encrypt(sequence, data) {
      const binary = typeof data !== 'string';
      const body = binary ? new Uint8Array(data) : encoder.encode(data);
      if (body.byteLength > 262144) throw new Error('Слишком большая часть интернет-передачи.');
      const plain = new Uint8Array(body.length + 1); plain[0] = binary ? 1 : 0; plain.set(body, 1);
      return base64(new Uint8Array(await crypto.subtle.encrypt(parameters(sequence), key, plain)));
    },
    async decrypt(sequence, value) {
      const ciphertext = unbase64(value);
      const plain = new Uint8Array(await crypto.subtle.decrypt(parameters(sequence), key, ciphertext));
      if (plain[0] === 0) return decoder.decode(plain.subarray(1));
      if (plain[0] !== 1) throw new Error('Некорректный тип интернет-передачи.');
      return plain.slice(1).buffer;
    },
  };
}

export class HttpsRelayChannel extends EventTarget {
  constructor({ room, secret, role, request, idleMs = 750 }) {
    super(); this.readyState = 'connecting'; this.bufferedAmount = 0; this.maxChunkSize = 262144;
    this.room = room; this.secret = secret; this.role = role; this.request = request; this.idleMs = idleMs;
    this.tx = 0; this.rx = 0; this.queue = []; this.encoding = Promise.resolve();
  }
  async start() {
    try {
      [this.encryptor, this.decryptor] = await Promise.all([relayCipher(this.room, this.secret, this.role), relayCipher(this.room, this.secret, this.role === 'host' ? 'guest' : 'host')]);
      this.secret = null;
      if (this.readyState !== 'connecting') return;
      this.readyState = 'open'; this.dispatchEvent(new Event('open')); void this.pull();
    } catch (error) { this.failure(error); }
  }
  send(data) {
    if (this.readyState !== 'open') throw new Error('Интернет-соединение закрыто.');
    const copied = typeof data === 'string' ? data : data.slice(0);
    const size = typeof copied === 'string' ? encoder.encode(copied).length : copied.byteLength;
    if (size > 262144 || this.bufferedAmount + size > 1048576) throw new Error('Получатель не успевает принимать данные.');
    this.bufferedAmount += size;
    const seq = ++this.tx;
    this.encoding = this.encoding.then(async () => {
      const encrypted = await this.encryptor.encrypt(seq, copied);
      if (this.readyState !== 'open') return;
      this.queue.push({ seq, data: encrypted, size }); this.schedulePush();
    }).catch(error => this.failure(error));
  }
  schedulePush() {
    if (!this.pushTimer && !this.pushing) this.pushTimer = setTimeout(() => { this.pushTimer = null; void this.push(); }, 10);
  }
  async call(action, body) {
    let last;
    for (const delay of [0, 600, 1800]) {
      if (this.readyState !== 'open') throw new Error('Интернет-соединение закрыто.');
      if (delay) await new Promise(resolve => { this.retryTimer = setTimeout(resolve, delay); });
      try { return await this.request(action, body); }
      catch (error) { last = error; if ([400, 403, 404, 409, 410, 413].includes(error.status)) throw error; }
    }
    throw last;
  }
  async push() {
    if (this.pushing || this.readyState !== 'open' || !this.queue.length) return;
    this.pushing = true;
    const frames = []; let bytes = 0;
    for (const frame of this.queue) {
      if (frames.length >= 8 || bytes + frame.data.length > 700000) break;
      frames.push(frame); bytes += frame.data.length;
    }
    try {
      const result = await this.call('relay-push', { frames: frames.map(({ seq, data }) => ({ seq, data })) });
      if (this.readyState !== 'open') return;
      if (result.seq !== frames.at(-1).seq) throw new Error('Некорректное подтверждение интернет-передачи.');
      this.queue.splice(0, frames.length); this.bufferedAmount -= frames.reduce((sum, frame) => sum + frame.size, 0);
    } catch (error) { this.failure(error); }
    finally { this.pushing = false; if (this.queue.length && this.readyState === 'open') this.schedulePush(); }
  }
  async pull() {
    if (this.readyState !== 'open') return;
    try {
      const result = await this.call('relay-pull', { after: this.rx });
      if (this.readyState !== 'open') return;
      if (!Array.isArray(result.frames) || result.frames.length > 32) throw new Error('Некорректный ответ интернет-передачи.');
      for (const frame of result.frames) {
        if (frame.seq <= this.rx) continue;
        if (frame.seq !== this.rx + 1) throw new Error('Нарушен порядок интернет-передачи.');
        const data = await this.decryptor.decrypt(frame.seq, frame.data);
        if (this.readyState !== 'open') return;
        this.rx = frame.seq; this.dispatchEvent(new MessageEvent('message', { data }));
      }
      if (this.readyState === 'open') this.pullTimer = setTimeout(() => { void this.pull(); }, result.frames.length ? 40 : this.idleMs);
    } catch (error) { this.failure(error); }
  }
  failure(error) {
    if (this.readyState === 'closed') return;
    this.error = error?.name === 'OperationError' ? 'Не удалось проверить шифрование. Создайте новое приглашение и передайте ссылку целиком.' : error?.message || 'Интернет-передача прервана.';
    this.dispatchEvent(new Event('error')); this.close();
  }
  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed'; clearTimeout(this.pushTimer); clearTimeout(this.pullTimer);
    this.queue = []; this.secret = null; this.encryptor = null; this.decryptor = null; this.bufferedAmount = 0;
    this.dispatchEvent(new Event('close'));
  }
}
