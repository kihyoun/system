'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Upgrade,release,hash,atomic,run}=require('../../gitlab/upgrade');
const example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
const old='sha256:'+'b'.repeat(64),next='sha256:'+'c'.repeat(64);
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'upgrade-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const state=path.join(root,'state'),serviceData=path.join(root,'service'),seed=path.join(root,'seed'),certbot=path.join(root,'certbot');
  for(const directory of [state,serviceData,seed,certbot,path.join(state,'.projects.env')])fs.mkdirSync(directory,{recursive:true});
  for(const name of ['config','data','log']){fs.mkdirSync(path.join(serviceData,name));fs.writeFileSync(path.join(serviceData,name,'original'),'saved-'+name);}
  const originalConfig=example+'\nexport GITLAB_IMAGE=\''+release.fromImage+'\'\n';atomic(path.join(state,'.docker.env'),originalConfig);atomic(path.join(state,'sync-auth.env'),'export SYNC_USER=fixture\n');
  let current={Id:'d'.repeat(64),Image:old,State:{Running:false,ExitCode:0,OOMKilled:false}},failRestore=false,refuseStop=false;const events=[];
  const engine=new Upgrade({sourceRevision:'a'.repeat(40),stateDir:'/state',persistentDir:'/operator/platform',checkpointDir:'/state/gitlab-upgrades/operation',evidence:'/state/accepted.json',readyTimeoutSeconds:600},{serviceData,seed,certbot,run(binary,args,options){
    events.push([binary,...args]);if(binary==='docker'){
      if(args[0]==='inspect')return JSON.stringify([current]);
      if(args[0]==='stop'){if(!refuseStop)current.State.Running=false;return '';}
      throw Error('unexpected Docker fixture operation');
    }
    if(binary==='bash')return '';
    if(binary==='rsync'&&failRestore&&args.includes('--delete'))throw Error('injected-restore-copy-failure');
    return run(binary,args,options);
  }});
  engine.state=state;engine.config=path.join(state,'.docker.env');engine.checkpoints=path.join(state,'gitlab-upgrades/operation');
  engine.image=reference=>reference===release.fromImage?old:next;engine.verifyMounts=()=>{};
  engine.stop=()=>{events.push(['cold-stop']);current.State={Running:false,ExitCode:0,OOMKilled:false};};
  engine.start=(reference,restore)=>{events.push(['start',reference]);if(!restore)atomic(engine.config,require('../../gitlab/upgrade').imageAssignment(engine.configuration(),reference));current={...current,Image:reference===release.fromImage?old:next,State:{Running:true,ExitCode:0,OOMKilled:false}};};
  engine.ready=async(version,id)=>{assert.equal(current.Image,id);events.push(['ready',version]);};
  const plan={fromImageId:old,toImageId:next,sourceRevision:'a'.repeat(40),configurationSha256:hash(originalConfig)};
  return {engine,events,state,serviceData,originalConfig,plan,crash(exitCode=1,oom=true){current.State={Running:false,ExitCode:exitCode,OOMKilled:oom};},refuseStop(){refuseStop=true;},failRestore(){failRestore=true;}};
}
test('cold checkpoint is verified before B starts, and an exit1/OOM successor can restore exact old data/config',async t=>{
  const f=fixture(t);f.engine.lock('a'.repeat(64));const migrated=await f.engine.migrate(f.plan);
  assert.equal(migrated.status,'promoted');assert(fs.existsSync(path.join(f.engine.checkpoints,'checkpoint.json')));
  assert.equal(fs.readFileSync(path.join(f.engine.checkpoints,'gitlab/data/original'),'utf8'),'saved-data');
  fs.writeFileSync(path.join(f.serviceData,'data/original'),'migrated-data');fs.writeFileSync(path.join(f.serviceData,'data/new'),'migration-only');f.crash();
  const rolled=await f.engine.rollback(migrated.checkpointSha256);assert.equal(rolled.status,'restored-checkpoint');
  assert.equal(fs.readFileSync(path.join(f.serviceData,'data/original'),'utf8'),'saved-data');assert(!fs.existsSync(path.join(f.serviceData,'data/new')));
  assert.equal(fs.readFileSync(f.engine.config,'utf8'),f.originalConfig);assert(!fs.existsSync(path.join(f.serviceData,'data/.system-bootstrapper-restore-incomplete')));
  assert(!fs.existsSync(path.join(f.state,'.gitlab-upgrade-lock')));
});
test('corrupt cold checkpoint fails before restoring or acquiring operation leases',async t=>{
  const f=fixture(t);f.engine.lock('a'.repeat(64));const migrated=await f.engine.migrate(f.plan);fs.writeFileSync(path.join(f.engine.checkpoints,'gitlab/data/original'),'corrupted');
  await assert.rejects(()=>f.engine.rollback(migrated.checkpointSha256),/verification/);assert(!fs.existsSync(path.join(f.state,'.gitlab-upgrade-lock')));
});
test('failed restore preserves the durable startup barrier and owned leases',async t=>{
  const f=fixture(t);f.engine.lock('a'.repeat(64));const migrated=await f.engine.migrate(f.plan);f.failRestore();f.crash();
  await assert.rejects(()=>f.engine.rollback(migrated.checkpointSha256),/restore-copy/);assert(fs.existsSync(path.join(f.serviceData,'data/.system-bootstrapper-restore-incomplete')));assert(fs.existsSync(path.join(f.state,'.gitlab-upgrade-lock/upgrade-owner.json')));
  const owner=JSON.parse(fs.readFileSync(path.join(f.state,'.gitlab-upgrade-lock/upgrade-owner.json'),'utf8'));assert.equal(owner.checkpointSha256,migrated.checkpointSha256);
  assert.throws(()=>f.engine.adopt(migrated.checkpointSha256,'checkpointSha256'),/still-running/);
});
test('a still-running writer prevents restoration even if Docker stop returns success',async t=>{
  const f=fixture(t);f.engine.lock('a'.repeat(64));const migrated=await f.engine.migrate(f.plan);f.refuseStop();
  await assert.rejects(()=>f.engine.rollback(migrated.checkpointSha256),/writer-still-running/);assert.equal(fs.readFileSync(path.join(f.serviceData,'data/original'),'utf8'),'saved-data');
});
test('a foreign Harvest/certificate lease is never removed when acquisition fails',t=>{
  const f=fixture(t);const foreign=path.join(f.engine.seed,'.operation-lock');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'foreign'),'keep');assert.throws(()=>f.engine.lock('a'.repeat(64)));assert.equal(fs.readFileSync(path.join(foreign,'foreign'),'utf8'),'keep');assert(!fs.existsSync(path.join(f.state,'.gitlab-upgrade-lock')));
});

test('every copied checkpoint directory and its ancestors are durable before the successor starts',async t=>{
  const f=fixture(t),synced=new Set(),originalSync=fs.fsyncSync;
  fs.fsyncSync=fd=>{synced.add(fs.readlinkSync('/proc/self/fd/'+fd));return originalSync(fd);};
  const start=f.engine.start;f.engine.start=(...args)=>{
    for(const directory of [f.engine.checkpoints,path.join(f.engine.checkpoints,'gitlab'),path.join(f.engine.checkpoints,'gitlab/data'),path.join(f.engine.checkpoints,'configuration'),path.dirname(f.engine.checkpoints),f.state])assert(synced.has(directory),'Missing durable checkpoint directory: '+directory);
    return start(...args);
  };
  try{f.engine.lock('a'.repeat(64));await f.engine.migrate(f.plan);}finally{fs.fsyncSync=originalSync;}
});
