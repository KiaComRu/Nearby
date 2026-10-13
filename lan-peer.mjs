import http from 'node:http';
import https from 'node:https';
import { isIPv4 } from 'node:net';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { tlsJson } from './lan-tls.mjs';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
export function peerNetworkError(error) {
  const code = error?.cause?.code || error?.code;
  if (code === 'ECONNREFUSED') return { code: 'connection-refused', message: 'Нет связи с другим ПК. Подключение к порту отклонено. Проверьте, что Nearby открыт и адрес скопирован после его последнего запуска.' };
  if (['ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL'].includes(code)) return { code: 'network-unreachable', message: 'Нет связи с другим ПК. Нет доступного маршрута к адресу. Проверьте общую сеть, выбранный адаптер и настройки VPN.' };
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) || ['AbortError', 'TimeoutError'].includes(error?.name)) return { code: 'timeout', message: 'Нет связи с другим ПК. Ответ не пришёл вовремя. Проверьте адрес, общую сеть, изоляцию Wi-Fi и разрешение Nearby в брандмауэре частной сети.' };
  return { code: 'peer-unreachable', message: 'Нет связи с другим ПК. Проверьте адрес, общую сеть и разрешение Nearby в брандмауэре для частной сети.' };
}
export function lanOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw fail(400, 'Введите адрес из окна Nearby другого компьютера: http://192.168.1.10:53317.'); }
  const parts = url.hostname.split('.').map(Number);
  const privateAddress = isIPv4(url.hostname) && (parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
  if (url.protocol !== 'http:' || !privateAddress || url.username || url.password || url.search ||
      (url.pathname !== '/' && url.pathname !== '') || (url.hash && !/^#pin=[0-9]{6}$/.test(url.hash))) {
    throw fail(400, 'Нужен локальный HTTP-адрес из окна Nearby другого ПК. Ссылка на сайт или окно владельца не подходит.');
  }
  return url.origin;
}

export function createLanPeer({ isSelf, trusted = () => null }) {
  let peer = null, connecting = false, generation = 0;
  const requests = new Set(), downloads = new Map();
  async function requestJson(connection, route, body, authorize = true, timeoutMs = 12000) {
    if (connection.secure) {
      if (!trusted()?.allows(connection.fingerprint)) throw fail(403, 'Доверие к устройству отозвано.', 'trust-required');
      return tlsJson(connection.origin, route, connection.tls, body === null ? undefined : body, { requests, timeout: timeoutMs });
    }
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(connection.origin + route, { method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
        headers: { ...(authorize ? { Authorization: `Bearer ${connection.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (Number(response.headers.get('content-length')) > 1048576) throw fail(502, 'Другой ПК вернул слишком большой ответ.');
      // Bound JSON even when Content-Length is absent.
      const chunks = []; let size = 0;
      for await (const bytes of response.body) { size += bytes.length; if (size > 1048576) throw fail(502, 'Другой ПК вернул слишком большой ответ.'); chunks.push(bytes); }
      const text = Buffer.concat(chunks).toString('utf8');
      let data;
      try { data = JSON.parse(text); } catch { throw fail(502, 'По этому адресу не найден совместимый Nearby. Обновите приложение на обоих ПК.', 'incompatible'); }
      if (!response.ok) throw fail(response.status === 401 && authorize ? 409 : response.status,
        response.status === 401 && authorize ? 'Другой ПК перезапущен или сеанс завершён. Отключитесь и подключитесь с его новым PIN.' : data.error || 'Другой ПК отклонил запрос.',
        response.status === 401 ? authorize ? 'session-ended' : 'wrong-pin' : response.status === 429 ? 'rate-limited' : 'peer-rejected');
      return data;
    } catch (error) {
      if (error.status) throw error;
      const detail = peerNetworkError(error); throw fail(504, detail.message, detail.code);
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function current() { if (!peer) throw fail(409, 'Сначала подключитесь к другому компьютеру.'); return peer; }
  async function state(connection = current()) {
    const result = await requestJson(connection, '/api/state');
    if (result.admin !== false || !Array.isArray(result.offers) || !Array.isArray(result.shares) || !Number.isSafeInteger(result.maxSize)) throw fail(502, 'Несовместимый ответ другого ПК.');
    return { admin: false, offers: result.offers, shares: result.shares, maxSize: result.maxSize, peer: { origin: connection.origin, secure: !!connection.secure, fingerprint: connection.secure ? connection.fingerprint : undefined, name: connection.name } };
  }
  async function stream(req, res, route, connection, authorize = true) {
    const headers = { ...(authorize ? { Authorization: `Bearer ${connection.token}` } : {}) };
    for (const name of ['content-type', 'content-length']) if (req.headers[name] && req.method !== 'GET') headers[name] = req.headers[name];
    if (connection.secure && !trusted()?.allows(connection.fingerprint)) throw fail(403, 'Доверие отозвано.');
    const upstream = (connection.secure ? https : http).request(connection.origin + route, { ...(connection.secure ? connection.tls : {}), method: req.method, headers });
    requests.add(upstream);
    const abort = () => { if (!res.writableFinished) upstream.destroy(); };
    req.once('aborted', abort); req.once('error', abort); res.once('close', abort);
    upstream.setTimeout(60000, () => upstream.destroy(new Error('Peer timeout')));
    try {
      const responseReady = new Promise((resolve, reject) => { upstream.once('response', resolve); upstream.once('error', reject); });
      if (req.method === 'GET') upstream.end(); else req.pipe(upstream);
      const response = await responseReady;
      const safeHeaders = {};
      for (const name of ['content-type', 'content-length', 'content-disposition']) if (response.headers[name]) safeHeaders[name] = response.headers[name];
      res.writeHead(response.statusCode === 401 ? 409 : response.statusCode, safeHeaders);
      await pipeline(response, res);
    } catch {
      if (!res.headersSent) throw fail(504, 'Передача между ПК прервана. Проверьте сеть и повторите отправку.');
      if (!res.destroyed) res.destroy();
    } finally {
      upstream.destroy(); requests.delete(upstream); req.off('aborted', abort); req.off('error', abort); res.off('close', abort);
    }
  }
  return {
    get connection() { return peer ? { origin: peer.origin, secure: !!peer.secure, fingerprint: peer.secure ? peer.fingerprint : undefined } : null; },
    async diagnose(address) {
      const origin = lanOrigin(address);
      if (isSelf(new URL(origin))) return { ok: false, code: 'self-address', message: 'Это адрес этого компьютера. Выберите другой ПК.' };
      const started = Date.now();
      try {
        const info = await requestJson({ origin }, '/api/info', null, false, 5000);
        if (info.product !== 'Nearby' || info.protocol !== 'nearby-lan/1') return { ok: false, code: 'incompatible', message: 'По этому адресу другое приложение или несовместимый Nearby. Обновите оба ПК.' };
        return { ok: true, code: 'ready', message: 'Nearby отвечает. Для подключения введите PIN из окна этого ПК.', version: typeof info.version === 'string' && /^\d+\.\d+\.\d+$/.test(info.version) ? info.version : '', latencyMs: Date.now() - started, origin };
      } catch (error) {
        return { ok: false, code: error.status === 404 ? 'incompatible' : error.code || 'peer-rejected', message: error.status === 404 ? 'Найдено приложение без проверки доступности. Обновите Nearby на обоих ПК.' : error.message };
      }
    },
    async connect(body) {
      if (!body || typeof body !== 'object') throw fail(400, 'Введите адрес, PIN и имя компьютера.');
      if (connecting || peer) throw fail(409, 'Сначала завершите текущее подключение.');
      if (body.fingerprint !== undefined) {
        if (!/^[a-f0-9]{64}$/.test(body.fingerprint || '') || !trusted()) throw fail(400, 'Некорректное доверенное устройство.');
        connecting = true; const attempt = generation;
        try {
          const connection = await trusted().connection(body.fingerprint, body.address);
          const result = await state(connection);
          if (attempt !== generation) throw fail(409, 'Подключение отменено.');
          peer = connection; return result;
        } finally { connecting = false; }
      }
      const origin = lanOrigin(body.address);
      if (isSelf(new URL(origin))) throw fail(400, 'Это адрес этого компьютера. Введите адрес из Nearby на другом ПК.');
      if (!/^[0-9]{6}$/.test(body.pin || '') || typeof body.device !== 'string' || !body.device.trim() || body.device.length > 60) throw fail(400, 'Введите шестизначный PIN и имя этого компьютера.');
      connecting = true; const attempt = generation;
      try {
        const connection = { origin };
        let info;
        try { info = await requestJson(connection, '/api/info', null, false); }
        catch (error) { if (error.status === 404) throw fail(409, 'Обновите Nearby на обоих ПК до версии 0.2.2 или новее.'); throw error; }
        if (info.product !== 'Nearby' || info.protocol !== 'nearby-lan/1') throw fail(400, 'Обновите Nearby на обоих ПК до версии 0.2.2 или новее.');
        const joined = await requestJson(connection, '/api/join', { pin: body.pin, device: body.device.trim() }, false);
        if (!/^[a-f0-9]{48}$/.test(joined.token || '')) throw fail(502, 'Другой ПК вернул некорректный ключ.');
        connection.token = joined.token;
        const result = await state(connection);
        if (attempt !== generation) throw fail(409, 'Подключение отменено.');
        peer = connection; return result;
      } finally { connecting = false; }
    },
    state,
    disconnect() {
      generation++; peer = null; downloads.clear();
      for (const request of requests) { if (request.abort) request.abort(); else request.destroy(); }
    },
    async proxy(req, res, route) {
      const connection = current();
      const ticketRoute = route.match(/^\/api\/shares\/([a-f0-9-]{36})\/ticket$/);
      if (req.method === 'POST' && ticketRoute) {
        const result = await requestJson(connection, route, {});
        if (typeof result.url !== 'string' || !new RegExp(`^/api/shares/${ticketRoute[1]}/download\\?ticket=[a-f0-9]{48}$`).test(result.url)) throw fail(502, 'Некорректная ссылка скачивания от другого ПК.');
        const now = Date.now();
        for (const [key, value] of downloads) if (value.expires < now) downloads.delete(key);
        if (downloads.size >= 1000) throw fail(429, 'Слишком много скачиваний. Повторите позже.');
        const ticket = randomBytes(24).toString('hex');
        downloads.set(ticket, { connection, route: result.url, expires: now + 300000 });
        return { url: `/api/peer/download?ticket=${ticket}` };
      }
      if (req.method !== 'POST' || !/^\/api\/offers(?:\/[a-f0-9-]{36}\/upload)?$/.test(route)) throw fail(403, 'Эта операция недоступна для подключения к другому ПК.');
      await stream(req, res, route, connection);
    },
    async download(req, res, key) {
      const ticket = downloads.get(key);
      if (!ticket || ticket.expires < Date.now() || ticket.connection !== peer) throw fail(403, 'Ссылка истекла. Нажмите «Скачать» ещё раз.');
      downloads.delete(key);
      await stream(req, res, ticket.route, ticket.connection, false);
    },
  };
}
