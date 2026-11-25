'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {test}=require('node:test');
const storage=require('../e2e/local-storage');
const {Candidate,LABEL}=require('./disposable-candidate');

test('backup media has an independent journaled owner and shares cancellation/deadline',async()=>{
  const calls=[],parent={spec:{fullAcceptance:true,recoveryAcceptance:true},deadline:123,checkpoint:owner=>calls.push(['checkpoint',owner.id]),canceled:false};
  class Owner {
    constructor(spec,options){this.spec=spec;this.id='b'.repeat(24);this.name='system-candidate-'+this.id;this.checkpoint=options.checkpoint;}

    async create(kind,args){calls.push([kind,args]);return this.name;}
  }
  const mounts=await storage.prepareOwner(parent,{Owner});
  assert.equal(parent.backupOwner.spec.fullAcceptance,false);
  assert.equal(parent.backupOwner.spec.recoveryAcceptance,false);
  assert.equal(parent.backupOwner.deadline,parent.deadline);
  assert.equal(calls[0][0],'checkpoint','the independent receipt exists before backup volume creation');
  assert.deepEqual(mounts,['--mount','type=volume,source='+parent.backupOwner.name+',target=/seed-device']);
  assert(calls[1][1].includes(LABEL+'='+parent.backupOwner.id));
  parent.canceled=true;assert.equal(parent.backupOwner.canceled,true);
});

test('local preparation invokes committed host-root guard without backup medium or Docker socket',async()=>{
  const calls=[],candidate={inner:async args=>calls.push(args)};
  await storage.prepareLocal(candidate,'/candidate-data/platform');
  const command=calls[0];
  assert(command.includes('type=bind,src=/,dst=/host'));
  assert(command.includes('PERSISTENCE_MODE=local'));
  assert.equal(command.at(-1),'prepare-local');
  assert(!command.some(value=>value.includes('docker.sock')||value.includes('dst=/seed')||value.startsWith('SEED_')));
  await assert.rejects(()=>storage.prepareLocal(candidate,'/production'),/owned-root/);
  assert.equal(calls.length,1);
});

test('missing backup refusal must preserve the running service and never treats transport failure as success',async()=>{
  const calls=[],candidate={daemon:'owned',call:async args=>{calls.push(args);return 'absent';},inner:async args=>{
    if(args[0]==='inspect')return 'a'.repeat(64)+' true 0';
    throw Error('seed-target-unavailable');
  }};
  await storage.refuseMissingTarget(candidate);
  assert.equal(candidate.missingBackupGuardVerified,true);
  candidate.inner=async args=>{if(args[0]==='inspect')return 'a'.repeat(64)+' true 0';throw Error('docker-exec-failed');};
  await assert.rejects(()=>storage.refuseMissingTarget(candidate),/docker-exec-failed/);
});

test('local data proof rejects permanent Seed bindings and checks the real storage marker',async()=>{
  const candidate={daemon:'owned',call:async args=>args.includes('cat')?'system-bootstrapper-persistence-v1':'local',
    inner:async()=>JSON.stringify([{Mounts:[]},{Mounts:[]}])};
  await storage.verifyLocalLive(candidate,'/candidate-data/platform');
  assert.equal(candidate.localLiveVerified,true);
  candidate.inner=async()=>JSON.stringify([{Mounts:[{Destination:'/seed',Source:storage.SEED}]},{Mounts:[]}]);
  await assert.rejects(()=>storage.verifyLocalLive(candidate,'/candidate-data/platform'),/permanent-backup-binding/);
  candidate.call=async()=> 'wrong-marker';
  await assert.rejects(()=>storage.verifyLocalLive(candidate,'/candidate-data/platform'),/live-not-on-root/);
});

test('backup target detaches before absence verification and cleanup will not remove media while a daemon survives',async()=>{
  const calls=[],candidate={daemon:'owned',call:async args=>{calls.push(args);return calls.length===1?'':'absent';}};
  await storage.detach(candidate);
  assert(calls[0].at(-1).includes('umount /external-seed; umount /seed-device'));
  assert(calls[1].at(-1).includes('test ! -e /external-seed/seed'));
  let removed=false;
  const owner=Object.create(Candidate.prototype);
  Object.assign(owner,{id:'a'.repeat(24),name:'system-candidate-'+'a'.repeat(24),resources:[{kind:'container',id:'b'.repeat(64),name:'system-candidate-'+'a'.repeat(24)}],results:[],
    exec:args=>{if(args[1]==='ls')return JSON.stringify({ID:'b'.repeat(12)});throw Error('daemon unavailable');},
    backupOwner:{cleanup(){removed=true;return true;},checkpoint(){}}});
  assert.equal(owner.cleanup(),false);
  assert.equal(removed,false);
});

