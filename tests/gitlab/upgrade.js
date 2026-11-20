'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Upgrade,release,options,imageAssignment,inventory,hash,atomic,run}=require('../../gitlab/upgrade');
const example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
const base={sourceRevision:'a'.repeat(40),evidence:'/state/evidence.json',stateDir:'/state',persistentDir:'/operator/platform',checkpointDir:'/state/gitlab-upgrades/test',readyTimeoutSeconds:600};
const ids={old:'sha256:'+'b'.repeat(64),next:'sha256:'+'c'.repeat(64)};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gitlab-upgrade-contract-'));
(async()=>{try{
  assert.equal(release.toVersion,'19.6.1');assert.equal(release.fromVersion,'19.5.3');
  assert.equal(release.runner.fromVersion,'19.5.1');assert.equal(release.runner.toVersion,'19.6.0');
  assert.equal(release.requiredUpgradeStop,'19.5');
  assert.match(release.runner.helperImage,/:x86_64-v19\.6\.0@sha256:[a-f0-9]{64}$/);
  for(const file of ['system/.docker.env.example','system/docker-compose.yml','Prepare-Host.md']){
    const text=fs.readFileSync(path.join(__dirname,'../..',file),'utf8');
    assert(text.includes(release.toImage),file+' must select the reviewed GitLab target');
    assert(text.includes(release.runner.toImage),file+' must select the reviewed Runner target');
  }
  assert(fs.readFileSync(path.join(__dirname,'../../gitlab-runner/docker-compose.yml'),'utf8').includes(release.runner.toImage));
  assert.equal(options(base),base);for(const patch of [{stateDir:'/tmp'},{checkpointDir:'/state/../private'},{sourceRevision:'main'},{readyTimeoutSeconds:30},{allowFailure:true}])assert.throws(()=>options({...base,...patch}));
  const updated=imageAssignment(example,release.toImage);assert.equal(updated.slice(0,1184),example.slice(0,1184));assert(updated.includes(release.toImage));assert.equal(imageAssignment(updated,release.toImage),updated);
  assert.throws(()=>imageAssignment(example+'\nGITLAB_IMAGE=one\nGITLAB_IMAGE=two\n',release.toImage),/duplicate/);assert.throws(()=>imageAssignment('badcube',release.toImage),/cube/);assert.throws(()=>imageAssignment(example,'gitlab/gitlab-ee:latest'),/approved/);
  assert.equal(run(process.execPath,['-p','process.cwd()'],{cwd:root}),root,'All lifecycle subprocesses must use the intended component working directory.');
  for(const name of ['gitlab','configuration'])fs.mkdirSync(path.join(root,name));fs.writeFileSync(path.join(root,'gitlab/value'),'original');const expected=inventory(root);fs.writeFileSync(path.join(root,'gitlab/value'),'changed');assert.notDeepEqual(inventory(root),expected);fs.writeFileSync(path.join(root,'gitlab/value'),'original');fs.symlinkSync('value',path.join(root,'gitlab/link'));assert(inventory(root).some(e=>e.type==='link'&&e.target==='value'));
  atomic(path.join(root,'private.json'),'data');assert.equal(fs.statSync(path.join(root,'private.json')).mode&0o777,0o600);assert.equal(hash('data').length,64);
  const calls=[];let state={Running:false,ExitCode:0,OOMKilled:false};const engine=new Upgrade(base,{run(binary,args,opts){calls.push({binary,args,opts});if(args[0]==='inspect')return JSON.stringify([{State:state}]);if(args.includes('status'))return 'down: native-service: 0s';return '';}});
  await engine.stop();assert(calls.find(c=>c.args.includes('gitlab-ctl')).args.includes('stop'));assert(calls.find(c=>c.args[0]==='stop').args.includes('60'));
  assert(calls.every(call=>!call.args.includes('/bin/sh')));
  const stopping=calls.findIndex(c=>c.args[0]==='stop'),quiesce=calls.findIndex(c=>c.args.some(value=>value.includes('gitlab-ctl')));assert(quiesce<stopping);
  state={Running:false,ExitCode:137,OOMKilled:false};await assert.rejects(()=>engine.stop(),/clean-stop/);
  const images=new Upgrade(base,{run:()=>JSON.stringify([{Id:ids.next,RepoDigests:[release.toImage]}])});assert.equal(images.image(release.toImage),ids.next);
  const wrong=new Upgrade(base,{run:()=>JSON.stringify([{Id:ids.next,RepoDigests:[]}])});assert.throws(()=>wrong.image(release.toImage),/pin-mismatch/);
  const candidate=new Upgrade(base,{run:()=>JSON.stringify([{Id:ids.next}]),imageIds:{[release.toImage]:ids.next}});assert.equal(candidate.image(release.toImage),ids.next,'Only the isolated adapter supplies archive-verified image IDs.');
  const running={Image:ids.next,State:{Status:'running',Running:true,ExitCode:0}};
  for(const reason of ['upgrade-persistent-mount-mismatch','upgrade-owned-gitlab-required']){
    const ready=new Upgrade(base,{sleep:async()=>{assert.fail('Identity failures must not retry.');}});
    ready.inspect=()=>running;ready.docker=()=> '';ready.preflight=async()=>{throw Error(reason);};
    await assert.rejects(()=>ready.ready(release.toVersion,ids.next),error=>error.message===reason);
  }
  for(const patch of [{version:release.fromVersion},{edition:'EE'}]){
    const ready=new Upgrade(base);ready.inspect=()=>running;ready.verifyMounts=()=>{};
    ready.docker=()=>JSON.stringify({version:release.toVersion,edition:'CE',runningJobs:0,unfinishedBackgroundMigrations:0,...patch});
    await assert.rejects(()=>ready.preflight(release.toVersion),error=>error.message==='upgrade-preflight-identity-mismatch'&&error.noRetry===true);
  }
  for(const [container,reason]of [
    [{...running,Image:ids.old},'upgrade-current-image-mismatch'],
    [{...running,State:{Status:'dead',Dead:true,ExitCode:137}},'upgrade-service-dead'],
    [{...running,State:{Status:'running',Running:true,OOMKilled:true,ExitCode:137}},'upgrade-service-oom'],
    [{...running,State:{Status:'exited',ExitCode:23},HostConfig:{RestartPolicy:{Name:'no'}}},'upgrade-service-exited'],
    [{...running,State:{Status:'exited',ExitCode:0},HostConfig:{RestartPolicy:{Name:'on-failure'}}},'upgrade-service-exited'],
    [{...running,State:{Status:'exited',ExitCode:23},RestartCount:3,HostConfig:{RestartPolicy:{Name:'on-failure',MaximumRetryCount:3}}},'upgrade-service-exited'],
    [{...running,State:{Status:'exited',ExitCode:23}},'upgrade-service-state-invalid']
  ]){
    let sleeps=0,commands=0;
    const ready=new Upgrade(base,{sleep:async()=>{sleeps++;},run:()=>{commands++;throw Error('must-not-execute');}});
    ready.inspect=()=>container;
    await assert.rejects(()=>ready.ready(release.toVersion,ids.next),error=>error.message===reason&&error.noRetry===true&&
      (container.State.ExitCode===undefined||['upgrade-current-image-mismatch','upgrade-service-state-invalid'].includes(reason)||error.exitCode===container.State.ExitCode));
    assert.equal(sleeps,0,'Terminal state must fail without waiting for the readiness deadline.');assert.equal(commands,0);
  }
  for(const container of [
    {...running,State:{Status:'created',Running:false}},
    {...running,State:{Status:'restarting',Running:false,Restarting:true}},
    ...['always','unless-stopped'].map(Name=>({...running,State:{Status:'exited',ExitCode:23},HostConfig:{RestartPolicy:{Name}}})),
    {...running,State:{Status:'exited',ExitCode:23},RestartCount:3,HostConfig:{RestartPolicy:{Name:'on-failure',MaximumRetryCount:0}}},
    {...running,State:{Status:'exited',ExitCode:23},RestartCount:2,HostConfig:{RestartPolicy:{Name:'on-failure',MaximumRetryCount:3}}}
  ]){
    let time=0,inspections=0,sleeps=0,current;
    const ready=new Upgrade(base,{now:()=>time,sleep:async ms=>{sleeps++;time+=ms;},run:(_binary,args)=>{
      if(!current.State.Running)throw Error('service-not-ready');
      return args.includes('db:migrate:status')?'up 123 fixture':'';
    }});
    ready.inspect=()=>{inspections++;current=inspections===1?container:running;return current;};ready.preflight=async()=>{};
    await ready.ready(release.toVersion,ids.next);assert.equal(inspections,2);assert.equal(sleeps,1);
  }
  for(const scenario of ['inspect-error','preflight-error','preflight-json','preflight-counts','rake-error','rake-output','probe-error','probe-output']){
    let sleeps=0;
    const failure=Object.assign(Error(scenario),{exitCode:23}),ready=new Upgrade(base,{sleep:async()=>{sleeps++;assert.fail('Command/output failures must not retry.');}});
    ready.inspect=()=>{if(scenario==='inspect-error')throw failure;return running;};ready.verifyMounts=()=>{};
    if(!['preflight-json','preflight-counts'].includes(scenario))ready.preflight=async()=>{if(scenario==='preflight-error')throw failure;};
    ready.docker=args=>{
      if(args.includes('curl')){
        if(scenario==='probe-error')throw failure;
        return scenario==='probe-output'?'unexpected-output':'';
      }
      if(args.includes('gitlab-rails'))return scenario==='preflight-json'?'not-json':JSON.stringify({version:release.toVersion,edition:'CE',runningJobs:0,unfinishedBackgroundMigrations:'0'});
      assert(args.includes('db:migrate:status'));
      if(scenario==='rake-error')throw failure;
      return scenario==='rake-output'?'invalid status output':'up 123 fixture';
    };
    await assert.rejects(()=>ready.ready(release.toVersion,ids.next),error=>{
      if(scenario.endsWith('-error'))assert.equal(error,failure);
      else if(scenario==='preflight-json')assert(error instanceof SyntaxError);
      else assert.equal(error.message,{'preflight-counts':'upgrade-preflight-refused','rake-output':'upgrade-migration-status-invalid','probe-output':'upgrade-readiness-response-invalid'}[scenario]);
      return true;
    });assert.equal(sleeps,0);
  }
  for(const scenario of ['http-pending','jobs-active','background-migrations','database-migrations']){
    let time=0,sleeps=0,preflights=0,rakes=0;
    const ready=new Upgrade(base,{now:()=>time,sleep:async ms=>{sleeps++;time+=ms;}});
    ready.inspect=()=>running;ready.verifyMounts=()=>{};
    ready.docker=args=>{
      if(args.includes('curl')){if(scenario==='http-pending'&&sleeps===0)throw Object.assign(Error('curl-not-ready'),{exitCode:22});return '';}
      if(args.includes('gitlab-rails')){preflights++;return JSON.stringify({version:release.toVersion,edition:'CE',
        runningJobs:scenario==='jobs-active'&&preflights===1?1:0,unfinishedBackgroundMigrations:scenario==='background-migrations'&&preflights===1?1:0});}
      assert(args.includes('db:migrate:status'));rakes++;
      return scenario==='database-migrations'&&rakes===1?'down 123 fixture':'up 123 fixture';
    };
    await ready.ready(release.toVersion,ids.next);assert.equal(sleeps,1,'Explicit startup/migration states remain retryable.');
  }
  const planEngine=new Upgrade(base);let entered=false,unlocked=false;
  planEngine.lock=()=>{};planEngine.unlock=()=>{unlocked=true;};planEngine.syncIdle=()=>{};planEngine.plan=async()=>({planSha256:'d'.repeat(64)});planEngine.migrate=async()=>{entered=true;};
  await assert.rejects(()=>planEngine.promote('e'.repeat(64)),/reviewed-plan/);assert(!entered);assert(unlocked);
  const {gitLabReadiness,controlGitLabServices}=require('../../operations/dist/gitlab-upgrade/service-control');
  for(const code of [0,7,22,28,52,56,2,127]){
    const port={command(args){assert(args.includes('curl')&&args.includes('--output')&&!args.includes('/bin/sh'));return run(process.execPath,['-e','process.exit('+code+')']);}};
    if([0,7,22,28,52,56].includes(code))assert.equal(await gitLabReadiness(port,'fixture'),code===0);
    else await assert.rejects(()=>gitLabReadiness(port,'fixture'),error=>error.exitCode===code);
  }
  for(const remaining of [0,-1,111]){
    await assert.rejects(()=>controlGitLabServices({uptime:()=>100,command(){assert.fail('Expired budget must never invoke timeout zero');}},'fixture','stop',110,['nginx'],{deadline:100+remaining}),/deadline-expired/);
  }
  console.log('PASS: approved CE pins, exact Cube/config edits, component cwd, private/checksummed checkpoints, clean-stop requirement and review-plan gate.');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
