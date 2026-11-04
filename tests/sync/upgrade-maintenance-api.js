'use strict';
// Actual Sync HTTP routes; no Docker socket or real GitLab is available here.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'upgrade-sync-')),state=path.join(root,'state');fs.mkdirSync(state);
fs.mkdirSync(path.join(root,'sync'));fs.mkdirSync(path.join(root,'system'));
const child=spawn(process.execPath,[process.env.SYNC_ENTRY||path.resolve(__dirname,'../../sync/dist/index.js')],{cwd:path.join(root,'sync'),env:{...process.env,SYSTEM_CONFIG_DIR:state,SYNC_USER:'fixture',SYNC_PASS:'fixture-password'},stdio:'ignore'});
const closed=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const request=(route,method='GET',token,body)=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:8071,path:route,method,headers:{'Content-Type':'application/json',...(body&&method!=='GET'?{'Content-Length':Buffer.byteLength(body)}:{}),...(token?{Authorization:'Bearer '+token}:{})}},res=>{let raw='';res.on('data',p=>raw+=p);res.on('end',()=>resolve({status:res.statusCode,body:raw}));});req.on('error',error=>reject(Object.assign(error,{route})));req.end(method==='GET'?undefined:body);});
(async()=>{try{let ready=false;for(let i=0;i<100;i++){try{await request('/status');ready=true;break;}catch{}await pause(100);}assert(ready);fs.mkdirSync(path.join(state,'.gitlab-upgrade-lock'));
  const auth=await request('/login','POST',undefined,JSON.stringify({username:'fixture',password:'fixture-password'}));assert.equal(auth.status,200);const token=JSON.parse(auth.body).accessToken;assert(token);
  assert.equal((await request('/status','GET',token)).status,200);assert.equal(typeof JSON.parse((await request('/status','GET',token)).body).projectOperationInProgress,'boolean');
  for(const [route,method] of [['/config/zip','POST'],['/command/restart','POST'],['/projects','POST'],['/projects/wizard/source','POST'],['/config/main','DELETE'],['/projects/wizard/environments/status','GET']])assert.equal((await request(route,method,token,'{}')).status,409,route+' must not mutate during migration');
  fs.rmdirSync(path.join(state,'.gitlab-upgrade-lock'));assert.notEqual((await request('/config/zip','POST',token,'{}')).status,409);
  // The mutex lives with working state, so an absent or changed Seed target
  // cannot bypass it. Authentication and configuration reads stay usable.
  fs.mkdirSync(path.join(state,'.storage-operation-lock'));
  assert.equal((await request('/login','POST',undefined,JSON.stringify({username:'fixture',password:'fixture-password'}))).status,200);
  assert.equal((await request('/status','GET',token)).status,200);
  assert.notEqual((await request('/config/main','GET',token)).status,409);
  for(const [route,method] of [['/config/zip','POST'],['/command/restart','PATCH'],['/command/harvest','PATCH'],['/command/seed','PATCH'],['/projects','POST'],['/projects/wizard/source','POST'],['/config/main','DELETE'],['/projects/wizard/environments/status','GET']])assert.equal((await request(route,method,token,'{}')).status,409,route+' must respect the live-state storage lease');
  fs.rmdirSync(path.join(state,'.storage-operation-lock'));assert.notEqual((await request('/config/zip','POST',token,'{}')).status,409);
  const calls=path.join(root,'system','calls');
  fs.writeFileSync(path.join(root,'system','stop-intermediate.sh'),'#!/bin/sh\necho stop >> calls\n');
  fs.writeFileSync(path.join(root,'system','seed.sh'),'#!/bin/sh\necho native-restore >> calls\nexit 1\n');
  assert.equal((await request('/command/seed','PATCH',token,'{}')).status,500);
  assert.equal(fs.readFileSync(calls,'utf8'),'native-restore\n','a refused Seed must not stop any service');
  assert.equal((await request('/status','GET',token)).status,200,'failed restore preserves Sync');
  fs.writeFileSync(path.join(root,'system','seed.sh'),'#!/bin/sh\necho native-restore >> calls\n');
  fs.unlinkSync(calls);
  const restored=await request('/command/seed','PATCH',token,'{}');
  assert.equal(restored.status,200);assert.equal(JSON.parse(restored.body).status.needRestart,true);
  assert.equal(fs.readFileSync(calls,'utf8'),'native-restore\n','the native lease owns the complete restore');
  const exit=await Promise.race([closed,pause(3000).then(()=>{throw Error('Sync did not restart after the completed response');})]);
  assert.equal(exit.code,0);assert.equal(exit.signal,null);
  console.log('PASS: Evolution and live-state storage leases block configuration and project mutations while authentication and reads remain available.');
}finally{child.kill();await closed;fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
