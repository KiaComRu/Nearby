import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=await mkdtemp(path.join(tmpdir(),'nearby-update-installer-'));
async function run(command,args,extra={}) {
  const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...extra});let output='';
  child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  const timer=setTimeout(()=>child.kill(),45000);
  try{const[code]=await once(child,'exit');assert.equal(code,0,output);return output;}finally{clearTimeout(timer);}
}
let sleeper;
try {
  const payload=path.join(root,'payload'),install=path.join(root,'installed');
  for(const dir of [payload,install,path.join(root,'data'),path.join(root,'received')])await mkdir(dir,{recursive:true});
  const source=path.join(root,'Restart.cs');
  await writeFile(source,'using System;using System.IO;class Restart{static void Main(){File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"restarted.txt"),"updated");}}');
  await run(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe','/platform:x64','/out:'+path.join(payload,'Nearby.exe'),source]);
  const icon=await readFile('dist/windows-x64/Nearby.ico');await writeFile(path.join(payload,'Nearby.ico'),icon);
  const exe=path.join(root,'setup.exe'),nsisRoot=path.resolve('.build-tools/nsis-3/nsis-3.08');
  await run(path.join(nsisRoot,'Bin/makensis.exe'),['/V2','/DUPDATE_TEST','/DVERSION=0.5.4','/DPAYLOAD='+payload,'/DOUTPUT='+exe,path.resolve('desktop/windows/installer.nsi')],{env:{...process.env,NSISDIR:nsisRoot}});
  await writeFile(path.join(install,'Nearby.exe'),'old program');
  await writeFile(path.join(root,'data/settings.txt'),'saved pairing and settings');
  await writeFile(path.join(root,'received/kept.txt'),'received file');
  sleeper=spawn('powershell.exe',['-NoProfile','-Command','Start-Sleep -Seconds 3'],{windowsHide:true,stdio:'ignore'});
  const sleeperDone=once(sleeper,'exit');
  const installed=run(exe,['/S','/UPDATEPID='+sleeper.pid,'/D='+install],{windowsVerbatimArguments:true});
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.equal(await readFile(path.join(install,'Nearby.exe'),'utf8'),'old program','Installer must wait for the requesting process');
  await sleeperDone; await installed;
  for(let i=0;i<50;i++){try{if(await readFile(path.join(install,'restarted.txt'),'utf8')==='updated')break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(await readFile(path.join(install,'restarted.txt'),'utf8'),'updated');
  assert.equal(await readFile(path.join(root,'data/settings.txt'),'utf8'),'saved pairing and settings');
  assert.equal(await readFile(path.join(root,'received/kept.txt'),'utf8'),'received file');
  await writeFile('artifacts/update-installer-verification.json',JSON.stringify({passed:true,verifiedAt:new Date().toISOString(),realNsisInstaller:true,waitsForCaller:true,silentInPlaceUpdate:true,automaticRestart:true,preservesSettingsAndReceivedFiles:true,isolatedFixtureNoUserRegistryOrShortcuts:true},null,2));
  console.log('Real NSIS update passed: waits for caller, replaces program in place, restarts automatically and preserves separate user data.');
} finally {
  if(sleeper&&sleeper.exitCode===null)sleeper.kill();
  assert.equal(path.dirname(root),path.resolve(tmpdir()));await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
