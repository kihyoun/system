'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Upgrade,release,hash,atomic,run,json,INPUT_JSON_MAX_BYTES,CHECKPOINT_JSON_MAX_BYTES}=require('../../gitlab/upgrade');
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
  engine.quiesceScheduling=async()=>{events.push(['scheduling-quiesced']);};
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
test('a real copied inventory larger than 4MiB is readable and still rejects changed checkpoint data',t=>{
  const f=fixture(t);let directory=path.join(f.serviceData,'data');
  // Long but valid retained paths exercise a realistic inventory size with fewer
  // filesystem operations than tens of thousands of short-path files.
  for(let depth=0;depth<9;depth++){directory=path.join(directory,'retained-'+String(depth)+'-'+'x'.repeat(180));fs.mkdirSync(directory);}
  for(let index=0;index<2400;index++)fs.writeFileSync(path.join(directory,'entry-'+String(index).padStart(4,'0')),'saved');
  const receipt=f.engine.snapshot(f.plan),file=path.join(f.engine.checkpoints,'checkpoint.json');
  assert(fs.statSync(file).size>INPUT_JSON_MAX_BYTES,'The regression requires a genuine >4MiB filesystem inventory.');
  assert(fs.statSync(file).size<CHECKPOINT_JSON_MAX_BYTES);
  assert.deepEqual(f.engine.checkpoint(receipt.checkpointSha256),receipt.checkpoint);
  fs.writeFileSync(path.join(f.engine.checkpoints,'gitlab/data/original'),'wrong-data');
  assert.throws(()=>f.engine.checkpoint(receipt.checkpointSha256),/checkpoint-verification-failed/);
});
test('checkpoint size is bounded before reading or publishing, while options and evidence retain the 4MiB limit',t=>{
  const f=fixture(t),large=path.join(f.state,'large-input.json');
  atomic(large,'{}'+' '.repeat(INPUT_JSON_MAX_BYTES));
  assert.throws(()=>json(large),/upgrade-input-too-large/,'The CLI options reader keeps the small private-input budget.');
  f.engine.options.evidence=large;assert.throws(()=>f.engine.evidence(),/upgrade-input-too-large/);
  fs.mkdirSync(f.engine.checkpoints,{recursive:true});const checkpoint=path.join(f.engine.checkpoints,'checkpoint.json');
  atomic(checkpoint,'{}');fs.truncateSync(checkpoint,CHECKPOINT_JSON_MAX_BYTES+1);
  let read=false;const originalRead=fs.readSync;fs.readSync=(...args)=>{read=true;return originalRead(...args);};
  try{assert.throws(()=>f.engine.checkpoint('a'.repeat(64)),/upgrade-checkpoint-too-large/);}finally{fs.readSync=originalRead;}
  assert(!read,'An oversized checkpoint must be refused from metadata before reading payload bytes.');
  fs.rmSync(f.engine.checkpoints,{recursive:true});
  assert.throws(()=>f.engine.snapshot({...f.plan,oversized:'x'.repeat(CHECKPOINT_JSON_MAX_BYTES)}),/upgrade-checkpoint-too-large/);
  assert(!fs.existsSync(checkpoint),'An unreadable checkpoint must not be published.');
});
test('evidence validation and its plan hash use the same bounded bytes even if the pathname is replaced',t=>{
  const f=fixture(t),filename=path.join(f.state,'accepted-evidence.json'),candidate='sha256:'+'e'.repeat(64);
  const raw=JSON.stringify({sourceRevision:f.plan.sourceRevision,fullAcceptance:true,
    results:['gitlab-upgrade-migrated-data','gitlab-upgrade-registry-ci','gitlab-upgrade-restored-checkpoint'].map(name=>({name,status:'passed'})),
    images:{candidate,gitlab:next},evidence:{gitlabUpgrade:{fromImage:release.fromImage,toImage:release.toImage,fromImageId:old,toImageId:next,migrationVerified:true,rollbackVerified:true,registryVerified:true,checkpointVerified:true}}});
  atomic(filename,raw);f.engine.options.evidence=filename;f.engine.inspect=()=>({Image:candidate});
  let replaced=false;const originalRead=fs.readSync;
  fs.readSync=(descriptor,...args)=>{
    const count=originalRead(descriptor,...args);
    if(count>0&&!replaced&&fs.readlinkSync('/proc/self/fd/'+descriptor)===filename){replaced=true;atomic(filename,' '.repeat(INPUT_JSON_MAX_BYTES+1));}
    return count;
  };
  try{assert.deepEqual(f.engine.evidence(),{sha256:hash(raw),candidateImage:candidate});}finally{fs.readSync=originalRead;}
  assert(replaced);assert.throws(()=>f.engine.evidence(),/upgrade-input-too-large/);
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

test('restore replaces changed bytes even when file size and modification time equal the cold checkpoint',async t=>{
  const f=fixture(t);fs.utimesSync(path.join(f.serviceData,'data/original'),1700000000,1700000000);f.engine.lock('a'.repeat(64));const migrated=await f.engine.migrate(f.plan);
  const live=path.join(f.serviceData,'data/original'),saved=path.join(f.engine.checkpoints,'gitlab/data/original'),metadata=fs.statSync(saved);
  const old=fs.readFileSync(saved);fs.writeFileSync(live,Buffer.alloc(old.length,88));fs.utimesSync(live,metadata.atime,metadata.mtime);
  assert.equal(fs.statSync(live).size,metadata.size);assert.equal(Math.floor(fs.statSync(live).mtimeMs),Math.floor(metadata.mtimeMs));
  f.crash();await f.engine.rollback(migrated.checkpointSha256);assert(fs.readFileSync(live).equals(old));
});

test('a completed worker group does not permit adoption while its journal-writing watchdog is alive',async t=>{
  const f=fixture(t);f.engine.lock('a'.repeat(64));const migrated=await f.engine.migrate(f.plan);f.engine.adopt(migrated.checkpointSha256,'checkpointSha256');
  const owner={...f.engine.owner,pid:99999999,start:'0'};
  for(const lock of f.engine.held)atomic(path.join(lock,'upgrade-owner.json'),JSON.stringify(owner));
  const {stat}=require('../../gitlab/upgrade-child');
  atomic(path.join(f.state,'.gitlab-upgrade-lock/child.json'),JSON.stringify({format:'system-gitlab-upgrade-child-v1',operation:owner.operation,group:99999999,watchdogPid:process.pid,watchdogStart:stat(process.pid).start,phase:'completed'}));
  assert.throws(()=>f.engine.adopt(migrated.checkpointSha256,'checkpointSha256'),/child-still-running/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.state,'.gitlab-upgrade-lock/upgrade-owner.json'),'utf8')).pid,99999999);
});

