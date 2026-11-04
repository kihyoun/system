'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Upgrade,release,runnerAssignment,runnerSelection,imageAssignment,runnerHelper,runnerCheckpoint,atomic,run}=require('../../gitlab/upgrade');
const example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
const imageIds=Object.fromEntries([release.fromImage,release.toImage,release.runner.fromImage,release.runner.toImage,release.runner.fromHelperImage,release.runner.helperImage].map((ref,i)=>[ref,'sha256:'+String(i+1).repeat(64)]));
function fixture(t,retainedTag=false){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'security-runners-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const state=path.join(root,'state'),serviceData=path.join(root,'gitlab'),certbot=path.join(root,'certbot');
  for(const directory of [state,certbot,path.join(state,'.projects.env'),...['config','data','log'].map(n=>path.join(serviceData,n))])fs.mkdirSync(directory,{recursive:true});
  const runnerData=path.join(root,'runners'),runnerConfig=path.join(runnerData,'runner/1/config');fs.mkdirSync(runnerConfig,{recursive:true});atomic(path.join(runnerConfig,'config.toml'),'[[runners]]\n token = "private-fixture-token"\n [runners.docker]\n image = "alpine"\n');atomic(path.join(runnerConfig,'.runner_system_id'),'retained-manager-identity');
  const oldTag=release.runner.fromImage.split('@')[0],oldDigest=release.runner.fromImage.replace(/:[^/:@]+(?=@sha256:)/,'');
  const config=path.join(state,'.docker.env');let saved=runnerAssignment(imageAssignment(example,release.fromImage),release.runner.fromImage).replace('GITLAB_RUNNER_SCALE=4','GITLAB_RUNNER_SCALE=1');
  if(retainedTag)saved=saved.replace("export GITLAB_RUNNER_IMAGE='"+release.runner.fromImage+"'",'export GITLAB_RUNNER_IMAGE="'+oldTag+'"');
  atomic(config,saved);atomic(path.join(state,'sync-auth.env'),'export SYNC_USER=fixture\n');fs.writeFileSync(path.join(serviceData,'data/value'),'old');
  const events=[];let runnerImage=imageIds[release.runner.fromImage],gitlabImage=imageIds[release.fromImage],runnerRunning=true,gitlabRunning=true,wrongRunner=false,wrongIdentity=false;
  let taggedImage={Id:imageIds[release.runner.fromImage],RepoDigests:[oldDigest]};
  const engine=new Upgrade({sourceRevision:'a'.repeat(40),stateDir:'/state',persistentDir:'/platform',checkpointDir:'/state/gitlab-upgrades/test',evidence:'/state/evidence.json',readyTimeoutSeconds:60},{serviceData,certbot,runnerData,seed:path.join(root,'absent-backup-target'),run(binary,args,opts={}){
    if(binary==='bash'){
      if(opts.cwd.endsWith('/gitlab-runner')){events.push('runner-'+args[0]);runnerRunning=args[0]==='start.sh';if(runnerRunning){runnerImage=wrongRunner?'sha256:'+'9'.repeat(64):imageIds[engine.runnerReference()];if(wrongIdentity)atomic(path.join(runnerConfig,'.runner_system_id'),'unexpected-new-manager');}}
      else if(opts.cwd.endsWith('/gitlab')){gitlabRunning=true;gitlabImage=engine.configuration().includes(release.toImage)?imageIds[release.toImage]:imageIds[release.fromImage];events.push('gitlab-start');}
      return '';
    }
    if(binary==='docker'){
      if(args[0]==='image'&&args[1]==='inspect'&&args[2]===oldTag)return JSON.stringify([taggedImage]);
      if(args[0]==='ps')return runnerRunning?'runner_docker_1':'';
      if(args[0]==='stop'){gitlabRunning=false;return '';}
      if(args[0]==='exec'&&args.at(-1)==='--version')return 'Version:      '+(runnerImage===imageIds[release.runner.toImage]?release.runner.toVersion:release.runner.fromVersion);
      if(args[0]==='exec'&&args.at(-1)==='verify')return '';
      throw Error('unexpected Docker operation');
    }
    return run(binary,args,opts);
  }});
  engine.state=state;engine.config=config;engine.checkpoints=path.join(state,'gitlab-upgrades/test');
  engine.inspect=name=>name.startsWith('runner_')?{Image:runnerImage,State:{Running:runnerRunning},Config:{Labels:{'com.docker.compose.project':'runner','com.docker.compose.service':'docker_1'}}}:{Image:gitlabImage,State:{Running:gitlabRunning}};
  engine.image=reference=>{assert(imageIds[reference]);return imageIds[reference];};engine.verifyMounts=()=>{};
  engine.quiesceScheduling=async()=>events.push('scheduling-idle');engine.stop=()=>{gitlabRunning=false;events.push('gitlab-stop');};
  engine.ready=async(_version,id)=>assert.equal(gitlabImage,id);
  const plan={fromImageId:imageIds[release.fromImage],toImageId:imageIds[release.toImage],runner:engine.runnerPlan()};
  return {engine,plan,saved,events,root,runnerConfig,originalToml:fs.readFileSync(path.join(runnerConfig,'config.toml'),'utf8'),wrong(value){wrongRunner=value;},changeIdentity(value){wrongIdentity=value;},tagged(value){taggedImage={...taggedImage,...value};},runner(){return runnerImage;}};
}
test('native migration updates Runner only after final idle check, and cold rollback restores the exact saved Runner pin',async t=>{
  const f=fixture(t);f.engine.lock('a'.repeat(64));const result=await f.engine.migrate(f.plan);
  assert.equal(runnerSelection(f.engine.configuration()),release.runner.toImage);assert.equal(f.runner(),imageIds[release.runner.toImage]);
  assert(fs.readFileSync(path.join(f.runnerConfig,'config.toml'),'utf8').includes(release.runner.helperImage));
  assert(f.events.indexOf('scheduling-idle')<f.events.indexOf('runner-stop.sh'));assert(f.events.indexOf('runner-stop.sh')<f.events.indexOf('gitlab-stop'));
  assert(!fs.existsSync(path.join(f.root,'absent-backup-target')),'No backup target is needed for the local live lease.');
  await f.engine.rollback(result.checkpointSha256);assert.equal(f.engine.configuration(),f.saved);assert.equal(f.runner(),imageIds[release.runner.fromImage]);assert.equal(fs.readFileSync(path.join(f.runnerConfig,'config.toml'),'utf8'),f.originalToml);assert.equal(fs.readFileSync(path.join(f.runnerConfig,'.runner_system_id'),'utf8'),'retained-manager-identity');
});
test('wrong reconciled Runner fails promotion with its verified checkpoint and leases retained for rollback',async t=>{
  const f=fixture(t);f.wrong(true);f.engine.lock('a'.repeat(64));await assert.rejects(()=>f.engine.migrate(f.plan),/runner-image-mismatch/);
  assert(fs.existsSync(path.join(f.engine.state,'.gitlab-upgrade-lock/upgrade-owner.json')));const status=f.engine.status();assert.equal(status.phase,'checkpoint-complete');
  for(const lock of f.engine.held){const file=path.join(lock,'upgrade-owner.json'),owner=JSON.parse(fs.readFileSync(file));atomic(file,JSON.stringify({...owner,pid:99999999,start:'0'}));}
  f.wrong(false);await f.engine.rollback(status.checkpointSha256);assert.equal(f.engine.configuration(),f.saved);
});
test('Runner pin assignment and baseline ownership reject unknown images, duplicates and retargeted containers',t=>{
  const f=fixture(t);assert.throws(()=>runnerAssignment(example,'gitlab/gitlab-runner:latest'),/not-approved/);
  assert.throws(()=>runnerSelection(example+'\nGITLAB_RUNNER_IMAGE=other\n'),/assignment-required/);
  assert.throws(()=>runnerSelection(example.replace(release.runner.toImage,'unreviewed:latest')),/not-approved/);
  f.engine.inspect=()=>({Image:'sha256:'+'9'.repeat(64),State:{Running:true}});assert.throws(()=>f.engine.runnerPlan(),/owned-runner/);
});

