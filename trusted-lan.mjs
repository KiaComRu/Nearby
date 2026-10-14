import https from 'node:https';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, loadDeviceIdentity, certificateFingerprint, validFingerprint, validDeviceName } from './device-identity.mjs';
import { pinnedTls, probeCertificate, peerCertificate, tlsJson } from './lan-tls.mjs';
import { lanOrigin } from './lan-peer.mjs';
import { privateIPv4 } from './lan-discovery.mjs';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const nonce = () => randomBytes(32).toString('hex');
const validPort = value => Number.isInteger(value) && value > 0 && value <= 65535;
export function pairingCode({ initiator, responder, nonceA, nonceB, id }) {
  if (![initiator, responder, nonceA, nonceB, id].every(validFingerprint)) throw fail(400, 'Некорректное сопряжение.');
  return createHash('sha256').update(JSON.stringify(['Nearby pairing v1', initiator, responder, nonceA, nonceB, id])).digest('hex').toUpperCase().match(/.{8}/g).join(' ');
}
async function readBody(req) {
  const parts = []; let size = 0;
  for await (const bytes of req) { size += bytes.length; if (size > 8192) throw fail(413, 'Слишком большой запрос.'); parts.push(bytes); }
  try { const body = JSON.parse(Buffer.concat(parts).toString()); if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error(); return body; }
  catch { throw fail(400, 'Некорректный запрос.'); }
}
function reply(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); }