test('public upgrade reuses the owned device while its configured backup target is detached',async()=>{
  const calls=[],candidate={daemon:'owned',call:async args=>{calls.push(args);return calls.length===1?'':'absent';}};
  await storage.detach(candidate,{retainDevice:true});
  assert.equal(calls[0].at(-1),'umount /external-seed; rmdir /external-seed');
  assert(calls[1].at(-1).includes('test ! -e /external-seed/seed'));
});

test('a failed payload refusal cannot publish acceptance or leave the corruption injected by its fixture',async()=>{
  const calls=[],candidate={daemon:'owned',stage:async(_name,action)=>action(),call:async args=>{calls.push(args);return args.includes('readlink')?'snapshots/completed':'';},inner:async args=>{
    assert.deepEqual(args.slice(-3),['/system/dist/modules/storage/entry.js','launch','restore']);
    if(calls.some(call=>call.at(-1).includes('printf corrupt')))throw Error('docker-exec-failed');
    throw Error('restore-target-not-empty');
  }};
  await assert.rejects(()=>storage.refuseInvalidRestore(candidate,'/recovered-data/platform'),/docker-exec-failed/);
  assert(calls.at(-1).at(-1).includes('printf storage-seed-fixture'),'repair only the fixture marker even after a refusal fails');
});

test('restored receipts retain only the bounded native storage proof fields',()=>{
  const {recover}=require('./disposable-candidate');
  const expected={localLiveVerified:true,externalSeedRestored:true,backupDetached:true,missingBackupGuardVerified:true,globalLeaseVerified:true,invalidRestoreGuardVerified:false};
  const receipt={runId:'a'.repeat(24),resources:[],results:[],evidence:{storage:{...expected,private:'never publish this value'}}};
  assert.deepEqual(recover(receipt).evidence.storage,expected);
});

test('fresh restore checks the same live lease even before a GitLab container exists',async()=>{
  const calls=[],candidate={inner:async args=>{
    calls.push(args);
    if(args[0]==='ps')return '';
    if(args.includes('/system/dist/modules/storage/entry.js')){
      assert.deepEqual(args.slice(-3),['/system/dist/modules/storage/entry.js','launch','restore']);
      throw Error('storage-operation-busy');
    }
    return '';
  }};
  await storage.refuseLockedLive(candidate,'restore');
  assert.equal(candidate.globalLeaseVerified,true);
  assert.equal(calls.filter(args=>args[0]==='ps').length,2);
  assert.equal(calls.filter(args=>args.includes('mkdir')).length,1);
  assert.equal(calls.filter(args=>args.includes('rmdir')).length,1);
});

function restartedControlFixture(responses={},readinessMilliseconds=5000,deadline=20000,control={}) {
  let time=0,restarted=false;
  const requests=[],results=[],commands=[],scripts=[],config=fs.readFileSync(path.join(__dirname,'../../config/system/.docker.env.example'),'utf8');
  let pushed=false;
  const candidate={daemon:'owned',spec:{readinessMilliseconds},secrets:{user:'fixture-user',password:'private-fixture-password'},
    now:()=>time,deadline,sleep:async milliseconds=>{time+=milliseconds;},checkpoint:()=>{},results,
    stage:Candidate.prototype.stage,wait:Candidate.prototype.wait,call:async()=>'absent',
    inner:async(args,options)=>{
      commands.push(args);
      if(args[0]==='inspect')return args.includes('{{json .NetworkSettings.Networks}}')?JSON.stringify({bridge:{Gateway:'172.17.0.1'}}):
        JSON.stringify({id:restarted&&control.replaced?'other-controller':'owned-controller',image:'controller-image',
          started:restarted&&!control.noRestart||pushed&&control.pushRestart?'later':'earlier',running:true});
      if(args[0]==='restart'){restarted=true;return 'system_bootstrapper_1';}
      const input=JSON.parse(options.input);
      if(Object.hasOwn(input,'user')){
        assert.equal(input.user,candidate.secrets.user);assert.equal(input.password,candidate.secrets.password);
        scripts.push({source:args.at(-1),input:options.input});
        pushed=true;return 'accepted';
      }
      requests.push({host:input.host,route:input.route});
      assert.equal(input.certificate,'/ssl/live/recovery-fixture/fullchain.pem');
      if(input.route==='/')return JSON.stringify({status:200,body:'<html>Wizard ready</html>'});
      if(input.route==='/login')assert.deepEqual(JSON.parse(input.options.body),{username:candidate.secrets.user,password:candidate.secrets.password});
      else assert.equal(input.options.headers.Authorization,'Bearer private-fixture-token');
      const pending=responses[input.route],reply=typeof pending==='function'?pending():pending?.shift();
      if(reply instanceof Error)throw reply;
      if(reply!==undefined)return JSON.stringify(typeof reply==='number'?{status:reply,body:'private-response-with-secrets'}:reply);
      return JSON.stringify({status:200,body:JSON.stringify(input.route==='/login'?{accessToken:'private-fixture-token'}:
        input.route==='/config/main'?{data:config}:[{filename:'.wizard.env'}])});
    }};
  return {candidate,requests,results,commands,scripts,time:()=>time,run:()=>candidate.stage('storage-detached-backup-normal-operation',()=>storage.verifyControlWithoutBackup(candidate))};
}