test('helper migration and checkpoint paths reject custom images and traversal before writes',()=>{assert.throws(()=>runnerHelper('[runners.docker]\n helper_image = \"unreviewed:latest\"\n',release.runner.helperImage),/unreviewed/);assert.throws(()=>runnerCheckpoint({fromImage:release.runner.fromImage,scale:0,configurations:[{path:'../../private',sha256:'a'.repeat(64),managerIdentitySha256:'b'.repeat(64)}]}),/checkpoint-invalid/);});

test('a recreated manager identity refuses promotion before unlock and cold rollback restores the original identity',async t=>{
 const f=fixture(t);f.changeIdentity(true);f.engine.lock('a'.repeat(64));
 await assert.rejects(()=>f.engine.migrate(f.plan),/manager-identity-changed/);
 const status=f.engine.status();assert(status.locked);assert.equal(status.phase,'checkpoint-complete');
 for(const lock of f.engine.held){const file=path.join(lock,'upgrade-owner.json'),owner=JSON.parse(fs.readFileSync(file));atomic(file,JSON.stringify({...owner,pid:99999999,start:'0'}));}
 f.changeIdentity(false);await f.engine.rollback(status.checkpointSha256);
 assert.equal(fs.readFileSync(path.join(f.runnerConfig,'.runner_system_id'),'utf8'),'retained-manager-identity');
});

