'use strict';
const assert=require('node:assert/strict');
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

test('a failed payload refusal cannot publish acceptance or leave the corruption injected by its fixture',async()=>{
  const calls=[],candidate={daemon:'owned',stage:async(_name,action)=>action(),call:async args=>{calls.push(args);return args.includes('readlink')?'snapshots/completed':'';},inner:async args=>{
    if(args.at(-1)==='seed.sh'&&calls.some(call=>call.at(-1).includes('printf corrupt')))throw Error('docker-exec-failed');
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
    if(args.at(-1)==='seed.sh')throw Error('storage-operation-busy');
    return '';
  }};
  await storage.refuseLockedLive(candidate,'restore');
  assert.equal(candidate.globalLeaseVerified,true);
  assert.equal(calls.filter(args=>args[0]==='ps').length,2);
  assert.equal(calls.filter(args=>args.includes('mkdir')).length,1);
  assert.equal(calls.filter(args=>args.includes('rmdir')).length,1);
});
