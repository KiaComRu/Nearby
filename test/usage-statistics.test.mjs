import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { createStatisticsReporter } from '../transfer-statistics.mjs';
import { createApp } from '../server.mjs';
const php = process.env.PHP_PATH || 'php', available = spawnSync(php, ['-v'], { windowsHide: true }).status === 0;
const until = async condition => { for (let i=0;i<120;i++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve,50)); } assert.fail('Statistics did not advance'); };
const call = async (app, route, body, key = app.adminToken) => { const response = await fetch(`http://127.0.0.1:${app.port}`+route, { method: body === undefined ? 'GET':'POST', headers: { Authorization:`Bearer ${key}`, ...(body === undefined ? {}:{'Content-Type':'application/json'}) }, body: body === undefined ? undefined:JSON.stringify(body) }); return { status:response.status, ...await response.json() }; };
function collector() {
  const uses = new Map(), files = new Map(); let offline = false;
  return { uses, files, setOffline(value) { offline=value; }, settings: { retryMs:3600000, fetchImpl:async (_url, options) => {
    if (offline) throw new Error('Offline'); const body=JSON.parse(options.body);
    if (body.action==='local-session') return Response.json({token:'abc.def'},{status:201});
    if (body.action==='record-local-usage') { uses.set(body.id,body); return Response.json({ok:true}); }
    if (body.action==='record-local-transfer') { files.set(body.id,body); return Response.json({ok:true}); }
    return Response.json({uses:uses.size, files:files.size,bytes:[...files.values()].reduce((n,x)=>n+x.size,0),startedAt:'2026-10-12T20:00:00Z',usesStartedAt:'2026-10-14T00:00:00Z',updatedAt:null});
  } } };
}

test('usage migration preserves old totals and concurrent duplicate usage reports count once', {skip:!available}, async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'nearby-usage-workers-'));
  const file=path.join(directory,'statistics.json'), original={files:7,bytes:12345,startedAt:'2026-10-12T20:00:00Z',updatedAt:null,rooms:{}};
  try {
    await writeFile(file,JSON.stringify(original));
    const worker = report => new Promise((resolve,reject)=>{
      const code="require getenv('SCRIPT'); function fail($status,$message){throw new RuntimeException($message);} transferStatistics(getenv('STATE'),json_decode(getenv('REPORT'),true));";
      const child=spawn(php,['-r',code],{windowsHide:true,env:{...process.env,SCRIPT:path.resolve('browser/statistics.php'),STATE:directory,REPORT:JSON.stringify(report)}});
      let errors=''; child.stderr.on('data',x=>{errors+=x;}); child.on('error',reject); child.on('exit',code=>code===0?resolve():reject(new Error(errors)));
    });
    await Promise.all(Array.from({length:12},(_,i)=>worker({kind:'usage',room:'room',id:String(i%6),expires:Math.floor(Date.now()/1000)+900})));
    const stored=JSON.parse(await readFile(file,'utf8'));
    assert.equal(stored.uses,6); assert.equal(stored.files,7); assert.equal(stored.bytes,12345); assert.equal(stored.startedAt,original.startedAt); assert.ok(Number.isFinite(Date.parse(stored.usesStartedAt)));
    await worker({room:'room',id:'0',size:55,expires:Math.floor(Date.now()/1000)+900});
    const final=JSON.parse(await readFile(file,'utf8')); assert.equal(final.uses,6); assert.equal(final.files,8); assert.equal(final.bytes,12400);
    await writeFile(file,JSON.stringify({...final,uses:'broken'})); const broken=await readFile(file,'utf8');
    await assert.rejects(worker(null)); assert.equal(await readFile(file,'utf8'),broken);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('web connections count after readiness, deduplicate both peers, count repeats and accept authenticated offline local reports', {skip:!available}, async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'nearby-usage-api-'));
  const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
  const child=spawn(php,['-S',`127.0.0.1:${port}`,'-t','browser'],{windowsHide:true,stdio:'ignore',env:{...process.env,NEARBY_WEB_STATE_DIR:directory}}), exited=once(child,'exit');
  const request=async(body,status=200)=>{const response=await fetch(`http://127.0.0.1:${port}/api.php`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;};
  try {
    await until(async()=>{try {await fetch(`http://127.0.0.1:${port}/`);return true;}catch{return false;}});
    assert.equal((await request({action:'stats'})).uses,0);
    for (let repetition=1;repetition<=2;repetition++) {
      const host=await request({action:'create',name:'Same PC'},201), auth={room:host.room,token:host.token};
      const guest=await request({action:'join',room:host.room,token:host.invite,name:'Same phone'}), guestAuth={room:host.room,token:guest.token};
      await request({action:'record-usage',...auth},403);
      await request({action:'approve',...auth}); assert.equal((await request({action:'stats'})).uses,repetition-1);
      await Promise.all(Array.from({length:8},(_,i)=>request({action:'record-usage',...(i%2?auth:guestAuth)})));
      const totals=await request({action:'stats'}); assert.equal(totals.uses,repetition); assert.equal(totals.files,0); assert.equal(totals.bytes,0);
      await request({action:'close',...auth}); await request({action:'record-usage',...guestAuth},410);
    }
    const {token}=await request({action:'local-session'},201), id=randomUUID();
    const event={action:'record-local-usage',id,completedAt:Math.floor(Date.now()/1000),source:'windows',token};
    await request({...event,token:'bad'},403); await request({...event,id:'bad'},400); await request({...event,source:'unknown'},400); await request({...event,completedAt:event.completedAt-8*86400},410);
    await request(event); const renewed=await request({action:'local-session'},201); await request({...event,token:renewed.token});
    const totals=await request({action:'record-local-transfer',id,size:0,completedAt:event.completedAt,source:'windows',token});
    assert.equal(totals.uses,3); assert.equal(totals.files,1); assert.equal(totals.bytes,0);
  } finally {child.kill();await exited;await rm(directory,{recursive:true,force:true});}
});