export async function createTrustedLan({ storage, host, httpPort, version, transferHandler, onRevoke = () => {}, identityOptions = {} }) {
  const identity = await loadDeviceIdentity(storage, identityOptions), file = path.join(storage, 'trusted-devices.json');
  let records = [], writeChain = Promise.resolve(), closed = false, syncing = false, pairingBusy = false;
  const pending = new Map(), sockets = new Set(), requests = new Set(), attempts = new Map();
  let stored;
  try { stored = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Список доверенных устройств повреждён и сохранён без изменений.'); }
  if (stored) {
    if (stored.version !== 1 || !Array.isArray(stored.devices) || stored.devices.length > 100) throw new Error('Неизвестный формат доверенных устройств.');
    const seen = new Set();
    for (const item of stored.devices) {
      if (!validFingerprint(item.fingerprint) || seen.has(item.fingerprint) || certificateFingerprint(item.cert) !== item.fingerprint || !validDeviceName(item.name) || !Number.isSafeInteger(item.pairedAt)) throw new Error('Список доверенных устройств недействителен.');
      lanOrigin(item.address); const origin = new URL(item.origin);
      if (origin.protocol !== 'https:' || !privateIPv4(origin.hostname) || !validPort(Number(origin.port)) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Некорректный адрес доверенного устройства.');
      seen.add(item.fingerprint);
    }
    records = stored.devices.map(({ fingerprint, cert, name, address, origin, pairedAt }) => ({ fingerprint, cert, name, address, origin, pairedAt }));
  }
  const save = mutate => {
    const operation = writeChain.then(async () => { const next = structuredClone(records); mutate(next); await atomicJson(file, { version: 1, devices: next }); records = next; });
    writeChain = operation.catch(() => {}); return operation;
  };
  const find = fingerprint => records.find(item => item.fingerprint === fingerprint);
  function prune() {
    const now = Date.now();
    for (const [id, item] of pending) if (item.expires < now) pending.delete(id);
    for (const [ip, item] of attempts) if (now - item.since > 300000) attempts.delete(ip);
  }
  async function finalize(item) {
    if (!item.localConfirmed || !item.remoteConfirmed || item.saved || item.rejected) return;
    if (item.finalizing) return item.finalizing;
    item.finalizing = save(next => {
      if (closed || pending.get(item.id) !== item || item.rejected || item.expires < Date.now()) throw fail(409, 'Сопряжение уже завершено или отменено.');
      const index = next.findIndex(record => record.fingerprint === item.fingerprint);
      const record = { fingerprint: item.fingerprint, cert: item.cert, name: item.name, address: item.address, origin: item.origin, pairedAt: Date.now() };
      if (index < 0) { if (next.length >= 100) throw fail(429, 'Удалите ненужные устройства из списка.'); next.push(record); } else next[index] = record;
    }).then(() => { item.saved = true; }).finally(() => { item.finalizing = null; });
    return item.finalizing;
  }
  function authentication(req) {
    const { fingerprint } = peerCertificate(req), record = find(fingerprint);
    if (!record) throw fail(403, 'Сопряжение не подтверждено или отозвано. Подтвердите устройство на обоих ПК.', 'trust-required');
    req.socket.nearbyFingerprint = fingerprint;
    return { admin: false, key: 'trusted:' + fingerprint, device: record.name, trustedFingerprint: fingerprint };
  }
  let securePort;
  const server = https.createServer({ key: identity.key, cert: identity.cert, minVersion: 'TLSv1.3', requestCert: true, rejectUnauthorized: false, requestTimeout: 0, headersTimeout: 10000 }, async (req, res) => {
    try {
      const route = new URL(req.url, 'https://nearby-device').pathname;
      if (req.headers.origin) throw fail(403, 'Этот транспорт предназначен для приложений Nearby.');
      const remote = peerCertificate(req);
      req.socket.nearbyFingerprint = remote.fingerprint;
      if (req.method === 'GET' && route === '/v1/identity') { reply(res, 200, { product: 'Nearby', protocol: 'nearby-tls/1', name: identity.name, fingerprint: identity.fingerprint, version }); return; }
      prune();
      if (req.method === 'POST' && route === '/v1/pair') {
        const ip = req.socket.remoteAddress.replace(/^::ffff:/, '');
        if (!privateIPv4(ip)) throw fail(403, 'Сопряжение доступно в локальной сети.');
        if (!attempts.has(ip)) { if (attempts.size >= 200) throw fail(429, 'Слишком много запросов сопряжения.'); attempts.set(ip, { since: Date.now(), count: 0 }); }
        if (++attempts.get(ip).count > 10) throw fail(429, 'Слишком много запросов. Подождите 5 минут.');
        const body = await readBody(req);
        if (remote.fingerprint === identity.fingerprint || !validDeviceName(body.name) || !validFingerprint(body.nonceA) || !validPort(body.httpPort) || !validPort(body.securePort)) throw fail(400, 'Некорректное устройство или запрос.');
        if (pending.size >= 10 || [...pending.values()].some(item => item.fingerprint === remote.fingerprint && !item.saved && !item.rejected)) throw fail(409, 'Запрос сопряжения уже существует или список запросов заполнен.');
        const item = { id: nonce(), nonceA: body.nonceA, nonceB: nonce(), initiator: remote.fingerprint, responder: identity.fingerprint,
          ...remote, name: body.name, address: `http://${ip}:${body.httpPort}`, origin: `https://${ip}:${body.securePort}`, outgoing: false,
          localConfirmed: false, remoteConfirmed: false, expires: Date.now() + 120000 };
        item.code = pairingCode(item); pending.set(item.id, item);
        reply(res, 200, { id: item.id, nonceB: item.nonceB, name: identity.name }); return;
      }
      if (req.method === 'POST' && route === '/v1/pair/status') {
        const body = await readBody(req), item = pending.get(body.id);
        if (!item || item.outgoing || item.fingerprint !== remote.fingerprint || item.nonceA !== body.nonceA || item.nonceB !== body.nonceB) throw fail(403, 'Запрос сопряжения не найден.');
        if (body.cancel === true && !item.saved) item.rejected = true;
        if (!item.rejected) item.remoteConfirmed ||= body.confirmed === true;
        await finalize(item);
        reply(res, 200, { confirmed: item.localConfirmed, rejected: !!item.rejected, saved: !!item.saved }); return;
      }
      if (req.method === 'POST' && route === '/v1/revoke') { authentication(req); await revoke(remote.fingerprint, false); reply(res, 200, { ok: true }); return; }
      authentication(req);
      if (!((req.method === 'POST' && route === '/api/leave') || (req.method === 'GET' && (route === '/api/state' || /^\/api\/shares\/[a-f0-9-]{36}\/download$/.test(route))) ||
          (req.method === 'POST' && (/^\/api\/offers(?:\/[a-f0-9-]{36}\/upload)?$/.test(route) || /^\/api\/shares\/[a-f0-9-]{36}\/ticket$/.test(route))))) throw fail(403, 'Операция недоступна для доверенного устройства.');
      await transferHandler(req, res);
    } catch (error) { if (!res.headersSent && !res.destroyed) reply(res, error.status || 500, { error: error.status ? error.message : 'Не удалось выполнить защищённую операцию.', code: error.code }); else res.destroy(); }
  });
  server.maxConnections = 50;
  server.on('secureConnection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  securePort = server.address().port;
  async function resolveRemote(address, expected) {
    address = lanOrigin(address);
    const response = await fetch(address + '/api/info', { redirect: 'error', signal: AbortSignal.timeout(5000) });
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8192) throw fail(409, 'Некорректный ответ устройства.'); chunks.push(value); } }
    finally { await reader.cancel(); }
    const info = JSON.parse(Buffer.concat(chunks).toString());
    if (!response.ok || info.product !== 'Nearby' || !validPort(info.secure?.port) || !validFingerprint(info.secure?.fingerprint)) throw fail(409, 'Для защищённого сопряжения обновите Nearby на обоих ПК до 0.5.0. Переход на HTTP не выполнен.');
    if (info.secure.fingerprint === identity.fingerprint) throw fail(400, 'Это устройство уже открыто на этом ПК.');
    if (expected && info.secure.fingerprint !== expected) throw fail(409, 'Ключ по этому адресу изменился. Подключение остановлено.', 'identity-changed');
    const origin = `https://${new URL(address).hostname}:${info.secure.port}`;
    const cert = expected ? find(expected)?.cert : await probeCertificate(origin);
    if (!cert || certificateFingerprint(cert) !== info.secure.fingerprint) throw fail(409, 'Сертификат не совпадает с объявленным ключом.');
    const tls = pinnedTls(identity, cert);
    const remote = await tlsJson(origin, '/v1/identity', tls, undefined, { requests });
    if (remote.fingerprint !== certificateFingerprint(cert) || remote.protocol !== 'nearby-tls/1' || !validDeviceName(remote.name)) throw fail(409, 'Несовместимое устройство.');
    return { address, origin, cert, fingerprint: remote.fingerprint, name: remote.name, tls };
  }
  async function sync(item) {
    if (!item.outgoing || item.saved || item.rejected || closed) return;
    try {
      const result = await tlsJson(item.origin, '/v1/pair/status', item.tls, { id: item.id, nonceA: item.nonceA, nonceB: item.nonceB, confirmed: item.localConfirmed }, { requests });
      if (pending.get(item.id) !== item) return;
      item.remoteConfirmed ||= result.confirmed === true; item.rejected ||= result.rejected === true;
      await finalize(item); item.error = '';
    } catch { item.error = 'Проверка второго ПК не завершена. Оставьте оба приложения открытыми.'; }
  }
  const timer = setInterval(async () => {
    if (syncing || closed) return; syncing = true;
    try { prune(); await Promise.all([...pending.values()].filter(item => item.outgoing && !item.saved && !item.rejected).map(sync)); }
    finally { syncing = false; }
  }, 1500); timer.unref();
  async function revoke(fingerprint, notify = true) {
    if (!validFingerprint(fingerprint)) throw fail(400, 'Некорректное устройство.');
    const record = find(fingerprint);
    for (const [id, item] of pending) if (item.fingerprint === fingerprint) { item.rejected = true; pending.delete(id); }
    await save(next => { const index = next.findIndex(item => item.fingerprint === fingerprint); if (index >= 0) next.splice(index, 1); });
    onRevoke(fingerprint);
    // Revoke before notifying. An offline peer cannot keep this device's trust alive.
    for (const socket of sockets) if (socket.nearbyFingerprint === fingerprint && !socket.destroyed) socket.destroy();
    if (notify && record) try { await tlsJson(record.origin, '/v1/revoke', pinnedTls(identity, record.cert), {}, { requests, timeout: 2000 }); } catch {}
  }
  return {
    securePort, identity,
    get publicIdentity() { return { name: identity.name, fingerprint: identity.fingerprint, port: securePort }; },
    authentication,
    get state() { prune(); return { identity: { name: identity.name, fingerprint: identity.fingerprint }, devices: records.map(({ cert, ...item }) => item),
      requests: [...pending.values()].filter(item => !item.saved).map(item => ({ id: item.id, name: item.name, fingerprint: item.fingerprint, code: item.code, outgoing: item.outgoing, localConfirmed: item.localConfirmed, remoteConfirmed: item.remoteConfirmed, rejected: !!item.rejected, error: item.error || '', expires: item.expires })) }; },
    async pair(address) {
      if (closed) throw fail(409, 'Приложение завершает работу.');
      if (pairingBusy) throw fail(409, 'Уже создаётся запрос сопряжения. Дождитесь результата.');
      pairingBusy = true;
      try {
      prune(); if (pending.size >= 10) throw fail(429, 'Завершите текущие запросы сопряжения.');
      const remote = await resolveRemote(address);
      if (closed) throw fail(409, 'Сопряжение отменено при закрытии приложения.');
      if (find(remote.fingerprint)) throw fail(409, 'Устройство уже сохранено. Выберите «Подключиться» в «Моих устройствах».');
      if ([...pending.values()].some(item => item.fingerprint === remote.fingerprint && !item.saved && !item.rejected)) throw fail(409, 'Сопряжение уже выполняется.');
      const nonceA = nonce();
      const result = await tlsJson(remote.origin, '/v1/pair', remote.tls, { name: identity.name, nonceA, httpPort, securePort }, { requests });
      if (closed) throw fail(409, 'Сопряжение отменено при закрытии приложения.');
      if (!validFingerprint(result.id) || !validFingerprint(result.nonceB) || !validDeviceName(result.name)) throw fail(409, 'Некорректный ответ сопряжения.');
      const item = { ...remote, name: result.name, id: result.id, nonceA, nonceB: result.nonceB, initiator: identity.fingerprint, responder: remote.fingerprint,
        outgoing: true, localConfirmed: false, remoteConfirmed: false, expires: Date.now() + 120000 };
      item.code = pairingCode(item); pending.set(item.id, item); return { id: item.id };
      } finally { pairingBusy = false; }
    },
    async confirm(id) {
      prune(); const item = pending.get(id);
      if (!item || item.rejected) throw fail(409, 'Сопряжение закрыто. Создайте новый запрос.');
      item.localConfirmed = true; if (item.outgoing) await sync(item); else await finalize(item);
    },
    async reject(id) {
      const item = pending.get(id); if (!item) return;
      if (item.saved) { await revoke(item.fingerprint); return; }
      item.rejected = true;
      if (item.finalizing) await item.finalizing.catch(() => {});
      if (item.saved) { await revoke(item.fingerprint); return; }
      if (item.outgoing) try { await tlsJson(item.origin, '/v1/pair/status', item.tls, { id, nonceA: item.nonceA, nonceB: item.nonceB, cancel: true }, { requests }); } catch {}
    },
    async connection(fingerprint, address) {
      if (closed) throw fail(409, 'Приложение завершает работу.');
      if (!find(fingerprint)) throw fail(403, 'Это устройство не сохранено или доверие отозвано.');
      const remote = await resolveRemote(address || find(fingerprint).address, fingerprint);
      if (closed || !find(fingerprint)) throw fail(403, 'Доверие отозвано или приложение закрывается.');
      await save(next => { const record = next.find(item => item.fingerprint === fingerprint); if (!record) throw fail(403, 'Доверие отозвано.'); record.address = remote.address; record.origin = remote.origin; });
      return { ...remote, secure: true };
    },
    allows(fingerprint) { return !!find(fingerprint); },
    async rename(fingerprint, name) {
      if (!validFingerprint(fingerprint) || !validDeviceName(name)) throw fail(400, 'Недопустимое имя устройства.');
      await save(next => { const record = next.find(item => item.fingerprint === fingerprint); if (!record) throw fail(404, 'Устройство не найдено.'); record.name = name.trim(); });
    },
    revoke,
    async close() {
      closed = true; clearInterval(timer); for (const item of pending.values()) item.rejected = true; pending.clear();
      for (const request of requests) request.destroy();
      for (const socket of sockets) socket.destroy();
      await writeChain; await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}
