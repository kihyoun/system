'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const application = require('../e2e/application-routing');
function fixture(change = value => value) {
  const requests = [], controls = [], candidate = {spec: {}, wait: async action => assert(await action())};
  const probe = async (_, host, route) => {
    requests.push({host, route});
    return change(route.includes('acme-challenge') ? {status: 200, body: 'application-http01-proof', headers: {}} :
      {status: 308, headers: {location: 'https://' + application.APP_HOST + route}, serial: 'current'});
  };
  const dependencies = {tlsProbe: probe, httpProbe: probe, controller: async (_, action, input) => controls.push({action: String(action), input}),
    session: async () => ({request: async route => {assert.equal(route, '/config/projects');return [{filename: '.' + application.PROJECT + '.env',
      data: ' '.repeat(807) + '$\nPROD_ALIASES="' + application.APP_ALIAS + '"', repository: {id: 42}}];}})};
  return {candidate, dependencies, requests, controls};
}
test('candidate application verification covers both protocols, exact encoded query, direct challenge, serial and authenticated ownership Fetch', async () => {
  const f = fixture();await application.verify(f.candidate, {serial: 'current'}, f.dependencies);
  assert.equal(f.requests.length, 4);
  assert(f.requests.every(request => request.host === application.APP_ALIAS));
  assert(f.requests.some(request => request.route.includes('?one=1&two=a%2Fb&one=2')));
  assert.equal(f.controls.length, 2);assert.match(f.controls.at(-1).action, /rmSync/);
  assert.equal(f.candidate.applicationAliasesVerified, true);
});
test('changed canonical redirect, missing query, stale certificate and redirecting HTTP01 fail acceptance', async () => {
  for (const change of [value => value.status === 308 ? {...value, headers: {location: 'https://other.example.test/'}} : value,
    value => value.status === 308 ? {...value, headers: {location: value.headers.location.split('?')[0]}} : value,
    value => ({...value, serial: 'stale'}), value => value.status === 200 ? {...value, headers: {location: '/'}} : value]) {
    const f = fixture(change);
    await assert.rejects(() => application.verify(f.candidate, {serial: 'current'}, f.dependencies), /application-alias-(redirect|http01)-failed/);
    assert.notEqual(f.candidate.applicationAliasesVerified, true);assert.equal(f.controls.length, 2);
  }
});
test('selective candidate Push must retain every previous container ID, image, start time and restart count', () => {
  const before = {'/system_gitlab_1': {id: 'gitlab', image: 'gitlab-image', started: 'earlier', restarts: 0},
    '/application-routing-prod': {id: 'production', image: 'application-image', started: 'earlier', restarts: 0}};
  application.assertPreserved(before, {...before, '/routingproof_review_1': {id: 'new-review-proxy'}});
  for (const key of ['id', 'image', 'started', 'restarts'])
    assert.throws(() => application.assertPreserved(before, {...before, '/system_gitlab_1': {...before['/system_gitlab_1'], [key]: 'changed'}}), /existing-container-changed/);
});
test('native namespace and create requests wait for completed jobs through the authenticated API before using their merged results', async () => {
  const namespaceJob='a'.repeat(64),projectJob='b'.repeat(48),requests=[];
  let clock=0,namespacePolls=0,projectPolls=0;
  const candidate={url:'https://sync.candidate.test',secrets:{user:'fixture',password:'private-fixture-password'},
    now:()=>clock,deadline:300000,sleep:async milliseconds=>{clock+=milliseconds;}};
  candidate.wait=(check,budget)=>require('./disposable-candidate').Candidate.prototype.wait.call(candidate,check,budget);
  const tlsProbe=async (_candidate,host,path,options)=>{
    assert.equal(host,'sync.candidate.test');requests.push({path,options});
    if(path==='/login')return {status:200,body:JSON.stringify({accessToken:'private-fixture-token'})};
    assert.equal(options.headers.Authorization,'Bearer private-fixture-token');
    const data=path==='/projects/namespaces'?{id:namespaceJob,state:'running'}:
      path==='/projects/jobs/'+namespaceJob?{id:namespaceJob,state:++namespacePolls===1?'running':'complete',namespaces:[{id:9,path:'root'}]}:
      path==='/projects'?{id:projectJob,state:'running'}:
      path==='/projects/jobs/'+projectJob?(projectPolls++,{id:projectJob,state:'complete',repository:{id:42,namespaceId:9,path:'root/routingproof'}}):[];
    return {status:202,body:JSON.stringify(data)};
  };
  const sync=await application.session(candidate,{}, {tlsProbe});
  const namespaces=await sync.request('/projects/namespaces');
  assert.deepEqual(namespaces.namespaces,[{id:9,path:'root'}]);assert.equal(namespacePolls,2);
  const payload={projectKey:'routingproof',namespaceId:namespaces.namespaces[0].id,template:'empty',data:'signed project configuration',ci:'# CI_DEFAULT_BRANCH'};
  const project=await sync.request('/projects',payload);
  assert.equal(project.repository.id,42);assert.equal(projectPolls,1);
  assert.equal(requests.filter(row=>row.path==='/projects').length,1,'polling must never replay native project creation');
  assert.equal(requests.find(row=>row.path==='/projects').options.body,JSON.stringify(payload));
  assert.deepEqual(await sync.request('/config/projects'),[],'ordinary authenticated Fetch stays synchronous');
});
test('failed and malformed native jobs stop immediately with bounded source-owned diagnostics', async () => {
  const job='a'.repeat(64),marker='private-native-job-error-and-token';
  for(const [route,result,code] of [
    ['/projects/namespaces',{id:job,state:'failed',message:marker},'application-routing-namespace-job-failed'],
    ['/projects',{id:job,state:'failed',message:marker},'application-routing-project-failed'],
    ['/projects/namespaces',{id:'../../private',state:'running'},'application-routing-job-identity-invalid'],
    ['/projects/namespaces',{id:job,state:'unknown-private-state'},'application-routing-job-state-invalid'],
    ['/projects/namespaces',{id:'b'.repeat(64),state:'complete'},'application-routing-job-identity-invalid']]){
    let polls=0,sleeps=0;
    const candidate={url:'https://sync.candidate.test',secrets:{user:'fixture',password:marker},now:()=>0,deadline:300000,
      sleep:async()=>{sleeps++;assert.fail('terminal native failure was retried');}};
    candidate.wait=(check,budget)=>require('./disposable-candidate').Candidate.prototype.wait.call(candidate,check,budget);
    const tlsProbe=async (_candidate,_host,path)=>({status:200,body:JSON.stringify(path==='/login'?{accessToken:marker}:
      path===route?{id:job,state:'running'}:(polls++,result))});
    const sync=await application.session(candidate,{}, {tlsProbe});
    await assert.rejects(()=>sync.request(route,route==='/projects'?{}:undefined),error=>
      error.message===code&&error.noRetry===true&&!error.message.includes(marker));
    assert.equal(polls,1);assert.equal(sleeps,0);
    assert.equal(require('./stage-diagnostics').failureReason(code),code);
  }
});
test('the actual controller upload counts only readiness probes completed during Push and cleans up failed probes', async () => {
  const vm=require('node:vm'),{EventEmitter}=require('node:events');
  function transport(){
    const events=[],probes=[];let request,response,started,exit;
    const began=new Promise(resolve=>{started=resolve;});
    const candidate={inner:async(args,options)=>{
      assert.equal(args[0],'exec');assert(!args.join(' ').includes('private-fixture-token'));
      return new Promise((resolve,reject)=>{
        const stdin=new EventEmitter(),runtime={stdin,stdout:{write:resolve}};
        Object.defineProperty(runtime,'exitCode',{set:value=>{exit=value;if(value)reject(Error('controller-program-failed'));}});
        const http={request:(_options,callback)=>{
          request=new EventEmitter();response=new EventEmitter();response.statusCode=200;
          request.end=()=>{events.push('push-started');callback(response);started();};
          request.destroy=error=>{if(error){events.push('push-aborted');request.emit('error',error);}};
          return request;
        }};
        const childProcess={execFile:(command,args,limits,callback)=>{
          assert.equal(command,'docker');assert.deepEqual(Array.from(args),['exec','system_gitlab_1','curl','-fsS','--max-time','3',
            '--output','/dev/null','http://127.0.0.1/-/readiness']);
          assert.equal(limits.timeout,5000);assert.equal(limits.killSignal,'SIGKILL');assert.equal(limits.maxBuffer,4096);
          events.push('probe-started');
          const child={kill:signal=>{assert.equal(signal,'SIGKILL');events.push('probe-killed');queueMicrotask(()=>callback(Error('private-child-output')));}};
          probes.push({complete:error=>{events.push(error?'probe-failed':'probe-completed');callback(error);},child});
          return child;
        }};
        vm.runInNewContext(args.at(-1),{process:runtime,Buffer,setTimeout,require:name=>
          name==='fs'?{readFileSync:()=>Buffer.from('owned-configuration-zip')}:name==='http'?http:name==='child_process'?childProcess:require(name)});
        stdin.emit('data',options.input);stdin.emit('end');
      });
    }};
    return {candidate,events,probes,began,get exit(){return exit;},
      finish:()=>{events.push('push-completed');response.emit('data',JSON.stringify({applyMode:'routing',status:{needRestart:false}}));response.emit('end');},
      fail:()=>request.emit('error',Error('private-request-output'))};
  }
  for(const mode of ['during','after','probe-failure','request-failure','impact']){
    const f=transport(),pending=application.upload(f.candidate,'private-fixture-token',mode==='impact'?'/config/impact':'/config/zip','/tmp/owned.zip','reviewed-fingerprint');
    await f.began;
    if(mode==='impact'){
      assert.equal(f.probes.length,0);f.finish();assert.equal((await pending).readinessChecks,0);continue;
    }
    assert.equal(f.probes.length,1);
    if(mode==='during'){
      f.probes[0].complete();await Promise.resolve();f.finish();
      const applied=await pending;assert.equal(applied.status,200);assert.equal(applied.readinessChecks,1);
      assert(f.events.indexOf('probe-completed')<f.events.indexOf('push-completed'));
    }else if(mode==='after'){
      f.finish();await Promise.resolve();f.probes[0].complete();
      await assert.rejects(pending,/^Error: application-routing-no-concurrent-readiness-check$/);
    }else if(mode==='probe-failure'){
      f.probes[0].complete(Error('private-readiness-failure-output'));
      await assert.rejects(pending,/^Error: application-routing-gitlab-readiness-failed$/);
      assert(f.events.includes('push-aborted'));
    }else{
      f.fail();await assert.rejects(pending,/^Error: controller-program-failed$/);assert(f.events.includes('probe-killed'));assert.equal(f.exit,1);
    }
    assert.equal(f.probes.length,1,'no probes run after request completion');
  }
  for(const code of ['application-routing-no-concurrent-readiness-check','application-routing-gitlab-readiness-failed'])
    assert.equal(require('./stage-diagnostics').failureReason(code),code);
});