test('usage outbox survives offline restart and lost acknowledgement without mixing file and connection IDs',async()=>{
  const storage=await mkdtemp(path.join(tmpdir(),'nearby-usage-outbox-')), sink=collector(); let reporter, lost=true;
  const fetchImpl=sink.settings.fetchImpl;
  const settings={...sink.settings,storage,fetchImpl:async(url,options)=>{const body=JSON.parse(options.body),response=await fetchImpl(url,options);if(body.action==='record-local-usage'&&lost){lost=false;throw new Error('Acknowledgement lost');}return response;}};
  try {
    sink.setOffline(true); reporter=createStatisticsReporter(settings); const id=randomUUID();
    await reporter.recordUsage(id); await reporter.record(id,2); await reporter.flush();await reporter.close();
    assert.equal(JSON.parse(await readFile(path.join(storage,'statistics-outbox.json'),'utf8')).length,2);
    sink.setOffline(false); reporter=createStatisticsReporter(settings); await reporter.flush();await reporter.flush();
    assert.equal(sink.uses.size,1);assert.equal(sink.files.size,1);
    await reporter.recordUsage(randomUUID());await reporter.flush();const totals=await reporter.getStats();assert.equal(totals.uses,2);assert.equal(totals.files,1);assert.equal(totals.bytes,2);
    assert.deepEqual(JSON.parse(await readFile(path.join(storage,'statistics-outbox.json'),'utf8')),[]);
  } finally {await reporter?.close();await rm(storage,{recursive:true,force:true});}
});

test('native PIN and TLS reconnects count once on the receiving engine while heartbeats and saved trust do not', {timeout:30000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'nearby-usage-native-')), sink=collector();let first,second;
  const options=storage=>({host:'127.0.0.1',port:0,storage,statistics:sink.settings,discovery:false,trustedLan:{identityOptions:{protection:'file'}}});
  try {
    first=await createApp(options(path.join(directory,'a')));second=await createApp(options(path.join(directory,'b')));
    const address=`http://127.0.0.1:${second.port}`;
    await call(first,'/api/peer/diagnose',{address}); assert.equal(sink.uses.size,0);
    for (let i=1;i<=2;i++) {
      assert.equal((await call(first,'/api/peer/connect',{address,pin:second.pin,device:'Same PC'})).status,200);
      await Promise.all(Array.from({length:6},()=>call(first,'/api/peer/remote/api/state')));await until(()=>sink.uses.size===i);
      await call(first,'/api/peer/disconnect',{});
    }
    const pairing=await call(first,'/api/trust/pair',{address});assert.equal(pairing.status,200);
    const request=(await call(first,'/api/trust')).requests[0];await call(first,'/api/trust/confirm',{id:request.id});await call(second,'/api/trust/confirm',{id:request.id});
    await until(async()=>(await call(first,'/api/trust')).devices.length===1);assert.equal(sink.uses.size,2);
    const fingerprint=(await call(first,'/api/trust')).devices[0].fingerprint;
    for (let i=3;i<=4;i++) {
      assert.equal((await call(first,'/api/peer/connect',{address,fingerprint})).status,200);
      await Promise.all(Array.from({length:6},()=>call(first,'/api/peer/remote/api/state')));await until(()=>sink.uses.size===i);
      await call(first,'/api/peer/disconnect',{});
    }
    assert.equal(sink.files.size,0);
    for (const value of sink.uses.values()) assert.deepEqual(Object.keys(value).sort(),['action','completedAt','id','source','token']);
  } finally {await Promise.all([first?.close(),second?.close()]);await rm(directory,{recursive:true,force:true});}
});
