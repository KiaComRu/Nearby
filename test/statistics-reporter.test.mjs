import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStatisticsReporter } from '../transfer-statistics.mjs';

test('statistics outbox survives offline restart and ambiguous acknowledgements without double counting', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'nearby-stat-queue-'));
  let reporter, offline = true, loseAcknowledgement = true, failToken = false;
  const received = new Map(), calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(options.redirect, 'error');
    if (offline) throw new Error('Offline');
    if (body.action === 'local-session') return Response.json({ token: 'abc.def' }, { status: 201 });
    if (body.action === 'stats') return Response.json({ files: received.size, bytes: [...received.values()].reduce((sum, size) => sum + size, 0), startedAt: '2026-10-12T20:00:00Z', updatedAt: null });
    if (failToken) { failToken = false; return Response.json({}, { status: 403 }); }
    received.set(body.id, body.size);
    if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('Response lost after accepting report'); }
    return Response.json({ ok: true });
  };
  const settings = { storage, source: 'windows', fetchImpl, retryMs: 3600000 };
  try {
    reporter = createStatisticsReporter(settings);
    assert.equal(await reporter.getStats(), null);
    await Promise.all([reporter.record('12345678-1234-1234-1234-123456789abc', 1024), reporter.record('12345678-1234-1234-1234-123456789abd', 0)]);
    await reporter.flush(); await reporter.close();
    const pending = JSON.parse(await readFile(path.join(storage, 'statistics-outbox.json'), 'utf8'));
    assert.equal(pending.length, 2);
    assert.deepEqual(Object.keys(pending[0]).sort(), ['completedAt', 'id', 'size', 'source']);
    offline = false;
    reporter = createStatisticsReporter(settings);
    await reporter.flush();
    assert.equal(received.size, 1);
    assert.equal(JSON.parse(await readFile(path.join(storage, 'statistics-outbox.json'), 'utf8')).length, 2);
    failToken = true;
    await reporter.flush(); await reporter.flush();
    assert.equal(received.size, 2);
    assert.deepEqual(JSON.parse(await readFile(path.join(storage, 'statistics-outbox.json'), 'utf8')), []);
    const stats = await reporter.getStats();
    assert.equal(stats.files, 2); assert.equal(stats.bytes, 1024);
    assert.deepEqual(await reporter.getStats(), stats);
    assert.equal(calls.filter(body => body.action === 'stats').length, 2, 'Successful reads are cached');
    assert.ok(calls.filter(body => body.action === 'local-session').length >= 2, 'Rejected credentials are renewed');
  } finally { await reporter?.close(); await rm(storage, { recursive: true, force: true }); }
});

test('corrupt statistics outbox is preserved and does not produce invented reports', async () => {
  const storage = await mkdtemp(path.join(tmpdir(), 'nearby-stat-corrupt-'));
  const filename = path.join(storage, 'statistics-outbox.json');
  await writeFile(filename, '{broken');
  const reporter = createStatisticsReporter({ storage, fetchImpl: () => { throw new Error('No request expected'); } });
  try {
    await assert.rejects(reporter.record('12345678-1234-1234-1234-123456789abc', 5));
    await reporter.flush();
    assert.equal(await readFile(filename, 'utf8'), '{broken');
  } finally { await reporter.close(); await rm(storage, { recursive: true, force: true }); }
});