test('API scheduling quiescence and final job check precede full GitLab stop and cold checkpoint',async t=>{
  const f=fixture(t);f.engine.lock('a'.repeat(64));
  f.engine.quiesceScheduling=require('../../gitlab/upgrade').Upgrade.prototype.quiesceScheduling.bind(f.engine);
  f.engine.docker=args=>{assert(args.includes(require('../../gitlab/upgrade').SCHEDULING_QUIESCE_SCRIPT));f.events.push(['ingress-services-down']);return '';};
  f.engine.preflight=async()=>{assert.equal(f.events.at(-1)[0],'ingress-services-down');f.events.push(['final-job-check']);return {};};
  await f.engine.migrate(f.plan);
  const names=f.events.map(event=>event[0]);assert(names.indexOf('ingress-services-down')<names.indexOf('final-job-check'));assert(names.indexOf('final-job-check')<names.indexOf('cold-stop'));
});

test('a job assigned before HTTP ingress drains resumes old API without stopping GitLab, backing up or cancelling jobs',async t=>{
  const f=fixture(t);f.engine.lock('a'.repeat(64));
  f.engine.quiesceScheduling=require('../../gitlab/upgrade').Upgrade.prototype.quiesceScheduling.bind(f.engine);
  f.engine.docker=args=>{assert(args.includes(require('../../gitlab/upgrade').SCHEDULING_QUIESCE_SCRIPT));f.events.push(['ingress-services-down']);return '';};
  f.engine.preflight=async()=>{f.events.push(['job-assignment-discovered']);throw Error('upgrade-jobs-active');};
  f.engine.resumeScheduling=async()=>{f.events.push(['previous-ingress-resumed']);};
  await assert.rejects(()=>f.engine.migrate(f.plan),/jobs-active/);
  const names=f.events.map(event=>event[0]);assert(names.includes('previous-ingress-resumed'));assert(!names.includes('cold-stop'));assert(!names.includes('start'));
  assert(!fs.existsSync(f.engine.checkpoints));assert(!fs.existsSync(path.join(f.state,'.gitlab-upgrade-lock')));
  assert.equal(fs.readFileSync(f.engine.config,'utf8'),f.originalConfig);assert.equal(fs.readFileSync(path.join(f.serviceData,'data/original'),'utf8'),'saved-data');
});
