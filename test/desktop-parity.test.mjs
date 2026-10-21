import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
test('file-table metadata tracks delivery; only loopback owner can open managed files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nearby-file-table-')), opened = [];
  const app = await createApp({ host: '127.0.0.1', port: 0, storage: root, statistics: false, discovery: false, trustedLan: false, openTransferredFile: async file => opened.push(file) });
  const origin = `http://127.0.0.1:${app.port}`;
  const request = (url, { key = app.adminToken, method = 'GET', data, body } = {}) => fetch(origin + url, { method, headers: { Authorization: `Bearer ${key}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : body });
  try {
    const guest = await (await request('/api/join', { method: 'POST', data: { pin: app.pin, device: 'Recipient' }, key: '' })).json();
    await request('/api/state', { key: guest.token });
    const offer = await (await request('/api/offers', { key: guest.token, method: 'POST', data: { name: 'received.txt', size: 4 } })).json();
    assert.equal((await request('/api/files/open', { method: 'POST', data: { kind: 'offer', id: offer.id } })).status, 404);
    const complete = await request(`/api/offers/${offer.id}/upload`, { key: guest.token, method: 'POST', body: 'data' }); assert.equal(complete.status, 201);
    assert.equal((await request('/api/files/open', { method: 'POST', key: guest.token, data: { kind: 'offer', id: offer.id } })).status, 403);
    assert.equal((await request('/api/files/open', { method: 'POST', data: { kind: 'offer', id: '../outside', path: 'C:/Windows/not-owned.txt' } })).status, 404);
    assert.equal((await request('/api/files/open', { method: 'POST', data: { kind: 'offer', id: offer.id } })).status, 200);
    assert.equal(await readFile(opened[0], 'utf8'), 'data'); assert.ok(opened[0].startsWith(path.join(root, 'received') + path.sep));
    const targets = await (await request('/api/send-targets')).json();
    const createdAt = Date.now();
    const share = await (await request(`/api/shares?name=sent.txt&size=4&recipient=${targets.targets[0].id}`, { method: 'POST', body: 'copy' })).json();
    assert.ok(share.created >= createdAt); assert.equal(share.state, 'ready'); assert.ok(!('path' in share));
    const ticket = await (await request(`/api/shares/${share.id}/ticket`, { method: 'POST', key: guest.token, data: {} })).json();
    assert.equal(await (await fetch(origin + ticket.url + '&nearbyFile=' + share.id)).text(), 'copy');
    let state; for (let attempt = 0; attempt < 50; attempt++) { state = await (await request('/api/state')).json(); if (state.shares[0].state === 'completed') break; await new Promise(resolve => setTimeout(resolve, 10)); } assert.equal(state.shares[0].state, 'completed'); assert.ok(state.shares[0].completedAt >= share.created);
    assert.equal((await request('/api/files/open', { method: 'POST', data: { kind: 'share', id: share.id } })).status, 200); assert.equal(await readFile(opened[1], 'utf8'), 'copy');
  } finally { await app.close(); assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
});

test('image previews require the matching session, stay bounded and do not mark delivery', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nearby-preview-'));
  const app = await createApp({host:'127.0.0.1',port:0,storage:root,statistics:false,discovery:false,trustedLan:false});
  const origin=`http://127.0.0.1:${app.port}`;
  const request=(url,{key=app.adminToken,method='GET',data,body}={})=>fetch(origin+url,{method,headers:{Authorization:`Bearer ${key}`,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):body});
  try {
    const first=await(await request('/api/join',{key:'',method:'POST',data:{pin:app.pin,device:'First'}})).json();
    const second=await(await request('/api/join',{key:'',method:'POST',data:{pin:app.pin,device:'Second'}})).json();
    await request('/api/state',{key:first.token}); await request('/api/state',{key:second.token});
    const targets=await(await request('/api/send-targets')).json(); const recipient=targets.targets.find(target=>target.name==='First');
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64');
    const share=await(await request(`/api/shares?name=image.png&size=${png.length}&recipient=${recipient.id}`,{method:'POST',body:png})).json();
    const url=`/api/files/preview?kind=share&id=${share.id}`;
    assert.equal((await request(url,{key:''})).status,401); assert.equal((await request(url,{key:second.token})).status,404);
    const preview=await request(url,{key:first.token}); assert.equal(preview.status,200); assert.equal(preview.headers.get('content-type'),'image/png'); assert.equal(preview.headers.get('cache-control'),'no-store'); assert.deepEqual(Buffer.from(await preview.arrayBuffer()),png);
    assert.equal((await(await request('/api/state')).json()).shares[0].state,'ready');
    assert.equal((await request('/api/files/preview?kind=share&id=../../outside')).status,404);
    const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const active=await(await request(`/api/shares?name=active.svg&size=${svg.length}`,{method:'POST',body:svg})).json();
    assert.equal((await request(`/api/files/preview?kind=share&id=${active.id}`)).status,415);
    const large=Buffer.alloc(8*1024*1024+1); const oversized=await(await request(`/api/shares?name=huge.png&size=${large.length}`,{method:'POST',body:large})).json();
    assert.equal((await request(`/api/files/preview?kind=share&id=${oversized.id}`)).status,415);
    const offer=await(await request('/api/offers',{key:first.token,method:'POST',data:{name:'incoming.webp',size:png.length}})).json();
    assert.equal((await request(`/api/files/preview?kind=offer&id=${offer.id}`)).status,404);
    assert.equal((await request(`/api/offers/${offer.id}/upload`,{key:first.token,method:'POST',body:png})).status,201);
    assert.equal((await request(`/api/files/preview?kind=offer&id=${offer.id}`,{key:second.token})).status,404);
    assert.deepEqual(Buffer.from(await(await request(`/api/files/preview?kind=offer&id=${offer.id}`)).arrayBuffer()),png);
  } finally {await app.close();assert.equal(path.dirname(root),path.resolve(tmpdir()));await rm(root,{recursive:true,force:true});}
});
