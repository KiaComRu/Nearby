import http from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, statfs } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { createStatisticsReporter } from './transfer-statistics.mjs';
import { createLanPeer } from './lan-peer.mjs';
import { createLanDiscovery } from './lan-discovery.mjs';
import { createTrustedLan } from './trusted-lan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = () => randomBytes(24).toString('hex');
const ttl = 5 * 60_000;
const sessionTtl = 12 * 60 * 60_000;
const maxRecords = 200;
const fail = (status, message) => Object.assign(new Error(message), { status });

export function safeName(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 180 ||
      /[\x00-\x1f\x7f<>:"/\\|?*]/u.test(value) || /[. ]$/u.test(value) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(value) ||
      value === '.' || value === '..') {
    throw fail(400, 'Недопустимое имя файла. Переименуйте файл и повторите.');
  }
  return value;
}

function sameSecret(a, b) {
  if (typeof a !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function jsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw fail(413, 'Слишком большой запрос.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, 'Некорректный JSON.'); }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function fileSpec(data, maxSize) {
  const name = safeName(data.name);
  if (!Number.isSafeInteger(data.size) || data.size < 0 || data.size > maxSize) {
    throw fail(400, 'Недопустимый размер файла.');
  }
  return { name, size: data.size };
}

function openFolder(folder) {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(command, [folder], { shell: false, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

export async function createApp({
  host = '0.0.0.0', port = 53317,
  storage = path.join(here, 'storage'),
  receivedDirectory,
  assetsDirectory = path.join(here, 'public'),
  maxSize = 100 * 1024 ** 3,
  openReceivedFolder = openFolder,
  statistics = {},
  discovery = host === '0.0.0.0' && process.env.NEARBY_DISABLE_DISCOVERY !== '1' ? {} : false,
  trustedLan = host === '0.0.0.0' && process.env.NEARBY_DISABLE_TRUSTED_LAN !== '1' ? {} : false,
} = {}) {
  const inbox = receivedDirectory ? path.resolve(receivedDirectory) : path.resolve(storage, 'received');
  const outbox = path.join(storage, 'shared');
  await mkdir(inbox, { recursive: true });
  await mkdir(outbox, { recursive: true });
  const reporter = statistics === false ? null : createStatisticsReporter({ storage, ...statistics });
  const recordTransfer = async (id, size) => {
    try { await reporter?.record(id, size); }
    catch { /* A saved file stays successful if statistics storage is unavailable. */ }
  };
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const adminToken = token();
  const sessions = new Map();
  const attempts = new Map();
  const offers = new Map();
  const shares = new Map();
  const tickets = new Map();
  const active = new Set();
  let closing = false;
  let boundPort;
  const addressScore = value => value.startsWith('192.168.') ? 0 : value.startsWith('10.') ? 1 : 2;
  const readAddresses = () => [...new Set(Object.values(networkInterfaces()).flat()
    .filter(x => x && x.family === 'IPv4' && !x.internal).map(x => x.address))]
    .sort((left, right) => addressScore(left) - addressScore(right));
  let addresses = readAddresses();
  const allowedHosts = new Set(['localhost', '127.0.0.1', ...addresses]);
  if (host !== '0.0.0.0') allowedHosts.add(host);
  let trustedService;
  const peer = createLanPeer({ isSelf: url => allowedHosts.has(url.hostname) && Number(url.port || 80) === boundPort, trusted: () => trustedService });
  const version = JSON.parse(await readFile(path.join(here, 'package.json'), 'utf8')).version;
  let discoveryService;
  let diagnosing = false;
  function updateAddresses() {
    addresses = readAddresses(); allowedHosts.clear();
    for (const address of ['localhost', '127.0.0.1', ...addresses, ...(host === '0.0.0.0' ? [] : [host])]) allowedHosts.add(address);
  }
  const publicOffer = ({ id, name, size, state, created, received, device, error, secure }) =>
    ({ id, name, size, state, created, received, device, error, secure });
  const publicShare = ({ id, name, size }) => ({ id, name, size });

  function auth(req, adminOnly = false) {
    if (req.socket.encrypted) { if (adminOnly) throw fail(403, 'Нужен локальный владелец.'); return trustedService.authentication(req); }
    const value = req.headers.authorization?.replace(/^Bearer /u, '');
    const remote = req.socket.remoteAddress;
    if (sameSecret(value, adminToken) &&
        ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return { admin: true };
    if (adminOnly) throw fail(403, 'Нужен доступ владельца на этом компьютере.');
    const session = sessions.get(value);
    if (!session || Date.now() - session.created > sessionTtl) {
      throw fail(401, 'Подключитесь с помощью PIN ещё раз.');
    }
    return { ...session, key: value, admin: false };
  }

  function prune() {
    const now = Date.now();
    for (const [key, value] of sessions) if (now - value.created > sessionTtl) sessions.delete(key);
    for (const [key, value] of attempts) if (now - value.since > ttl) attempts.delete(key);
    for (const [key, value] of tickets) if (now > value.expires) tickets.delete(key);
    for (const offer of offers.values()) {
      if (['pending', 'accepted'].includes(offer.state) && now > offer.expires) {
        offer.state = 'expired';
      }
    }
    for (const [id, offer] of offers) {
      if (!['pending', 'accepted', 'uploading'].includes(offer.state) && now - offer.created > sessionTtl) offers.delete(id);
    }
  }

  async function receive(req, spec, folder, onProgress = () => {}) {
    if (closing || active.size >= 3) throw fail(503, 'Заняты все каналы передачи. Повторите позже.');
    if (Number(req.headers['content-length']) !== spec.size || req.headers['transfer-encoding']) {
      throw fail(400, 'Размер содержимого не совпадает с заявленным.');
    }
    const id = randomUUID();
    active.add(id);
    const temporary = path.join(folder, `${id}.part`);
    const final = path.join(folder, `${id}-${spec.name}`);
    let received = 0;
    try {
      const disk = await statfs(folder);
      // Reserve headroom for other concurrent writes and the OS.
      if (Number(disk.bavail) * Number(disk.bsize) < spec.size + 64 * 1024 ** 2) {
        throw fail(507, 'Недостаточно свободного места на компьютере.');
      }
      req.setTimeout(60_000, () => req.destroy(new Error('Передача прервана по тайм-ауту.')));
      const counter = new Transform({
        transform(chunk, encoding, callback) {
          received += chunk.length;
          if (received > spec.size) return callback(fail(413, 'Превышен размер файла.'));
          onProgress(received);
          callback(null, chunk);
        },
      });
      await pipeline(req, counter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
      if (received !== spec.size) throw fail(400, 'Файл получен не полностью.');
      await rename(temporary, final);
      return final;
    } finally {
      active.delete(id);
      req.setTimeout(0);
      await rm(temporary, { force: true });
    }
  }

  const staticFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/statistics.js', ['statistics.js', 'text/javascript; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/favicon.ico', ['favicon.ico', 'image/x-icon']],
    ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
    ['/apple-touch-icon.png', ['apple-touch-icon.png', 'image/png']],
  ]);
  const handleRequest = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, `http://127.0.0.1:${boundPort}`);
      updateAddresses();
      const authority = new URL(`http://${req.headers.host}`);
      if (!allowedHosts.has(authority.hostname) || authority.port !== String(req.socket.encrypted ? trustedService.securePort : boundPort)) {
        throw fail(403, 'Недопустимый адрес сервера.');
      }
      if (req.headers.origin && req.headers.origin !== authority.origin) {
        throw fail(403, 'Запрос с другого сайта запрещён.');
      }
      prune();
      if (req.method === 'GET' && url.pathname === '/api/info') {
        json(res, 200, { product: 'Nearby', protocol: 'nearby-lan/1', version, secure: trustedService?.publicIdentity }); return;
      }
      if (url.pathname === '/api/trust' || url.pathname.startsWith('/api/trust/')) {
        auth(req, true);
        if (!trustedService) { if (req.method === 'GET') { json(res, 200, { enabled: false, devices: [], requests: [] }); return; } throw fail(409, 'Защищённое сопряжение отключено в этом запуске.'); }
        if (req.method === 'GET' && url.pathname === '/api/trust') { json(res, 200, { enabled: true, ...trustedService.state }); return; }
        if (req.method !== 'POST') throw fail(405, 'Используйте POST.');
        const body = await jsonBody(req);
        if (url.pathname === '/api/trust/pair') { json(res, 200, await trustedService.pair(body?.address)); return; }
        if (url.pathname === '/api/trust/confirm') await trustedService.confirm(body?.id);
        else if (url.pathname === '/api/trust/reject') await trustedService.reject(body?.id);
        else if (url.pathname === '/api/trust/revoke') await trustedService.revoke(body?.fingerprint);
        else if (url.pathname === '/api/trust/rename') await trustedService.rename(body?.fingerprint, body?.name);
        else throw fail(404, 'Адрес не найден.');
        json(res, 200, { ok: true }); return;
      }
      if (url.pathname === '/api/discovery' || url.pathname === '/api/discovery/refresh') {
        auth(req, true);
        if (req.method === 'POST' && url.pathname.endsWith('/refresh')) await discoveryService?.refresh();
        else if (req.method !== 'GET' || url.pathname !== '/api/discovery') throw fail(405, 'Используйте GET для списка устройств.');
        const found = discoveryService?.state || { status: 'disabled', devices: [], interfaces: [] };
        json(res, 200, { ...found, secureIdentity: trustedService ? { name: trustedService.identity.name, fingerprint: trustedService.identity.fingerprint } : undefined }); return;
      }
      if (url.pathname === '/api/peer/download' && req.method === 'GET') {
        await peer.download(req, res, url.searchParams.get('ticket')); return;
      }
      if (url.pathname.startsWith('/api/peer/')) {
        auth(req, true);
        if (req.method === 'POST' && url.pathname === '/api/peer/diagnose') {
          if (diagnosing) throw fail(429, 'Проверка уже выполняется. Дождитесь результата.');
          const body = await jsonBody(req); diagnosing = true;
          try { json(res, 200, await peer.diagnose(body?.address)); } finally { diagnosing = false; }
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/peer/connect') {
          const remote = await peer.connect(await jsonBody(req));
          json(res, 200, { ...remote, localAdmin: true, receivedDirectory: inbox }); return;
        }
        if (req.method === 'POST' && url.pathname === '/api/peer/disconnect') {
          peer.disconnect(); json(res, 200, { ok: true }); return;
        }
        if (req.method === 'GET' && url.pathname === '/api/peer/remote/api/state') {
          json(res, 200, { ...await peer.state(), localAdmin: true, receivedDirectory: inbox }); return;
        }
        if (url.pathname.startsWith('/api/peer/remote/')) {
          const result = await peer.proxy(req, res, url.pathname.slice('/api/peer/remote'.length));
          if (result) json(res, 200, result);
          return;
        }
        throw fail(404, 'Адрес не найден.');
      }
      if (req.method === 'GET' && url.pathname === '/api/statistics') {
        const totals = await reporter?.getStats();
        json(res, totals ? 200 : 503, totals || { error: 'Статистика временно недоступна.' });
        return;
      }
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [name, type] = staticFiles.get(url.pathname);
        res.writeHead(200, { 'Content-Type': type });
        res.end(await readFile(path.join(assetsDirectory, name)));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/join') {
        const ip = req.socket.remoteAddress;
        if (!attempts.has(ip)) attempts.set(ip, { count: 0, since: Date.now() });
        const attempt = attempts.get(ip);
        if (++attempt.count > 8) throw fail(429, 'Слишком много попыток. Подождите 5 минут.');
        const body = await jsonBody(req);
        if (!sameSecret(body.pin, pin)) throw fail(401, 'Неверный PIN.');
        if (sessions.size >= 100) throw fail(503, 'Слишком много подключённых устройств.');
        const key = token();
        sessions.set(key, { device: String(body.device || 'Устройство').slice(0, 60), created: Date.now() });
        json(res, 200, { token: key });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const user = auth(req);
        json(res, 200, {
          admin: user.admin,
          peerConnection: user.admin ? peer.connection : undefined,
          pin: user.admin ? pin : undefined,
          urls: user.admin ? addresses.map(ip => `http://${ip}:${boundPort}`) : undefined,
          receivedDirectory: user.admin ? inbox : undefined,
          offers: [...offers.values()].filter(x => user.admin || x.owner === user.key).map(publicOffer),
          shares: [...shares.values()].map(publicShare),
          maxSize,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/received/open') {
        auth(req, true);
        await openReceivedFolder(inbox);
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/qr') {
        auth(req, true);
        const ip = url.searchParams.get('ip');
        if (!addresses.includes(ip)) throw fail(400, 'Адрес отсутствует в локальной сети.');
        const svg = await QRCode.toString(`http://${ip}:${boundPort}/#pin=${pin}`, { type: 'svg', margin: 2, width: 240 });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end(svg);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/offers') {
        const user = auth(req);
        if (user.admin) throw fail(400, 'Выберите файлы в разделе «Отдать файлы».');
        if (offers.size >= maxRecords || [...offers.values()].filter(x => x.owner === user.key && ['pending', 'accepted', 'uploading'].includes(x.state)).length >= 10) {
          throw fail(429, 'Слишком много запросов. Дождитесь завершения передачи.');
        }
        const spec = fileSpec(await jsonBody(req), maxSize);
        const offer = { ...spec, id: randomUUID(), owner: user.key, device: user.device, secure: !!user.trustedFingerprint,
          state: 'pending', received: 0, created: Date.now(), expires: Date.now() + ttl };
        offers.set(offer.id, offer);
        json(res, 201, publicOffer(offer));
        return;
      }
      const offerRoute = url.pathname.match(/^\/api\/offers\/([a-f0-9-]+)(?:\/(upload))?$/u);
      if (req.method === 'POST' && offerRoute) {
        const offer = offers.get(offerRoute[1]);
        if (!offer) throw fail(404, 'Запрос не найден.');
        if (!offerRoute[2]) {
          auth(req, true);
          if (offer.state !== 'pending') throw fail(409, 'Запрос уже обработан или истёк.');
          const body = await jsonBody(req);
          if (!['accept', 'reject'].includes(body.action)) throw fail(400, 'Неизвестное действие.');
          offer.state = body.action === 'accept' ? 'accepted' : 'rejected';
          offer.expires = Date.now() + ttl;
          json(res, 200, publicOffer(offer));
        } else {
          const user = auth(req);
          if (offer.owner !== user.key) throw fail(403, 'Запрос принадлежит другому устройству.');
          if (offer.state !== 'accepted') throw fail(409, 'Сначала получатель должен подтвердить приём.');
          offer.state = 'uploading';
          try {
            offer.path = await receive(req, offer, inbox, bytes => { offer.received = bytes; });
            offer.state = 'completed';
            await recordTransfer(offer.id, offer.size);
            json(res, 201, publicOffer(offer));
          } catch (error) {
            offer.state = 'failed';
            offer.error = error.status ? error.message : 'Передача прервана. Отправьте файл заново.';
            throw error;
          }
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/shares') {
        auth(req, true);
        if (shares.size >= maxRecords) throw fail(429, 'Удалите ненужные файлы из списка раздачи.');
        const spec = fileSpec({ name: url.searchParams.get('name'), size: Number(url.searchParams.get('size')) }, maxSize);
        const filePath = await receive(req, spec, outbox);
        const share = { ...spec, id: randomUUID(), path: filePath };
        shares.set(share.id, share);
        json(res, 201, publicShare(share));
        return;
      }
      const shareRoute = url.pathname.match(/^\/api\/shares\/([a-f0-9-]+)(?:\/(ticket|download))?$/u);
      if (shareRoute) {
        const share = shares.get(shareRoute[1]);
        if (!share) throw fail(404, 'Файл больше не доступен.');
        if (req.method === 'POST' && shareRoute[2] === 'ticket') {
          const user = auth(req);
          if (tickets.size >= 1000) throw fail(429, 'Слишком много скачиваний. Повторите позже.');
          const key = token();
          tickets.set(key, { share: share.id, expires: Date.now() + ttl, countTransfer: !user.admin, trustedFingerprint: user.trustedFingerprint });
          json(res, 200, { url: `/api/shares/${share.id}/download?ticket=${key}` });
          return;
        }
        if (req.method === 'GET' && shareRoute[2] === 'download') {
          const key = url.searchParams.get('ticket');
          const ticket = tickets.get(key);
          if (!ticket || ticket.share !== share.id) throw fail(403, 'Ссылка истекла. Нажмите «Скачать» ещё раз.');
          if (ticket.trustedFingerprint && (!req.socket.encrypted || auth(req).trustedFingerprint !== ticket.trustedFingerprint)) throw fail(403, 'Эта ссылка требует защищённого соединения с сопряжённым устройством.');
          tickets.delete(key);
          const info = await stat(share.path);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': info.size,
            'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(share.name).replace(/'/gu, '%27')}` });
          await pipeline(createReadStream(share.path), res);
          if (ticket.countTransfer) await recordTransfer(randomUUID(), info.size);
          return;
        }
        if (req.method === 'DELETE' && !shareRoute[2]) {
          auth(req, true);
          shares.delete(share.id);
          await rm(share.path, { force: true });
          json(res, 200, { ok: true });
          return;
        }
      }
      throw fail(404, 'Адрес не найден.');
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error.status || 500,
        { error: error.status ? error.message : 'Не удалось выполнить операцию. Проверьте соединение и место на диске.', ...(error.status && error.code ? { code: error.code } : {}) });
      else if (!res.destroyed) res.destroy();
    }
  };
  const server = http.createServer({ requestTimeout: 0, headersTimeout: 15_000 }, handleRequest);
  server.maxConnections = 100;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  boundPort = server.address().port;
  if (trustedLan !== false) {
    try { trustedService = await createTrustedLan({ storage, host, httpPort: boundPort, version, transferHandler: handleRequest,
      onRevoke: fingerprint => { if (peer.connection?.fingerprint === fingerprint) peer.disconnect(); }, ...trustedLan }); }
    catch (error) { await reporter?.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); throw error; }
  }
  if (discovery !== false) {
    discoveryService = createLanDiscovery({ port: boundPort, version,
      ...(trustedService ? { name: trustedService.identity.name, secure: { port: trustedService.securePort, fingerprint: trustedService.identity.fingerprint } } : {}), ...discovery });
    await discoveryService.ready;
  }
  return {
    server, pin, adminToken, port: boundPort, inbox,
    urls: addresses.map(ip => `http://${ip}:${boundPort}`),
    adminUrl: `http://127.0.0.1:${boundPort}/#admin=${adminToken}`,
    async close() {
      closing = true;
      peer.disconnect();
      await trustedService?.close();
      await discoveryService?.close();
      await reporter?.close();
      await new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const app = await createApp({ port: Number(process.env.PORT || 53317) });
    console.log(`\nNearby Transfer · локальная передача файлов\n\nОкно владельца (только на этом ПК):\n${app.adminUrl}\n\nPIN: ${app.pin}\n\nАдреса для второго устройства:\n${app.urls.join('\n') || 'Локальная сеть не найдена.'}\n\nПолученные файлы: ${app.inbox}\n\nОткройте окно владельца по ссылке выше. Для выхода нажмите Ctrl+C.\n`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); });
  } catch (error) {
    console.error(error.code === 'EADDRINUSE' ? 'Порт 53317 занят. Закройте другую копию приложения или задайте PORT.' : error.message);
    process.exitCode = 1;
  }
}
