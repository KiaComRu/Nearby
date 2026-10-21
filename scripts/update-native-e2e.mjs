import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, copyFile, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const directory=await mkdtemp(path.join(tmpdir(),'nearby-native-update-'));
const stage=path.resolve('dist/windows-x64'), harness=path.join(stage,'UpdateNativeHarness.exe');
async function run(command,args,options={}) {
  const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});
  let output=''; child.stdout.on('data',data=>{output+=data;}); child.stderr.on('data',data=>{output+=data;});
  const timer=setTimeout(()=>child.kill(),60000);
  try { const [code]=await once(child,'exit');assert.equal(code,0,output);console.log(output.trim()); }
  finally {clearTimeout(timer);}
}
try {
  await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/update-native-build.ps1','-Output',harness]);
  await mkdir(path.join(directory,'core'));
  await run(harness,['core',path.join(directory,'core')]);
  await run(harness,['ui',directory],{env:{...process.env,NEARBY_DATA_DIR:path.join(directory,'data'),NEARBY_RECEIVE_DIR:path.join(directory,'received'),NEARBY_DISABLE_STATISTICS:'1',NEARBY_DISABLE_DISCOVERY:'1',NEARBY_DISABLE_TRUSTED_LAN:'1'}});
  await copyFile(path.join(directory,'native-update-notification.png'),'artifacts/native-update-notification.png');
  await writeFile('artifacts/native-update-verification.json',JSON.stringify({passed:true,checkedAt:new Date().toISOString(),realWinFormsWebView2:true,updateNotification:true,verifiedDownload:true,installerHandoff:true,engineShutdown:true,versionAndPlatformValidation:true,noDowngrade:true,tamperDetection:true,redirectRejection:true,cancellationAndCleanup:true},null,2));
} finally {
  for(const name of [harness,harness+'.config'])await rm(name,{force:true});
  assert.equal(path.dirname(directory),path.resolve(tmpdir()));
  await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
