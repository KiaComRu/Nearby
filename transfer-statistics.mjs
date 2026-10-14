import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export const STATISTICS_ENDPOINT = 'https://nearby.kiacom.ru/web/api.php';
const retention = 7 * 86400;
const validEvent = event => event && /^[a-f0-9-]{36}$/.test(event.id) &&
  (event.kind === 'usage' ? event.size === undefined : event.kind === undefined && Number.isSafeInteger(event.size) && event.size >= 0 && event.size <= 100 * 1024 ** 3) && Number.isSafeInteger(event.completedAt) &&
  ['windows', 'local'].includes(event.source);

export function createStatisticsReporter({ storage, endpoint = STATISTICS_ENDPOINT, source = 'local', fetchImpl = fetch, retryMs = 60000 } = {}) {
  const filename = path.join(storage, 'statistics-outbox.json');
  let queue = [], closed = false, sessionToken = null, flushing = null, reading = null, cache = null, cachedAt = 0;
  const requests = new Set();
  const loaded = (async () => {
    try {
      const data = JSON.parse(await readFile(filename, 'utf8'));
      if (!Array.isArray(data) || data.length > 1000 || !data.every(validEvent)) throw new Error('Invalid statistics outbox');
      queue = data;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })();
  // Queue writes and acknowledgements share one transaction chain.
  let writes = loaded.catch(() => {});
  async function change(update) {
    const result = writes.then(async () => {
      await loaded;
      const next = update(queue);
      await mkdir(storage, { recursive: true });
      const temporary = filename + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
        await rename(temporary, filename);
        queue = next;
      } finally { await rm(temporary, { force: true }); }
    });
    writes = result.catch(() => {});
    return result;
  }
  async function post(body) {
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8000); timeout.unref?.();
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: controller.signal, body: JSON.stringify(body) });
      if (!response.ok) throw Object.assign(new Error('Statistics unavailable'), { status: response.status });
      return await response.json();
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function flush() {
    if (closed) return Promise.resolve();
    if (flushing) return flushing;
    flushing = (async () => {
      await loaded;
      while (!closed && queue.length) {
        const event = queue[0];
        if (event.completedAt < Math.floor(Date.now() / 1000) - retention) {
          await change(items => items.filter(item => item.id !== event.id || item.kind !== event.kind)); continue;
        }
        try {
          if (!sessionToken) {
            const session = await post({ action: 'local-session' });
            if (typeof session.token !== 'string' || !/^[a-f0-9.]+$/.test(session.token)) throw new Error('Invalid statistics session');
            sessionToken = session.token;
          }
          const { kind, ...payload } = event;
          await post({ action: kind === 'usage' ? 'record-local-usage' : 'record-local-transfer', token: sessionToken, ...payload });
        } catch (error) {
          if ([400, 409, 410].includes(error.status)) {
            await change(items => items.filter(item => item.id !== event.id || item.kind !== event.kind)); continue;
          }
          if (error.status === 403) sessionToken = null;
          break;
        }
        await change(items => items.filter(item => item.id !== event.id || item.kind !== event.kind));
        cachedAt = 0;
      }
    })().catch(() => { /* Preserve the outbox on storage/network errors. */ }).finally(() => { flushing = null; });
    return flushing;
  }
  const timer = setInterval(() => { void flush(); }, retryMs); timer.unref?.();
  void loaded.then(() => flush()).catch(() => {});
  async function recordEvent(event) {
      if (closed) return;
      if (!validEvent(event)) return;
      await change(items => {
        const current = items.filter(item => item.completedAt >= event.completedAt - retention);
        if (current.some(item => item.id === event.id && item.kind === event.kind)) return current;
        if (current.length >= 1000) throw new Error('Statistics outbox full');
        return [...current, event];
      });
      void flush();
  }
  return {
    record(id, size) { return recordEvent({ id, size, completedAt: Math.floor(Date.now() / 1000), source }); },
    recordUsage(id) { return recordEvent({ kind: 'usage', id, completedAt: Math.floor(Date.now() / 1000), source }); },
    async getStats() {
      if (closed) return null;
      if (cache && Date.now() - cachedAt < 60000) return cache;
      if (reading) return reading;
      reading = post({ action: 'stats' }).then(result => {
        if (!Number.isSafeInteger(result.files) || result.files < 0 || !Number.isSafeInteger(result.bytes) || result.bytes < 0 || !Number.isFinite(Date.parse(result.startedAt))) throw new Error('Invalid statistics');
        if (result.uses !== undefined && (!Number.isSafeInteger(result.uses) || result.uses < 0)) throw new Error('Invalid usage statistics');
        cache = { files: result.files, bytes: result.bytes, uses: result.uses ?? null, usesStartedAt: result.usesStartedAt ?? null, startedAt: result.startedAt, updatedAt: result.updatedAt };
        cachedAt = Date.now(); return cache;
      }).catch(() => null).finally(() => { reading = null; });
      return reading;
    },
    flush,
    async close() {
      closed = true; clearInterval(timer);
      for (const controller of requests) controller.abort();
      await flushing; await writes.catch(() => {});
    },
  };
}
