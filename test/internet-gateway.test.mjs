import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createInternetGateway} from '../internet-gateway.mjs';
import {createApp} from '../server.mjs';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('internet gateway fixes destination, isolates owner credentials and refuses redirects',async()=>{
  const seen=[];const server=http.createServer(async(req,res)=>{let body='';for await(const bytes of req)body+=bytes;seen.push({url:req.url,headers:req.headers,body:JSON.parse(body)});if(seen.at(-1).body.action==='close'){res.writeHead(302,{Location:'/unexpected'});res.end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const gateway=createInternetGateway(`http://127.0.0.1:${server.address().port}/api.php`);assert.deepEqual(await gateway({action:'relay-pull',room:'room'}),{ok:true});assert.equal(seen[0].url,'/api.php?transport=relay');assert.equal(seen[0].headers.authorization,undefined);await assert.rejects(gateway({action:'stats'}),{status:400});assert.equal(seen.length,1);await assert.rejects(gateway({action:'close'}),{status:502});assert.equal(seen.length,2);assert.throws(()=>createInternetGateway('http://example.com/api.php'));assert.throws(()=>createInternetGateway('https://user:password@example.com/api.php'));}finally{await new Promise(r=>server.close(r));}
});
test('internet receive requires owner, saves atomically, blocks updates and enforces declared size',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'nearby-internet-receive-'));const app=await createApp({host:'127.0.0.1',port:0,storage:directory,statistics:false,discovery:false,trustedLan:false});const origin=new URL(app.adminUrl).origin,headers={Authorization:`Bearer ${app.adminToken}`,'Content-Type':'application/json'};
  const request=(url,data,custom=headers)=>fetch(origin+url,{method:'POST',headers:custom,body:JSON.stringify(data)});
  try{
    assert.equal((await request('/api/internet/receives',{},{'Content-Type':'application/json'})).status,403);
    const reserve=await request('/api/internet/receives',{room:'a'.repeat(32),name:'safe.txt',size:4});assert.equal(reserve.status,201);const offer=await reserve.json();assert.equal(app.prepareUpdate(),false);
    const upload=await fetch(origin+`/api/internet/receives/${offer.id}/upload`,{method:'POST',headers:{Authorization:headers.Authorization},body:'test'});assert.equal(upload.status,201);assert.equal(await readFile(path.join(app.inbox,(await readdir(app.inbox))[0]),'utf8'),'test');assert.equal((await fetch(origin+`/api/internet/receives/${offer.id}/upload`,{method:'POST',headers:{Authorization:headers.Authorization},body:'test'})).status,409);
    const wrong=await(await request('/api/internet/receives',{room:'b'.repeat(32),name:'incomplete.bin',size:9})).json();assert.equal((await fetch(origin+`/api/internet/receives/${wrong.id}/upload`,{method:'POST',headers:{Authorization:headers.Authorization},body:'short'})).status,400);assert.equal((await readdir(app.inbox)).length,1);
    assert.equal(app.prepareUpdate(),true);app.cancelUpdate();
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
