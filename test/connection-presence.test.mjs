import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

test('owner sees only active authenticated devices; heartbeats expire and leave ends a PIN session', async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nearby-presence-'));
  let app;
  try {
    app = await createApp({ host: '127.0.0.1', port: 0, storage: directory, statistics: false });
    const request = (route, key = app.adminToken, data) => fetch(`http://127.0.0.1:${app.port}${route}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${key}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const ownerState = async () => (await request('/api/state')).json();
    assert.deepEqual((await ownerState()).connectedDevices, []);
    assert.equal((await request('/api/state', '')).status, 401);
    const { token } = await (await request('/api/join', '', { pin: app.pin, device: 'Телефон' })).json();
    assert.deepEqual((await ownerState()).connectedDevices, [], 'A token without a live client is not presence');
    context.mock.timers.enable({ apis: ['Date'] });
    const guestState = await (await request('/api/state', token)).json();
    assert.equal(guestState.connectedDevices, undefined, 'Peer identities are owner-only');
    assert.deepEqual((await ownerState()).connectedDevices, [{ name: 'Телефон', secure: false }]);
    context.mock.timers.tick(40_000);
    await request('/api/state', token);
    context.mock.timers.tick(10_000);
    assert.equal((await ownerState()).connectedDevices.length, 1, 'Heartbeat extends presence');
    context.mock.timers.tick(36_000);
    assert.deepEqual((await ownerState()).connectedDevices, [], 'Stale session does not keep controls visible');
    await request('/api/state', token);
    assert.equal((await ownerState()).connectedDevices.length, 1, 'Returning client becomes active again');
    assert.equal((await request('/api/leave', app.adminToken, {})).status, 403);
    assert.equal((await request('/api/leave', token, {})).status, 200);
    assert.deepEqual((await ownerState()).connectedDevices, []);
    assert.equal((await request('/api/state', token)).status, 401, 'Explicit leave invalidates the session');
  } finally {
    context.mock.timers.reset();
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
