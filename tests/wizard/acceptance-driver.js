'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {EventEmitter} = require('events');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(__dirname, 'live/build.js'), 'utf8');
let example = fs.readFileSync(path.join(root, 'system/.docker.env.example'), 'utf8');
if (example[807] !== '$') example = require('child_process').execFileSync('git', ['show', 'HEAD:system/.docker.env.example'], {cwd:root, encoding:'utf8'});
const projectData = example.slice(0,1184) + '\nPROD_HOST="wizard.example.test"\n';

async function scenario(options={}) {
  let clock=0; let access=0; let issued=0; let statuses=0; let refreshes=0;
  let getDenied=false; let mutations=0; let projectReads=0; const routes=[]; const writes=[]; const logs=[]; let error;
  const workflow={phase:'source-imported',importCommit:'a'.repeat(40)};
  const build=verified=>({phase:verified?'candidate-verified':'pipeline-running',
    pipeline:{id:123},artifact:{imageRef:'registry.example.test/wizard@sha256:'+'b'.repeat(64)}});
  const project={filename:'.wizard.env',repository:{id:7,systemProject:true},data:projectData};
  const response=(method,route,data,headers)=>{
    routes.push({method,route});
    if(route==='/login') {issued=clock;return {accessToken:'access-'+(++access),refreshToken:'refresh-secret'};}
    if(route==='/token') {
      assert.equal(data.token,'refresh-secret'); refreshes++; issued=clock;
      if(options.refreshDenied) return {status:403};
      return {accessToken:'access-'+(++access)};
    }
    if(headers.Authorization!=='Bearer access-'+access || clock-issued>=20*60*1000) return {status:401};
    if(options.get401 && route==='/status' && !getDenied) {getDenied=true;return {status:401};}
    if(route==='/status') return {defaultWizardSetupInProgress:false};
    if(route==='/config/main') return {data:projectData};
    if(route==='/config/projects') {
      projectReads++;
      return [options.changedProduction && projectReads>1?{...project,data:projectData.replace('wizard.example.test','changed.example.test')}:project];
    }
    if(route==='/projects/wizard/source' && method==='GET') return {repository:{id:7},workflow,sourceRevision:'c'.repeat(40)};
    if(route==='/projects/wizard/source') throw new Error('Resumed acceptance must not import source again');
    if(route==='/projects/wizard/build' && method==='GET') return {repository:{id:7},recipeHash:'recipe'};
    if(route==='/projects/wizard/build' && method==='POST') {
      mutations++;
      if(options.post401) return {status:401};
      const receipt=build(clock>=(options.duration || 0));
      if(options.changedPipeline && mutations>1) receipt.pipeline.id=456;
      return {state:'complete',build:receipt};
    }
    if(route==='/projects/wizard/build/status') {
      statuses++;
      if(options.checksFailed) return {state:'complete',build:{phase:'checks-failed'}};
      return {state:'complete',build:build(clock>=(options.duration || 0))};
    }
    throw new Error('Unexpected acceptance route '+method+' '+route);
  };
  const http={request:(input,callback)=>{
    const req=new EventEmitter(); req.setTimeout=()=>{}; req.destroy=reason=>req.emit('error',reason);
    req.end=body=>queueMicrotask(()=>{
      try {
        const result=response(input.method,input.path,body?JSON.parse(body):undefined,input.headers);
        const res=new EventEmitter(); res.statusCode=result.status || 200; callback(res);
        res.emit('data',JSON.stringify(result)); res.emit('end');
      } catch(failure) {req.emit('error',failure);}
    });
    return req;
  }};
  const fakeProcess={env:{SYSTEM_WIZARD_LIVE_ACCEPTANCE:'true',SYSTEM_WIZARD_EXPECTED_PROJECT:'7',SYNC_USER:'fixture-user',SYNC_PASS:'fixture-password'},exitCode:0};
  class Clock extends Date {static now(){return clock;}}
  vm.runInNewContext(source, {require:name=>name==='http'?http:name==='fs'?{writeFileSync:(filename,data)=>writes.push({filename,data})}:require(name),
    process:fakeProcess,Date:Clock,setTimeout:callback=>{clock+=2000;queueMicrotask(callback);},
    console:{log:value=>logs.push(value),error:value=>{error=value;}}}, {filename:'managed-acceptance-driver.js'});
  for(let tick=0; tick<100 && !logs.length && !error; tick++) await new Promise(resolve=>setImmediate(resolve));
  assert(logs.length || error,'Offline acceptance did not settle');
  assert(routes.every(({method,route})=>method==='GET' ||
    method==='POST' && ['/login','/token','/projects/wizard/source','/projects/wizard/build'].includes(route)),
    'Forbidden Production/configuration mutation');
  for(const write of writes) assert(!write.data.includes('refresh-secret') && !write.data.includes('fixture-password'));
  return {clock,refreshes,statuses,routes,writes,error,exitCode:fakeProcess.exitCode};
}
(async()=>{
  const long=await scenario({duration:42*60*1000});
  assert.equal(long.exitCode,0); assert.equal(long.writes.length,1); assert(long.refreshes>=2);
  assert(long.clock>15*60*1000,'Pipeline must outlive old fifteen-minute loop');
  assert.equal(long.routes.filter(x=>x.route==='/projects/wizard/source' && x.method==='POST').length,0);
  assert.equal(long.routes.filter(x=>x.route==='/projects/wizard/build' && x.method==='POST').length,2);
  const recovered=await scenario({get401:true}); assert.equal(recovered.exitCode,0); assert.equal(recovered.refreshes,1);
  assert.equal(recovered.routes.filter(x=>x.route==='/status').length,2);
  const mutation=await scenario({post401:true}); assert.equal(mutation.exitCode,1); assert.equal(mutation.writes.length,0);
  assert.equal(mutation.routes.filter(x=>x.route==='/projects/wizard/build' && x.method==='POST').length,1);
  assert.equal(mutation.refreshes,0,'Mutation must never trigger an authentication replay');
  const denied=await scenario({duration:25*60*1000,refreshDenied:true}); assert.equal(denied.exitCode,1); assert.equal(denied.writes.length,0);
  const failure=await scenario({duration:1000,checksFailed:true}); assert.equal(failure.exitCode,1); assert.equal(failure.writes.length,0);
  const identity=await scenario({changedPipeline:true}); assert.equal(identity.exitCode,1); assert.equal(identity.writes.length,0);
  const production=await scenario({changedProduction:true}); assert.equal(production.exitCode,1); assert.equal(production.writes.length,0);
  const timeout=await scenario({duration:70*60*1000}); assert.equal(timeout.exitCode,1); assert.equal(timeout.writes.length,0);
  assert(timeout.clock>=65*60*1000 && timeout.clock<66*60*1000);
  console.log('Managed acceptance refresh/deadline/resume contracts passed offline; no API, Docker or evidence-file writes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
