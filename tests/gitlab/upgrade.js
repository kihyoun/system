'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Upgrade,release,QUIESCE_SCRIPT,SCHEDULING_QUIESCE_SCRIPT,options,imageAssignment,inventory,hash,atomic,run}=require('../../gitlab/upgrade');
const example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
const base={sourceRevision:'a'.repeat(40),evidence:'/state/evidence.json',stateDir:'/state',persistentDir:'/operator/platform',checkpointDir:'/state/gitlab-upgrades/test',readyTimeoutSeconds:600};
const ids={old:'sha256:'+'b'.repeat(64),next:'sha256:'+'c'.repeat(64)};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gitlab-upgrade-contract-'));
(async()=>{try{
  assert.equal(release.toVersion,'19.4.3');assert.equal(release.fromVersion,'19.4.2');
  assert.equal(options(base),base);for(const patch of [{stateDir:'/tmp'},{checkpointDir:'/state/../private'},{sourceRevision:'main'},{readyTimeoutSeconds:30},{allowFailure:true}])assert.throws(()=>options({...base,...patch}));
  const updated=imageAssignment(example,release.toImage);assert.equal(updated.slice(0,1184),example.slice(0,1184));assert(updated.includes(release.toImage));assert.equal(imageAssignment(updated,release.toImage),updated);
  assert.throws(()=>imageAssignment(example+'\nGITLAB_IMAGE=one\nGITLAB_IMAGE=two\n',release.toImage),/duplicate/);assert.throws(()=>imageAssignment('badcube',release.toImage),/cube/);assert.throws(()=>imageAssignment(example,'gitlab/gitlab-ee:latest'),/approved/);
  assert.equal(run(process.execPath,['-p','process.cwd()'],{cwd:root}),root,'All lifecycle subprocesses must use the intended component working directory.');
  for(const name of ['gitlab','configuration'])fs.mkdirSync(path.join(root,name));fs.writeFileSync(path.join(root,'gitlab/value'),'original');const expected=inventory(root);fs.writeFileSync(path.join(root,'gitlab/value'),'changed');assert.notDeepEqual(inventory(root),expected);fs.writeFileSync(path.join(root,'gitlab/value'),'original');fs.symlinkSync('value',path.join(root,'gitlab/link'));assert(inventory(root).some(e=>e.type==='link'&&e.target==='value'));
  atomic(path.join(root,'private.json'),'data');assert.equal(fs.statSync(path.join(root,'private.json')).mode&0o777,0o600);assert.equal(hash('data').length,64);
  const calls=[];let state={Running:false,ExitCode:0,OOMKilled:false};const engine=new Upgrade(base,{run(binary,args,opts){calls.push({binary,args,opts});if(args[0]==='inspect')return JSON.stringify([{State:state}]);return '';}});
  engine.stop();assert(calls.find(c=>c.args.some(value=>value.includes('gitlab-ctl'))).args.some(value=>value.includes('gitlab-ctl stop')));assert(calls.find(c=>c.args[0]==='stop').args.includes('60'));
  for(const call of calls){const index=call.args.indexOf('-ec');if(index>=0){const syntax=require('child_process').spawnSync('sh',['-n','-c',call.args[index+1]],{encoding:'utf8'});assert.equal(syntax.status,0,'Every generated remote lifecycle script must parse as actual POSIX shell.');}}
  const stopping=calls.findIndex(c=>c.args[0]==='stop'),quiesce=calls.findIndex(c=>c.args.some(value=>value.includes('gitlab-ctl')));assert(quiesce<stopping);
  state={Running:false,ExitCode:137,OOMKilled:false};assert.throws(()=>engine.stop(),/clean-stop/);
  const images=new Upgrade(base,{run:()=>JSON.stringify([{Id:ids.next,RepoDigests:[release.toImage]}])});assert.equal(images.image(release.toImage),ids.next);
  const wrong=new Upgrade(base,{run:()=>JSON.stringify([{Id:ids.next,RepoDigests:[]}])});assert.throws(()=>wrong.image(release.toImage),/pin-mismatch/);
  const candidate=new Upgrade(base,{run:()=>JSON.stringify([{Id:ids.next}]),imageIds:{[release.toImage]:ids.next}});assert.equal(candidate.image(release.toImage),ids.next,'Only the isolated adapter supplies archive-verified image IDs.');
  const planEngine=new Upgrade(base);let entered=false,unlocked=false;
  planEngine.lock=()=>{};planEngine.unlock=()=>{unlocked=true;};planEngine.syncIdle=()=>{};planEngine.plan=async()=>({planSha256:'d'.repeat(64)});planEngine.migrate=async()=>{entered=true;};
  await assert.rejects(()=>planEngine.promote('e'.repeat(64)),/reviewed-plan/);assert(!entered);assert(unlocked);
  const timerDirectory=path.join(root,'bin');fs.mkdirSync(timerDirectory);const reached=path.join(root,'timeout-invoked');
  fs.writeFileSync(path.join(timerDirectory,'timeout'),'#!/bin/sh\ntouch '+reached+'\n',{mode:0o755});
  for(const remaining of [0,-1,111]){
    for(const source of [QUIESCE_SCRIPT,SCHEDULING_QUIESCE_SCRIPT]){
    const script=source.replaceAll('read -r uptime rest </proc/uptime','uptime=100');
    const result=require('child_process').spawnSync('sh',['-ec',script,'sh',String(100+remaining)],{env:{...process.env,PATH:timerDirectory+path.delimiter+process.env.PATH},encoding:'utf8'});
    assert.equal(result.status,124,'An expired/out-of-budget remote quiesce must not invoke timeout, including timeout0.');assert(!fs.existsSync(reached));
    }
  }
  console.log('PASS: approved CE pins, exact Cube/config edits, component cwd, private/checksummed checkpoints, clean-stop requirement and review-plan gate.');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
