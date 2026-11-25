'use strict';
// Public host preflight with synthetic mount discovery; never mount a disk.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {HostPersistenceService}=require('../../dist/modules/host-lifecycle/persistence.service');
const {ManagedChildProcess}=require('../../dist/common/runtime/managedChild');
const script=path.resolve(__dirname,'../../dist/cli/main.js');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'system-storage-guard-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const mount=path.join(root,'mounted'),data=path.join(mount,'platform'),bin=path.join(root,'bin');fs.mkdirSync(mount);fs.mkdirSync(bin);
  const env={...process.env,PERSISTENCE_MIN_FREE_BYTES:'1',PERSISTENCE_MODE:'volume',PERSISTENT_MOUNT:mount,PERSISTENT_DIR:data,PERSISTENT_UUID:'expected-uuid',PATH:bin+':'+process.env.PATH};
  delete env.PERSISTENCE_ENV_FILE;delete env.PERSISTENCE_CHECK_ONLY;
  function mock(name,content){fs.writeFileSync(path.join(bin,name),'#!'+process.execPath+'\n'+content,{mode:0o755});}
  mock('mountpoint','process.exit(0);');
  mock('findmnt',`const args=process.argv.slice(2);console.log(args.includes('MAJ:MIN')?(args.at(-1)==='/'?'root-device':'volume-device'):args.includes('UUID')?'expected-uuid':process.env.PERSISTENT_MOUNT);`);
  const native=new ManagedChildProcess();
  const service=new HostPersistenceService({run(binary,args,options){
    if(binary==='mountpoint')return fs.readFileSync(path.join(bin,binary),'utf8').includes('process.exit(1)')?Promise.reject(Error('absent mount')):Promise.resolve('');
    if(binary==='findmnt')return Promise.resolve(args.includes('MAJ:MIN')?(args.at(-1)==='/'?'root-device':'volume-device'):args.includes('UUID')?'expected-uuid':options.env.PERSISTENT_MOUNT);
    return native.run(binary,args,options);
  }});
  const run=async()=>{try{await service.prepare(env);return {status:0};}catch(error){return {status:1,stderr:error.message};}};
  const runCli=()=>spawnSync(process.execPath,[script,'persistence','--checkout',path.resolve(__dirname,'../..')],{env,encoding:'utf8'});
  return {root,mount,data,env,mock,run,runCli};
}
test('missing mount, invalid selection, UUID and free space fail before creating live data',async t=>{
  for(const mutate of [
    f=>f.mock('mountpoint','process.exit(1);'),
    f=>f.env.PERSISTENCE_MODE='local',
    f=>f.env.PERSISTENCE_MIN_FREE_BYTES='99999999999999999',
    f=>f.env.PERSISTENCE_MODE='automatic',
    f=>f.env.PERSISTENT_UUID='different',
  ]){const f=fixture(t);mutate(f);assert.notEqual((await f.run()).status,0);assert(!fs.existsSync(f.data));}
});
test('local defaults and explicit selector do not depend on the backup medium',async t=>{
  for(const explicit of [false,true]){
    const f=fixture(t),backup=path.join(f.root,'absent-backup');
    delete f.env.PERSISTENCE_MODE;delete f.env.PERSISTENT_MOUNT;delete f.env.PERSISTENT_UUID;
    f.env.SEED_DIR=backup+'/seed';f.env.SEED_MOUNT=backup;
    if(explicit){
      const selector=path.join(f.root,'selector.env');
      fs.writeFileSync(selector,`export PERSISTENCE_MODE='local'\nPERSISTENT_MOUNT=/\nPERSISTENT_DIR='${f.data}'\nPERSISTENT_UUID=''\n`,{mode:0o600});
      f.env.PERSISTENCE_ENV_FILE=selector;f.env.PERSISTENT_DIR='/invalid-env-selection';
    }
    f.mock('findmnt',"console.log('/');");
    const result=f.runCli();assert.equal(result.status,0,result.stderr);assert(fs.statSync(path.join(f.data,'gitlab/data')).isDirectory());assert(!fs.existsSync(backup));
  }
  const f=fixture(t),marker=path.join(f.root,'injected'),selector=path.join(f.root,'selector.env');
  fs.writeFileSync(selector,`PERSISTENT_DIR=$(touch ${marker})\n`);f.env.PERSISTENCE_ENV_FILE=selector;
  assert.notEqual(f.runCli().status,0);assert(!fs.existsSync(marker));assert(!fs.existsSync(f.data));
});
test('repeatable volume initialization preserves private keys and exposes only public ACME paths',async t=>{
  const f=fixture(t);let result=await f.run();assert.equal(result.status,0,result.stderr);
  for(const directory of ['runners','gitlab/data','wizard-public'])assert(fs.statSync(path.join(f.data,directory)).isDirectory());
  const mode=name=>fs.statSync(path.join(f.data,name)).mode&0o777;
  assert.equal(mode('wizard-public'),0o755);assert.equal(mode('configuration'),0o700);assert.equal(mode('ssl'),0o711);assert.equal(mode('ssl/acme-http01'),0o755);
  fs.mkdirSync(path.join(f.data,'ssl/live'),{mode:0o700});fs.writeFileSync(path.join(f.data,'ssl/live/privkey.pem'),'private fixture',{mode:0o600});fs.chmodSync(path.join(f.data,'ssl'),0o700);
  result=await f.run();assert.equal(result.status,0,result.stderr);assert.equal(mode('ssl'),0o711);assert.equal(mode('ssl/live'),0o700);assert.equal(mode('ssl/live/privkey.pem'),0o600);
  const check=fixture(t);check.env.PERSISTENCE_CHECK_ONLY='1';result=await check.run();assert.equal(result.status,0,result.stderr);assert(!fs.existsSync(check.data));
});
test('directory and marker escapes fail without creating or chmodding foreign targets',async t=>{
  for(const [relative,exists] of [['ssl/acme-http01',true],['gitlab',true],['configuration',false],['.system-bootstrapper-volume',false],['wizard-public',false]]){
    const f=fixture(t),target=path.join(f.root,'outside');fs.mkdirSync(path.dirname(path.join(f.data,relative)),{recursive:true});
    if(exists)fs.mkdirSync(target,{mode:0o700});fs.symlinkSync(target,path.join(f.data,relative));
    assert.notEqual((await f.run()).status,0,relative);
    if(exists){assert.equal(fs.statSync(target).mode&0o777,0o700);assert.deepEqual(fs.readdirSync(target),[]);}else assert(!fs.existsSync(target));
  }
  const f=fixture(t);fs.mkdirSync(f.data);fs.writeFileSync(path.join(f.data,'.system-bootstrapper-volume'),'unknown\n');assert.notEqual((await f.run()).status,0);
});
