import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import http from 'node:http';

test('desktop update waits for accepted files, freezes new transfers and can safely resume', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nearby-update-gate-'));
  const app = await createApp({ host: '127.0.0.1', port: 0, storage: root, statistics: false, discovery: false, trustedLan: false });
  const origin = new URL(app.adminUrl).origin;
  const request = (route, token, data) => fetch(origin+route,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
  try {
    const joined = await (await request('/api/join','',{pin:app.pin,device:'Update test'})).json();
    const offer = await (await request('/api/offers',joined.token,{name:'kept.txt',size:4})).json();
    assert.equal(app.prepareUpdate(),false,'An already accepted file must finish before updating');
    const uploaded = await fetch(origin+`/api/offers/${offer.id}/upload`,{method:'POST',headers:{Authorization:`Bearer ${joined.token}`},body:'kept'});
    assert.equal(uploaded.status,201); await uploaded.arrayBuffer();
    const saved=(await readdir(app.inbox)).find(name=>name === 'kept.txt');
    assert.equal(await readFile(path.join(app.inbox,saved),'utf8'),'kept');
    assert.equal(app.prepareUpdate(),true);
    assert.equal((await request('/api/offers',joined.token,{name:'later.txt',size:1})).status,503);
    assert.equal((await request('/api/state',app.adminToken)).status,200,'The owner can still read the status');
    app.cancelUpdate();
    assert.equal((await request('/api/offers',joined.token,{name:'later.txt',size:1})).status,201);
    assert.equal(app.prepareUpdate(),false);
    assert.equal(await readFile(path.join(app.inbox,saved),'utf8'),'kept','User files survive freezing and resuming');
  } finally { await app.close(); await rm(root,{recursive:true,force:true}); }
});

test('desktop update also waits while another device is downloading a shared file', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'nearby-update-download-'));
  const app=await createApp({host:'127.0.0.1',port:0,storage:root,statistics:false,discovery:false,trustedLan:false});
  const origin=new URL(app.adminUrl).origin;
  let incoming;
  try {
    const bytes=Buffer.alloc(8*1024*1024,37);
    const share=await(await fetch(origin+`/api/shares?name=shared.bin&size=${bytes.length}`,{method:'POST',headers:{Authorization:`Bearer ${app.adminToken}`},body:bytes})).json();
    const guest=await(await fetch(origin+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:app.pin,device:'Download test'})})).json();
    const ticket=await(await fetch(origin+`/api/shares/${share.id}/ticket`,{method:'POST',headers:{Authorization:`Bearer ${guest.token}`}})).json();
    incoming=await new Promise((resolve,reject)=>{const request=http.get(origin+ticket.url,response=>{response.pause();resolve(response);});request.on('error',reject);});
    assert.equal(app.prepareUpdate(),false,'A download has no incoming offer, but still must block installation');
    let received=0;
    await new Promise((resolve,reject)=>{incoming.on('data',chunk=>{received+=chunk.length;});incoming.on('end',resolve);incoming.on('error',reject);incoming.resume();});
    assert.equal(received,bytes.length);
    let ready=false;
    for(let i=0;i<50;i++){if(app.prepareUpdate()){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(ready,true,'The completed response must release the update gate');
  }finally{incoming?.destroy();await app.close();await rm(root,{recursive:true,force:true});}
});