test('detached backup no-op Push preserves the controller, then explicit restart waits for Sync and retries configuration endpoints',async()=>{
  const f=restartedControlFixture({'/login':[502,new Error('private-transport-details')],'/config/main':[503],'/config/projects':[504]});
  await f.run();
  assert.equal(f.candidate.backupDetached,true);assert.equal(f.time(),4000);
  assert.deepEqual(f.requests.map(({route})=>route),['/','/login','/login','/login','/config/main','/config/main','/config/projects','/config/projects']);
  assert.equal(f.requests[0].host,'wizard.candidate.test');
  assert(f.requests.slice(1).every(request=>request.host==='sync.candidate.test'));
  assert.deepEqual(f.commands.filter(args=>args[0]==='restart'),[['restart','--time','30','system_bootstrapper_1']]);
  assert(!f.commands.some(args=>args.includes('{{.RestartCount}}')),'manual restart is verified through start time, not automatic restart count');
  assert.equal(f.results.at(-1).status,'passed');assert(!JSON.stringify(f.results).includes('private-'));
});

test('detached backup proof rejects a restarted no-op Push or a replaced controller and never marks either accepted',async()=>{
  for(const [control,reason]of [[{pushRestart:true},'storage-unchanged-push-restarted-controller'],
    [{replaced:true},'storage-restart-controller-identity-changed']]){
    const f=restartedControlFixture({},5000,20000,control);
    await assert.rejects(f.run,{message:reason});
    assert.equal(f.time(),0);assert.notEqual(f.candidate.backupDetached,true);
    assert.equal(f.commands.filter(args=>args[0]==='restart').length,control.pushRestart?0:1);
  }
});

test('detached backup startup proof requires an actual changed start time within the shared deadline',async()=>{
  const f=restartedControlFixture({},5000,2500,{noRestart:true});
  await assert.rejects(f.run,{message:'canceled-or-overall-timeout'});
  assert.notEqual(f.candidate.backupDetached,true);
});

test('actual detached Push transport accepts only an authenticated no-op response without a requested restart',async()=>{
  const f=restartedControlFixture();await f.run();
  for(const [response,accepted]of [
    [{applyMode:'none',status:{needRestart:false}},true],
    [{applyMode:'none',status:{needRestart:true}},false],
    [{applyMode:'routing',status:{needRestart:false}},false],
    [{applyMode:'restart',status:{needRestart:true}},false],
    [{},false]]){
    const input=JSON.parse(f.scripts[0].input),calls=[],stdin=new EventEmitter();
    let output='',exitCode;
    const done=new Promise(resolve=>{
      const process={stdin,stdout:{write:value=>{output+=value;resolve();}},set exitCode(value){exitCode=value;resolve();}};
      vm.runInNewContext(f.scripts[0].source,{Buffer,process,require:name=>{
        if(name==='fs')return {readFileSync:filename=>Buffer.from(filename.endsWith('.zip')?'archive':'certificate')};
        if(name==='crypto')return require('node:crypto');
        assert.equal(name,'https');
        return {request:(options,callback)=>{
          calls.push(options);const request=new EventEmitter();
          request.end=body=>queueMicrotask(()=>{
            if(options.path==='/login')assert.deepEqual(JSON.parse(body),{username:input.user,password:input.password});
            else {assert.equal(options.path,'/config/zip');assert.equal(options.headers.Authorization,'Bearer fixture-token');}
            const reply=new EventEmitter();reply.statusCode=200;callback(reply);
            reply.emit('data',Buffer.from(JSON.stringify(options.path==='/login'?{accessToken:'fixture-token'}:response)));reply.emit('end');
          });return request;
        }};
      }});
      stdin.emit('data',f.scripts[0].input);stdin.emit('end');
    });
    await done;
    assert.deepEqual(calls.map(call=>call.path),['/login','/config/zip']);
    assert(calls.every(call=>call.rejectUnauthorized===true&&call.timeout===10000));
    assert.equal(output,accepted?'accepted':'');assert.equal(exitCode,accepted?undefined:1);
  }
});

