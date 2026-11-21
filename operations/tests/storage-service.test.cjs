'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const {NestFactory}=require('@nestjs/core');
const {StorageModule}=require('../dist/storage/storage.module');
const {StorageService}=require('../dist/storage/storage.service');
const {StorageLease}=require('../dist/storage/lease');
const {importFreshConfiguration}=require('../dist/storage/configuration');
const {dockerRun}=require('../dist/storage/helper');
const {ProcessFailure}=require('../dist/runtime/process');
const manifest=require('../dist/storage/manifest');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'storage-service-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('Nest service and standalone entry use the same startup barrier and busy exit code',async t=>{
  const root=fixture(t),environment={...process.env,SYSTEM_CONFIG_DIR:root};
  const app=await NestFactory.createApplicationContext(StorageModule.register({normalizePreview:value=>value}),{logger:false});
  try {
    const service=app.get(StorageService),operation=await service.run({action:'startup-begin',ownerPid:process.pid,environment});
    const result=spawnSync(process.execPath,[path.join(__dirname,'../dist/storage/entry.js'),'startup-begin',String(process.pid)],{env:environment,encoding:'utf8'});
    assert.equal(result.status,75,result.stderr);assert.match(result.stderr,/storage-operation-busy/);
    await service.run({action:'startup-finish',environment:{...environment,SYSTEM_STARTUP_OPERATION:operation}});
    assert(!fs.existsSync(path.join(root,'.storage-operation-lock')));
  } finally {await app.close();}
});
test('CLI redacts malformed private input',t=>{
  const result=spawnSync(process.execPath,[path.join(__dirname,'../dist/storage/entry.js'),'validate'],{env:{...process.env,SYSTEM_STORAGE_SPEC:'secret-do-not-print'},encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/seed-operation-failed/);assert(!result.stderr.includes('secret-do-not-print'));
});
test('fresh configuration import retains environment lease and rejects overwrite',t=>{
  const root=fixture(t),state=path.join(root,'state'),zip=path.join(root,'backup.zip');fs.mkdirSync(state);
  const main=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example')).subarray(0,1184).toString()+'\nGITLAB_IMAGE=gitlab:fixture\n';
  execFileSync('python3',['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr(".docker.env",sys.argv[2])\n z.writestr(".projects.env/.example.env","PROJECT_NAME=example\\n")',zip,main]);
  const held=new StorageLease(state,{operation:'restore'});held.acquireEnvironment();const before=fs.statSync(held.environment).ino;
  try {importFreshConfiguration(zip,state);assert.equal(fs.statSync(held.environment).ino,before);
    assert.equal(fs.readFileSync(path.join(state,'.docker.env'),'utf8'),main);
    assert.equal(fs.readFileSync(path.join(state,'.projects.env/.example.env'),'utf8'),'PROJECT_NAME=example\n');
    assert.throws(()=>importFreshConfiguration(zip,state),/restore-configuration-already-exists/);
  } finally {held.release(true);}
});
// This executable models only Docker transport and the child's mount namespace.
// The compiled entry, storage service, filesystem guards and process runner are real.
function storageDocker(input){
  const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(3);
  fs.appendFileSync(input.calls,args[0]+'\n');
  const image='sha256:'+'a'.repeat(64),record=path.join(input.root,'helper.json');
  const selected=()=>JSON.parse(args.find(value=>value.startsWith('SYSTEM_STORAGE_SPEC=')).slice('SYSTEM_STORAGE_SPEC='.length));
  if(args[0]==='inspect'){
    if(args[1]==='system_bootstrapper_1')console.log(JSON.stringify([{Image:image}]));
    else {const helper=JSON.parse(fs.readFileSync(record,'utf8'));if(args[1]!==helper.name)throw Error('unexpected helper');console.log(JSON.stringify([{Image:image,State:{Running:false},Config:{Labels:{'org.system-bootstrapper.storage-operation':helper.name}}}]));}return;
  }
  if(args[0]==='create'){fs.writeFileSync(record,JSON.stringify({name:args[args.indexOf('--name')+1],spec:selected()}));console.log('b'.repeat(64));return;}
  if(args[0]==='rm')return;
  if(args[0]==='container'&&args[1]==='ls')return;
  if(args[0]!=='run'&&!(args[0]==='start'&&args[1]==='--attach'))throw Error('unexpected Docker command');
  const action=args[0]==='run'?'validate':'inside',spec=action==='validate'?selected():JSON.parse(fs.readFileSync(record,'utf8')).spec;
  const validation=require(input.runtime+'/storage/validation'),entry=require(input.runtime+'/storage/entry');
  const validate=validation.validate;
  validation.validate=value=>validate(value,()=>input.mounts,input.host);
  const aliases=[['/host',input.host],['/live',input.host+'/data/platform'],['/srv/gitlab/log',input.host+'/data/platform/gitlab/logs'],['/srv/gitlab',input.host+'/data/platform/gitlab'],['/seed',input.host+'/external-seed/seed']];
  const map=value=>typeof value==='string'?(()=>{const match=aliases.find(([virtual])=>value===virtual||value.startsWith(virtual+'/'));return match?match[1]+value.slice(match[0].length):value;})():value;
  for(const name of ['existsSync','statSync','lstatSync','readFileSync','readdirSync','readlinkSync','openSync']){
    const native=fs[name];fs[name]=(value,...rest)=>native(map(value),...rest);
  }
  const realpath=fs.realpathSync;fs.realpathSync=value=>{
    const mapped=map(value),actual=realpath(mapped);
    if(mapped===value)return actual;
    const match=aliases.find(([virtual])=>value===virtual||value.startsWith(virtual+'/'));
    return match[0]+actual.slice(match[1].length);
  };
  entry.main([action],{...process.env,SYSTEM_STORAGE_SPEC:JSON.stringify(spec)}).catch(entry.reportFailure);
}
test('native launch preserves exact missing-media, busy, nonempty and corrupt-Seed refusals through both children',async t=>{
  for(const [code,operation]of [['seed-target-unavailable','harvest'],['storage-operation-busy','harvest'],['restore-target-not-empty','restore'],['seed-payload-invalid','restore']])await t.test(code,t=>{
    const root=fixture(t),host=path.join(root,'host'),live=path.join(host,'data/platform'),seed=path.join(host,'external-seed/seed'),bin=path.join(root,'bin');
    for(const directory of ['configuration','wizard-public','templates','synctemplates','ssl','runners','gitlab/config','gitlab/logs','gitlab/data','host/letsencrypt'])fs.mkdirSync(path.join(live,directory),{recursive:true});
    fs.mkdirSync(seed,{recursive:true});fs.mkdirSync(bin);
    fs.writeFileSync(path.join(live,'.system-bootstrapper-volume'),'system-bootstrapper-persistence-v1\n');
    fs.writeFileSync(path.join(live,'configuration/.docker.env'),fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example')).subarray(0,1184).toString()+'\nGITLAB_IMAGE=gitlab:fixture\n');
    if(code==='seed-target-unavailable')fs.rmSync(path.join(host,'external-seed'),{recursive:true});
    if(code==='storage-operation-busy')fs.mkdirSync(path.join(live,'configuration/.storage-operation-lock'));
    if(code==='restore-target-not-empty')fs.writeFileSync(path.join(live,'gitlab/data/user-data'),'retained');
    if(code==='seed-payload-invalid'){
      const snapshot=path.join(seed,'snapshots/completed');for(const directory of ['srv/gitlab/config','ssl','letsencrypt'])fs.mkdirSync(path.join(snapshot,directory),{recursive:true});
      const proof=path.join(snapshot,'srv/gitlab/config/proof');fs.writeFileSync(proof,'completed');manifest.create(snapshot);
      fs.symlinkSync('snapshots/completed',path.join(seed,'current'));fs.writeFileSync(proof,'corrupt');
      assert.throws(()=>manifest.verify(snapshot),error=>error.message===code);
    }
    const calls=path.join(root,'calls'),runtime=path.resolve(__dirname,'../dist');
    const mounts='1 0 0:1 / / rw - overlay overlay rw\n'+(code==='seed-target-unavailable'?'':'2 1 8:2 / /external-seed rw - ext4 /dev/vdb rw\n');
    fs.writeFileSync(path.join(bin,'docker'),'#!'+process.execPath+'\n('+storageDocker.toString()+')('+JSON.stringify({root,host,calls,runtime,mounts})+');\n',{mode:0o755});
    const environment={...process.env,PATH:bin+path.delimiter+process.env.PATH,SYSTEM_CONFIG_DIR:path.join(live,'configuration'),
      PERSISTENCE_MODE:'local',PERSISTENT_MOUNT:'/',PERSISTENT_DIR:'/data/platform',SEED_DIR:'/external-seed/seed',SEED_MOUNT:'/external-seed'};
    const result=spawnSync(process.execPath,[path.join(runtime,'storage/entry.js'),'launch',operation],{env:environment,encoding:'utf8',timeout:10000});
    assert.equal(result.status,1,result.stderr);assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'Seed operation failed: '+code+'.');
    const actions=fs.readFileSync(calls,'utf8').trim().split('\n');assert.deepEqual(actions.slice(0,2),['inspect','run']);
    if(code==='seed-target-unavailable'){assert.deepEqual(actions,['inspect','run']);assert(!fs.existsSync(path.join(host,'external-seed')));}
    else {assert(actions.includes('create'));assert(actions.includes('start'));assert.equal(actions.at(-1),'rm');assert(!fs.existsSync(path.join(live,'gitlab/data/.system-bootstrapper-restore-incomplete')));}
    if(code==='storage-operation-busy')assert(fs.existsSync(path.join(live,'configuration/.storage-operation-lock')));
    if(code==='restore-target-not-empty')assert.equal(fs.readFileSync(path.join(live,'gitlab/data/user-data'),'utf8'),'retained');
  });
});
test('manifest refusal codes classify schema and payload mismatches without hiding read or JSON failures',t=>{
  const root=fixture(t),file=path.join(root,'manifest.json');
  fs.writeFileSync(file,JSON.stringify({format:'unsupported',consistency:'gitlab-stopped'}));
  assert.throws(()=>manifest.verify(root),error=>error.message==='seed-payload-invalid');
  fs.writeFileSync(file,'private-invalid-json');assert.throws(()=>manifest.verify(root),SyntaxError);
  fs.unlinkSync(file);assert.throws(()=>manifest.verify(root),error=>error.code==='ENOENT');
  fs.mkdirSync(file);assert.throws(()=>manifest.verify(root),error=>error.code==='EISDIR');
});
test('storage refuses generic, uncertain or unbound process errors without accepting them as semantic refusals',()=>{
  const validate=['run','--rm','image','/system/operations/dist/storage/entry.js','validate'];
  for(const error of [new ProcessFailure('docker',1,null,false),new ProcessFailure('docker',1,null,true,'seed-target-unavailable'),
    new ProcessFailure('docker',1,'SIGTERM',false,'seed-target-unavailable'),new ProcessFailure('docker',137,null,false,'seed-target-unavailable'),
    new ProcessFailure('other',1,null,false,'seed-target-unavailable'),new ProcessFailure('docker',1,null,false,'operator-secret')]){
    const run=dockerRun({run(){throw error;}});assert.throws(()=>run(validate),actual=>actual===error);
  }
  const failure=new ProcessFailure('docker',1,null,false,'seed-target-unavailable');
  const run=dockerRun({run(_binary,_args,options){assert.equal(options.controlledFailureCodes,undefined);throw failure;}});
  for(const args of [['inspect','system_bootstrapper_1'],['start','--attach','unowned-helper']])assert.throws(()=>run(args),actual=>actual===failure);
});
