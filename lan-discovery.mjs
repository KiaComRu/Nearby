import dgram from 'node:dgram';
import { randomInt, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { isIPv4 } from 'node:net';

export const DISCOVERY_PORT = 53318;
export const DISCOVERY_GROUP = '239.255.53.17';
const protocol = 'nearby-discovery/1';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function privateIPv4(address) {
  if (!isIPv4(address)) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
export function discoveryInterfaces() {
  return [...new Map(Object.values(networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal && privateIPv4(item.address)).map(item => [item.address, item])).values()];
}
export function discoveryName() {
  const mountains = ['Эльбрус', 'Дыхтау', 'Шхара', 'Коштантау', 'Казбек', 'Джангитау'];
  const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux';
  return `${platform} · ${mountains[randomInt(mountains.length)]}`;
}

// Discovery messages are untrusted hints. They contain no PIN, auth token or files.
// A discovered endpoint is checked over HTTP and still requires the receiver's PIN.
export function createLanDiscovery({ port, version, name = discoveryName(), id = randomUUID(), secure,
  getInterfaces = discoveryInterfaces, socketFactory = () => dgram.createSocket({ type: 'udp4', reuseAddr: true }),
  now = Date.now, intervalMs = 5000, staleMs = 20000, udpPort = DISCOVERY_PORT,
} = {}) {
  let socket, timer, closed = false, status = 'starting', errorCode = null, busy = false;
  let interfaces = [], lastRefresh = -Infinity, lastAnnounce = -Infinity, lastRetry = -Infinity;
  let memberships = new Set(), pendingRefresh = null;
  const peers = new Map();
  let rateStart = now(), incoming = 0;
  function prune() {
    const time = now();
    for (const [peerId, peer] of peers) {
      for (const [origin, seen] of peer.origins) if (time - seen > staleMs) peer.origins.delete(origin);
      if (!peer.origins.size) peers.delete(peerId);
    }
  }
  function receive(bytes, remote) {
    if (closed || bytes.length > 1024 || !privateIPv4(remote.address)) return;
    if (now() - rateStart >= 1000) { rateStart = now(); incoming = 0; }
    if (++incoming > 64) return;
    let message;
    try { message = JSON.parse(bytes.toString('utf8')); } catch { return; }
    if (!message || message.protocol !== protocol || !uuid(message.id) || message.id === id || !['announce', 'probe', 'bye'].includes(message.type)) return;
    if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535 ||
        typeof message.name !== 'string' || !message.name.trim() || Buffer.byteLength(message.name) > 100 || /[\x00-\x1f\x7f]/u.test(message.name) ||
        typeof message.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(message.version)) return;
    const origin = `http://${remote.address}:${message.port}`;
    if (message.type === 'bye') {
      const peer = peers.get(message.id); peer?.origins.delete(origin); if (peer && !peer.origins.size) peers.delete(message.id); return;
    }
    prune();
    if (!peers.has(message.id)) {
      if (peers.size >= 100) return;
      peers.set(message.id, { name: message.name, version: message.version, origins: new Map() });
    }
    const peer = peers.get(message.id);
    if (!peer.origins.has(origin) && peer.origins.size >= 8) return;
    peer.name = message.name; peer.version = message.version; peer.origins.set(origin, now());
    if (message.secure && Number.isInteger(message.secure.port) && message.secure.port > 0 && message.secure.port <= 65535 && /^[a-f0-9]{64}$/.test(message.secure.fingerprint || '')) peer.secure = { port: message.secure.port, fingerprint: message.secure.fingerprint };
    if (message.type === 'probe' && now() - lastAnnounce >= 1000 && !pendingRefresh) {
      pendingRefresh = setTimeout(() => { pendingRefresh = null; void announce('announce'); }, randomInt(20, 150));
      pendingRefresh.unref?.();
    }
  }
  function updateMemberships() {
    const current = getInterfaces().filter(item => privateIPv4(item.address)).slice(0, 16);
    const addresses = new Set(current.map(item => item.address));
    if (interfaces.map(item => item.address).sort().join() !== [...addresses].sort().join()) peers.clear();
    interfaces = current;
    for (const address of memberships) if (!addresses.has(address)) {
      try { socket.dropMembership(DISCOVERY_GROUP, address); } catch {}
      memberships.delete(address);
    }
    for (const address of addresses) if (!memberships.has(address)) {
      try { socket.addMembership(DISCOVERY_GROUP, address); memberships.add(address); } catch (error) { errorCode = error.code || 'UDP_ERROR'; }
    }
    status = !interfaces.length ? 'no-network' : memberships.size ? 'listening' : 'unavailable';
    if (status === 'listening') errorCode = null;
  }
  async function announce(type = 'announce') {
    if (closed || busy || !socket) return;
    busy = true;
    try {
      updateMemberships();
      let sent = 0;
      const data = Buffer.from(JSON.stringify({ protocol, type, id, port, name, version, secure }));
      for (const address of memberships) {
        if (closed) break;
        try {
          socket.setMulticastInterface(address);
          await new Promise((resolve, reject) => socket.send(data, udpPort, DISCOVERY_GROUP, error => error ? reject(error) : resolve()));
          lastAnnounce = now();
          sent++;
        } catch (error) { errorCode = error.code || 'UDP_ERROR'; status = 'unavailable'; }
      }
      if (sent) { status = 'listening'; errorCode = null; }
    } catch (error) { errorCode = error.code || 'UDP_ERROR'; status = 'unavailable'; }
    finally { busy = false; }
  }
  function retire() {
    const old = socket; socket = null; memberships.clear();
    if (old) try { old.close(); } catch {}
  }
  async function start() {
    if (closed || socket) return;
    lastRetry = now();
    let candidate;
    try {
      candidate = socketFactory(); socket = candidate;
      candidate.on('message', receive);
      candidate.on('error', error => { if (socket === candidate) { errorCode = error.code || 'UDP_ERROR'; status = 'unavailable'; retire(); } });
      await new Promise((resolve, reject) => {
        candidate.once('error', reject);
        candidate.bind(udpPort, '0.0.0.0', () => { candidate.removeListener('error', reject); resolve(); });
      });
      if (closed || socket !== candidate) return;
      candidate.setMulticastTTL(1); candidate.setMulticastLoopback(true); candidate.unref?.();
      await announce('probe');
    } catch (error) { errorCode = error.code || 'UDP_ERROR'; status = 'unavailable'; retire(); }
  }
  const ready = start();
  timer = setInterval(() => {
    prune();
    if (!socket && now() - lastRetry >= 15000) void start(); else void announce();
  }, intervalMs);
  timer.unref?.();
  return {
    ready,
    get state() {
      prune();
      return { status, errorCode, name, interfaces: interfaces.map(item => item.address),
        devices: [...peers].map(([peerId, peer]) => ({ id: peerId, name: peer.name, version: peer.version, origins: [...peer.origins.keys()], ...(peer.secure ? { secure: peer.secure } : {}) })).sort((a, b) => a.name.localeCompare(b.name, 'ru')) };
    },
    async refresh() {
      if (now() - lastRefresh < 2000) return;
      lastRefresh = now();
      if (!socket) { if (now() - lastRetry >= 15000) await start(); } else await announce('probe');
    },
    async close() {
      if (closed) return;
      // Best-effort goodbye; TTL expiry handles abrupt process termination.
      await announce('bye'); closed = true; clearInterval(timer); clearTimeout(pendingRefresh); peers.clear(); retire();
    },
  };
}