test('post-restart Sync rejects bad credentials and forbidden configuration immediately without exposing response data',async()=>{
  for(const route of ['/login','/config/main','/config/projects'])for(const status of [401,403]){
    const f=restartedControlFixture({[route]:[status]});
    await assert.rejects(f.run, {message:route==='/login'?'recovery-sync-login-failed':'recovery-fetch-failed'});
    assert.equal(f.requests.filter(request=>request.route===route).length,1);
    assert.equal(f.requests.at(-1).route,route);assert.equal(f.time(),0);
    assert.notEqual(f.candidate.backupDetached,true);assert.equal(f.results.at(-1).status,'failed');
    assert(!JSON.stringify(f.results).includes('private-'));
  }
});

test('post-restart Sync readiness retains its finite retry window and shared cancellation deadline',async()=>{
  for(const [deadline,reason,expectedTime]of [[20000,'readiness-timeout',3000],[1500,'canceled-or-overall-timeout',2000]]){
    const f=restartedControlFixture({'/login':()=>({status:502,body:'private-proxy-response'})},3000,deadline);
    await assert.rejects(f.run,{message:reason});
    assert.equal(f.time(),expectedTime);assert.equal(f.requests.filter(request=>request.route==='/login').length,expectedTime/1000);
    assert.equal(f.results.at(-1).reason,reason);assert.notEqual(f.candidate.backupDetached,true);
    assert(!JSON.stringify(f.results).includes('private-'));
  }
});

// Exercise the same Candidate.call used by the full-platform CI, not just a
// mocked storage adapter. Advance a virtual clock past the previous 30 s cap.
test('full acceptance waits for native storage refusal and retains a shared deadline',async()=>{
  const example=fs.readFileSync(path.join(__dirname,'../../config/system/.docker.env.example'),'utf8');
  const id='sha256:'+'a'.repeat(64),archive=path.resolve('fixture.tar'),calls=[];
  let clock=0,lock=false;
  const candidate=new Candidate({example,daemonImage:'docker:29-dind@'+id,fullAcceptance:true,
    guidedPreviewAcceptance:true,gitlabUpgradeAcceptance:true,publicUpgrade:{},
    images:Object.fromEntries(['candidate','wizard','gitlab','runner','nginx'].map(role=>[role,{id,archive}]))},
    {now:()=>clock,sleep:async ms=>{clock+=ms;},docker:(args,options)=>{
      calls.push({args,timeout:options.timeout});
      if(args.includes('mkdir')){lock=true;return '';}
      if(args.includes('rmdir')){assert(lock);lock=false;return '';}
      if(args.includes('launch')){
        assert(lock);assert(options.timeout>3600000,'native helper must not be cut off by transport');
        clock+=35000;
        throw Error('storage-operation-busy');
      }
      return '';
    }});
  candidate.daemon='owned';
  assert.equal(candidate.deadline,360*60000);
  await storage.refuseLockedLive(candidate,'restore');
  assert.equal(candidate.globalLeaseVerified,true);assert.equal(lock,false);
  assert.equal(calls.filter(call=>call.args.includes('launch')).length,1);
  assert.equal(clock,35000);
  // An ordinary operation inherits the remaining absolute budget even with a
  // legacy numeric limit. Explicit diagnostics and readiness keep their bounds.
  await candidate.call(['info'],{timeout:1000});
  assert.equal(calls.at(-1).timeout,candidate.deadline-clock);
  await candidate.call(['info'],{timeout:5000,boundedTransport:true});
  assert.equal(calls.at(-1).timeout,5000);
  await candidate.wait(async()=>{await candidate.call(['info'],{timeout:5000});return true;},2000);
  assert.equal(calls.at(-1).timeout,5000);
  assert.equal(candidate.polling,undefined);
  await candidate.stage('system-beta-native-stop',()=>candidate.call(['info'],{timeout:30000}));
  assert.equal(calls.at(-1).timeout,30000);
  clock=candidate.deadline;
  const count=calls.length;
  await assert.rejects(()=>candidate.call(['info']),/canceled-or-overall-timeout/);
  assert.equal(calls.length,count);
});

test('an uncertain storage refusal never releases the fixture lock or publishes acceptance',async()=>{
  const calls=[],candidate={inner:async(args,options)=>{
    calls.push({args,options});
    if(args.includes('launch'))throw Object.assign(Error('docker-exec-failed'),{systemCode:'ETIMEDOUT'});
    return '';
  }};
  await assert.rejects(()=>storage.refuseLockedLive(candidate,'restore'),/docker-exec-failed/);
  assert.equal(calls.find(call=>call.args.includes('launch')).options.timeout,null);
  assert.equal(calls.filter(call=>call.args.includes('launch')).length,1);
  assert.equal(calls.some(call=>call.args.includes('rmdir')),false);
  assert.equal(candidate.globalLeaseVerified,undefined);
});
