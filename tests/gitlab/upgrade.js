'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Upgrade,release,options,imageAssignment,inventory,hash,atomic,run}=require('../../gitlab/upgrade');
const example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
const base={sourceRevision:'a'.repeat(40),evidence:'/state/evidence.json',stateDir:'/state',persistentDir:'/operator/platform',checkpointDir:'/state/gitlab-upgrades/test',readyTimeoutSeconds:600};
const ids={old:'sha256:'+'b'.repeat(64),next:'sha256:'+'c'.repeat(64)};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gitlab-upgrade-contract-'));
const isNativeProbe = args => ['dpkg-query','cat','mktemp','install','dd','env','rm','id','chown'].some(binary=>args.includes(binary));
function nativeProof(args, proof={}) {
  const value={version:release.toVersion,edition:'CE',runningJobs:0,unfinishedBackgroundMigrations:0,...proof};
  if(args.includes('dpkg-query'))return `gitlab-${value.edition.toLowerCase()}\t${value.version}-${value.edition.toLowerCase()}.0\tinstalled\n`;
  if(args.includes('/opt/gitlab/embedded/service/gitlab-rails/VERSION'))return value.version;
  if(args.includes('/var/opt/gitlab/gitlab-rails/etc/database.yml'))return value.topology??'production:\n  main: &db\n    adapter: postgresql\n    username: gitlab\n    database: gitlabhq_production\n    host: /var/opt/gitlab/postgresql\n  ci:\n    <<: *db\n    database_tasks: false\n';
  if(args.includes('/opt/gitlab/etc/gitlab-rails-rc'))return "gitlab_user='git'\n";
  if(args.includes('id'))return '991';
  if(args.includes('mktemp'))return '/tmp/system-bootstrapper-gitlab-probe.abcdefghij';
  if(['install','dd','rm','chown'].some(binary=>args.includes(binary)))return '';
  if(args.includes('/opt/gitlab/embedded/bin/psql'))return String(args.some(arg=>arg.includes('p_ci_builds'))?value.runningJobs:value.unfinishedBackgroundMigrations);
  throw Error('Unexpected native probe command');
}
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
  const running={Id:'a'.repeat(64),Image:ids.next,State:{Status:'running',Running:true,ExitCode:0}};
  for(const reason of ['upgrade-persistent-mount-mismatch','upgrade-owned-gitlab-required']){
    const ready=new Upgrade(base,{sleep:async()=>{assert.fail('Identity failures must not retry.');}});
    ready.inspect=()=>running;ready.docker=()=> '';ready.preflight=async()=>{throw Error(reason);};
    await assert.rejects(()=>ready.ready(release.toVersion,ids.next),error=>error.message===reason);
  }
  for(const patch of [{version:release.fromVersion},{edition:'EE'}]){
    const ready=new Upgrade(base);ready.inspect=()=>running;ready.verifyMounts=()=>{};
    ready.docker=args=>nativeProof(args,patch);
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
      if(isNativeProbe(args))return nativeProof(args,scenario==='preflight-json'?{topology:'production: ['}:{runningJobs:'invalid'});
      assert(args.includes('db:migrate:status'));
      if(scenario==='rake-error')throw failure;
      return scenario==='rake-output'?'invalid status output':'up 123 fixture';
    };
    await assert.rejects(()=>ready.ready(release.toVersion,ids.next),error=>{
      if(scenario.endsWith('-error'))assert.equal(error,failure);
      else if(scenario==='preflight-json')assert.equal(error.message,'gitlab-database-topology-invalid');
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
      if(isNativeProbe(args)){if(args.includes('dpkg-query'))preflights++;return nativeProof(args,{
        runningJobs:scenario==='jobs-active'&&preflights===1?1:0,unfinishedBackgroundMigrations:scenario==='background-migrations'&&preflights===1?1:0});}
      assert(args.includes('db:migrate:status'));rakes++;
      return scenario==='database-migrations'&&rakes===1?'down 123 fixture':'up 123 fixture';
    };
    await ready.ready(release.toVersion,ids.next);assert.equal(sleeps,1,'Explicit startup/migration states remain retryable.');
  }
  const {GitlabPreflightService}=require('../../operations/dist/gitlab-preflight/gitlab-preflight.service');
  const probe=new GitlabPreflightService(new (require('../../operations/dist/gitlab-preflight/gitlab-database.service').GitlabDatabaseService)()), probeCommands=[], probeInputs=[];
  const topology='production:\n  main: &db\n    adapter: postgresql\n    username: gitlab\n    database: main_data\n    host: /var/opt/gitlab/postgresql\n  ci:\n    <<: *db\n    database: ci_data\n    database_tasks: false\n';
  const proof=await probe.probe(running.Id,{command(args,timeout,input){
    if(input!==undefined)probeInputs.push(input);
    assert(args.includes(running.Id));assert.equal(timeout,60);assert(!args.includes('gitlab-rails')&&!args.includes('/bin/sh'));
    if(args.includes('/opt/gitlab/embedded/bin/psql')){probeCommands.push(args);assert(args.includes('--user')&&args[args.indexOf('--user')+1]==='991:991');assert(args.includes('env')&&args.includes('-i'));assert(args.includes('--no-password'));assert(args.includes('--set=ON_ERROR_STOP=1'));assert.match(args[args.indexOf('--command')+1],/^BEGIN READ ONLY; SELECT COUNT\(\*\)/);return args.some(value=>value.includes('p_ci_builds'))?'3':args.includes('service=database0')?'2':'4';}
    return nativeProof(args,{topology});
  }});
  assert.equal(proof.runningJobs,3);assert.equal(proof.unfinishedBackgroundMigrations,6);assert.equal(probeCommands.length,3);
  for(const args of probeCommands.filter(args=>!args.some(value=>value.includes('p_ci_builds'))))assert(args.some(value=>value.includes('status NOT IN (3, 6)')));
  const jobsQuery=probeCommands.find(args=>args.some(value=>value.includes('p_ci_builds')));assert(jobsQuery.includes('service=database1'));assert(probeInputs.some(value=>value.includes('dbname=main_data')&&value.includes('dbname=ci_data')&&value.includes('user=gitlab')));
  for(const term of ["type = 'Ci::Build'","'preparing'","'running'","'canceling'"])assert(jobsQuery.some(value=>value.includes(term)));
  for(const malformed of ['production: {}','production: <%= secret %>',topology.replace('adapter: postgresql','adapter: mysql'),topology.replace('database: ci_data','database: "x; SELECT secret"'),topology.replace('host: /var/opt/gitlab/postgresql','host: --option'),topology.replace('database: ci_data','database: ci_data\n    replica: true')]){
    await assert.rejects(()=>probe.probe(running.Id,{command:args=>nativeProof(args,{topology:malformed})}),/gitlab-database-topology-invalid/);
  }
  for(const invalid of ['-1','1.5','NaN','9007199254740992','0\nsecret'])await assert.rejects(()=>probe.probe(running.Id,{command:args=>nativeProof(args,{runningJobs:invalid})}),/upgrade-preflight-refused/);
  const secret=' private:token\\with-space ', tlsTopology=topology.replace('username: gitlab',`username: remote_user\n    password: ${JSON.stringify(secret)}\n    sslmode: verify-full\n    sslrootcert: /private/root.crt\n    sslcert: /private/client.crt\n    sslkey: /private/client.key`).replace('/var/opt/gitlab/postgresql','db.example.test');
  const database = new (require('../../operations/dist/gitlab-preflight/gitlab-database.service').GitlabDatabaseService)();
  const session = await database.open(running.Id, {command: args => nativeProof(args, {topology})});
  assert.equal(session.main, 0); assert.equal(session.ci, 1);
  const interactive = session.command(session.main, {interactive: true, applicationName: 'bootstrapper-lock:fixture'});
  assert.equal(interactive[1], '-i');
  assert(interactive.includes('service=database0 application_name=bootstrapper-lock:fixture'));
  assert(interactive.some(value => value.includes('default_transaction_read_only=on')));
  for (const options of [{applicationName: 'bad name'}, {readOnly: 'false'}, {interactive: 1}])
    assert.throws(() => session.command(0, options), /invalid/);
  assert.throws(() => session.command(99), /session-invalid/);
  await session.close(); await session.close();
  assert.throws(() => session.command(0), /session-invalid/);
  const sampler = new (require('../../operations/dist/gitlab-preflight/gitlab-data-sample.service').GitlabDataSampleService)(database);
  const sampled = {projects: [[1, 'team/full', 'a'.repeat(40)], [2, 'team/empty', null]], users: [[1, 'root']], issues: [[2, 1, 1]], mergeRequests: [[3, 1, 1]], registries: [[4, 1, '']]};
  let sampleClosed = false, sampleQueries = 0, sampleGets = [];
  const samplePort = {
    command(args) {
      if (args.includes('rm')) sampleClosed = true;
      if (args.includes('/opt/gitlab/embedded/bin/psql')) {
        sampleQueries++; const sql = args.at(-1);
        assert(sql.startsWith('BEGIN READ ONLY;')); assert(sql.includes('ORDER BY id LIMIT 10'));
        for (const [table, key] of [['projects','projects'],['users','users'],['issues','issues'],['merge_requests','mergeRequests'],['container_repositories','registries']])
          if (sql.includes('FROM public.' + table + ' ')) return JSON.stringify(key === 'projects' ? [[1],[2]] : sampled[key]);
        assert.fail('Unexpected sample query');
      }
      return nativeProof(args, {topology});
    },
    async get(route) {
      sampleGets.push(route);
      if (route === 'projects/1') return {id: 1, path_with_namespace: 'team/full', empty_repo: false};
      if (route === 'projects/2') return {id: 2, path_with_namespace: 'team/empty', empty_repo: true};
      assert.equal(route, 'projects/1/repository/commits/HEAD'); return {id: 'a'.repeat(40)};
    }
  };
  const dataProof = await sampler.sample(running.Id, samplePort);
  assert.equal(dataProof.sha256, require('crypto').createHash('sha256').update(JSON.stringify(sampled)).digest('hex'));
  assert.equal(dataProof.sampledProjects, 2); assert.equal(sampleQueries, 5); assert.equal(sampleGets.length, 3); assert(sampleClosed);
  sampleClosed = false;
  await assert.rejects(() => sampler.sample(running.Id, {...samplePort, get: async () => ({id: 999})}), /data-sample-unavailable/);
  assert(sampleClosed, 'Failed API evidence must close private DB session');
  const privateInputs=[], privateCommands=[];
  await probe.probe(running.Id,{command(args,timeout,input){privateCommands.push(args);if(input!==undefined)privateInputs.push(input);return nativeProof(args,{topology:tlsTopology});}});
  assert(privateInputs.some(value=>value.includes('sslmode=verify-full')&&value.includes('user=remote_user')&&value.includes('sslrootcert=/private/root.crt')&&value.includes('sslkey=/private/client.key')));
  assert(privateInputs.some(value=>value.includes(' private\\:token\\\\with-space ')));
  assert(!JSON.stringify(privateCommands).includes('private:token'));assert(privateCommands.at(-1).includes('rm'));
  let cleanedAfterFailure=false;await assert.rejects(()=>probe.probe(running.Id,{command(args){if(args.includes('rm'))cleanedAfterFailure=true;if(args.includes('/opt/gitlab/embedded/bin/psql'))throw Error('database-unavailable');return nativeProof(args,{topology:tlsTopology});}}),/database-unavailable/);assert(cleanedAfterFailure);
  const nativeProcess=require('../../operations/dist/runtime/process').nativeProcess, oldNativeRun=nativeProcess.run, oldStdout=process.stdout.write;let cliProof='';
  try {
    nativeProcess.run=(binary,args,options)=>{assert.equal(binary,'docker');if(args.includes('dd'))assert.equal(typeof options.input,'string','Public CLI must forward private stdin');return {stdout:nativeProof(args),stderr:'',status:0};};
    process.stdout.write=value=>{cliProof+=value;return true;};
    await require('../../operations/dist/gitlab-preflight/entry').main([running.Id]);
  } finally {nativeProcess.run=oldNativeRun;process.stdout.write=oldStdout;}
  assert.equal(JSON.parse(cliProof).version,release.toVersion);
  await assert.rejects(()=>probe.probe('system_gitlab_1',{command(){assert.fail('Mutable name must not execute');}}),/container-identity/);
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