test('an existing double-quoted old Runner tag upgrades only after exact pin verification and rollback retains its original bytes',async t=>{
  const f=fixture(t,true);assert.equal(f.engine.runnerReference(),release.runner.fromImage);
  assert.equal(f.plan.runner.fromImage,release.runner.fromImage,'The reviewed plan must retain the canonical digest pin');
  assert.equal(f.plan.runner.fromImageId,imageIds[release.runner.fromImage]);
  assert(f.saved.includes('GITLAB_RUNNER_IMAGE="'+release.runner.fromImage.split('@')[0]+'"'));
  f.engine.lock('a'.repeat(64));const result=await f.engine.migrate(f.plan);
  assert.equal(f.runner(),imageIds[release.runner.toImage]);
  await f.engine.rollback(result.checkpointSha256);
  assert.equal(f.engine.configuration(),f.saved);assert.equal(f.runner(),imageIds[release.runner.fromImage]);
  assert.equal(fs.readFileSync(path.join(f.runnerConfig,'.runner_system_id'),'utf8'),'retained-manager-identity');
});

test('a retargeted old Runner tag, absent digest or different repository fails a new plan before any mutation',async t=>{
  const f=fixture(t,true);
  f.engine.evidence=()=>({sha256:'a'.repeat(64)});f.engine.preflight=async()=>f.engine.inspect('system_gitlab_1');
  for(const changed of [
    {Id:'sha256:'+'9'.repeat(64)},
    {Id:imageIds[release.runner.fromImage],RepoDigests:[]},
    {RepoDigests:['other/runner@'+release.runner.fromImage.split('@')[1]]},
    {RepoDigests:[release.runner.toImage.replace(/:[^/:@]+(?=@sha256:)/,'')]}
  ]){
    f.tagged(changed);await assert.rejects(()=>f.engine.plan(),/retained-runner-image-pin-mismatch/);
    assert.equal(f.engine.configuration(),f.saved);assert.deepEqual(f.events,[]);
    assert(!fs.existsSync(f.engine.checkpoints));assert(!fs.existsSync(path.join(f.engine.state,'.gitlab-upgrade-lock')));
  }
});

test('an old Runner tag retargeted after migration refuses cold rollback before locks, runner stops or data restoration',async t=>{
  const f=fixture(t,true);f.engine.lock('a'.repeat(64));const result=await f.engine.migrate(f.plan);
  fs.writeFileSync(path.join(f.root,'gitlab/data/value'),'migrated');const before=fs.readFileSync(f.engine.config,'utf8'),events=[...f.events];
  f.tagged({Id:'sha256:'+'9'.repeat(64)});
  await assert.rejects(()=>f.engine.rollback(result.checkpointSha256),/retained-runner-image-pin-mismatch/);
  assert.equal(fs.readFileSync(path.join(f.root,'gitlab/data/value'),'utf8'),'migrated');
  assert.equal(f.engine.configuration(),before);assert.deepEqual(f.events,events);
  assert(!fs.existsSync(path.join(f.engine.state,'.gitlab-upgrade-lock')));
});

test('old Runner tag compatibility requires the native verifier and does not admit other mutable selectors',t=>{
  const f=fixture(t,true);assert.throws(()=>runnerSelection(f.saved),/not-approved/);
  for(const reference of ['gitlab/gitlab-runner:latest',release.runner.toImage.split('@')[0],'other/runner:v19.4.0']){
    const text=f.saved.replace(release.runner.fromImage.split('@')[0],reference);
    assert.throws(()=>f.engine.runnerReference(text),/not-approved/);
  }
});
