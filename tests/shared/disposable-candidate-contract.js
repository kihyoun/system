'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const os=require('os');
const {Candidate,configuration,signature,configurationValues,recover,LABEL}=require('./disposable-candidate');
// Git's committed LF bytes are the signed contract; Windows checkout conversion
// must not lead this fixture to rewrite or relax the Cube validator.
let example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
try {signature(example);} catch {
  example=require('child_process').execFileSync('git',['-c','core.autocrlf=false','show','HEAD:system/.docker.env.example'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'});
}
const hash='a'.repeat(64);
const spec={daemonImage:'docker:29-dind@sha256:'+hash,example,images:Object.fromEntries(
  ['candidate','wizard','gitlab','runner','nginx'].map(name=>[name,{id:'sha256:'+hash,archive:path.resolve(name+'.tar')}]))};
const config=configuration(example,{root:'root-secret',user:'test-user',password:'sync-secret'});
signature(config); assert.equal(config.slice(0,1184),example.slice(0,1184));
assert(config.includes('https://www.system-bootstrapper.com'));
assert.throws(()=>configuration(example.replace('https://www.system-bootstrapper.com','http://www.system-bootstrapper.com'),{}));
assert.throws(()=>new Candidate({...spec,daemonImage:'docker:latest'}));
assert.throws(()=>new Candidate({...spec,images:{}}));
for(const [options,budget]of [[{},1200000],[{acmeRenewalAcceptance:false},1200000],[{acmeRenewalAcceptance:true},1500000]]) {
  const bounded=new Candidate({...spec,...options},{now:()=>123});
  assert.equal(bounded.deadline,123+budget);
}
for(const quote of ['',"'",'"'])assert.deepEqual(configurationValues(`export SYNC_USER=${quote}fixture${quote}\nSYNC_PASS=${quote}password${quote}`,['SYNC_USER','SYNC_PASS']),{SYNC_USER:'fixture',SYNC_PASS:'password'});
const literalConfig="VALUE='literal=one=two $HOME'\nOTHER=\"escaped\\$HOME \\\"quote\\\" \\`tick\\`\"\nMULTILINE='first\nSYNC_USER=fake\nlast'\nSYNC_USER=actual\n";
const parsed=configurationValues(literalConfig,['VALUE','OTHER','MULTILINE','SYNC_USER']);
assert.equal(parsed.VALUE,'literal=one=two $HOME');assert.equal(parsed.SYNC_USER,'actual');
const native=require('child_process').execFileSync('bash',['-s'],{input:literalConfig+"printf '%s\\0' \"$VALUE\" \"$OTHER\" \"$MULTILINE\" \"$SYNC_USER\"\n",encoding:'utf8',timeout:2000}).split('\0').slice(0,-1);
assert.deepEqual(Object.values(parsed),native);
for(const text of ['VALUE=$(touch /should-not-run)','VALUE=$HOME','VALUE=$[1+2]','VALUE="$[1+2]"','VALUE=$','VALUE=`id`','VALUE="unterminated','VALUE=first\nVALUE=second','OTHER=missing'])assert.throws(()=>configurationValues(text,['VALUE']));

function fixture() {
  const commands=[]; const records=new Map(); let instance; let clock=0; let failRemoval=false; let offline=false;
  const run=(args,options)=>{
    commands.push({args,options});
    if(offline) throw new Error('secret-daemon-message');
    const [kind,verb]=args;
    if(['network','volume'].includes(kind) && verb==='create' || kind==='create') {
      const actualKind=kind==='create'?'container':kind;
      const id=actualKind==='volume'?instance.name: (actualKind==='network'?'b':'c').repeat(64);
      records.set(id,{kind:actualKind,Id:id,Name:actualKind==='container'?'/'+instance.name:instance.name,Labels:{[LABEL]:instance.id}}); return id;
    }
    if(verb==='ls') return [...records.values()].filter(x=>x.kind===kind).map(x=>JSON.stringify(kind==='volume'?{Name:x.Name}:{ID:x.Id.slice(0,12),Name:x.Name,Names:x.Name.replace(/^\//,'')})).join('\n');
    if(verb==='inspect') return JSON.stringify([[...records.values()].find(x=>x.kind===kind && (x.Id===args[2] || x.Name===args[2] || x.Name==='/'+args[2]))]);
    if(verb==='rm') {if(failRemoval) throw new Error('remove failed'); records.delete(args.at(-1));return '';}
    if(kind==='inspect') return JSON.stringify({'80/tcp':[{HostIp:'127.0.0.1',HostPort:'49152'}]});
    if(kind==='exec' && args.includes('inspect') && args.includes('{{.Id}}')) return 'sha256:'+hash;
    return '';
  };
  instance=new Candidate(spec,{docker:run,now:()=>clock,sleep:async ms=>{clock+=ms;},request:async(url,options)=>{
    if(url.endsWith('/login')) {assert.equal(JSON.parse(options.body).password,instance.secrets.password);return {status:200,body:'{"accessToken":"private-token"}'};}
    if(url.endsWith('/config/main')) {assert.equal(options.headers.Authorization,'Bearer private-token');return {status:200,body:JSON.stringify({data:configuration(example,instance.secrets)})};}
    return {status:200,body:'<html>candidate</html>'};
  }});
  return {instance,commands,records,failRemoval:()=>{failRemoval=true;},offline:()=>{offline=true;}};
}
(async()=>{
  for(const quoted of [false,true]) {
    const serialized=fixture();const previous=serialized.instance.request;
    serialized.instance.request=async(url,options)=>{
      if(url.endsWith('/config/main')) {
        let text=configuration(example,serialized.instance.secrets);
        if(quoted)for(const [key,value]of [['SYNC_USER',serialized.instance.secrets.user],['SYNC_PASS',serialized.instance.secrets.password]])text=text.replace(key+'='+value,key+'="'+value+'"');
        return {status:200,body:JSON.stringify({data:text})};
      }
      return previous(url,options);
    };
    await serialized.instance.smoke();
  }
  const wrong=fixture(),originalRequest=wrong.instance.request;
  wrong.instance.request=async(url,options)=>url.endsWith('/config/main')?
    {status:200,body:JSON.stringify({data:configuration(example,wrong.instance.secrets).replace('SYNC_PASS='+wrong.instance.secrets.password,'SYNC_PASS='+wrong.instance.secrets.password+'suffix')})}:
    originalRequest(url,options);
  await assert.rejects(wrong.instance.smoke(),/configuration-round-trip-mismatch/);
  const streams=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-stream-'));
  const previousPath=process.env.PATH;
  try {
    fs.writeFileSync(path.join(streams,'docker'),'#!/bin/sh\ncat\n',{mode:0o755});
    const bytes=Buffer.from([0,255,13,10,128,0,1]);
    const input=path.join(streams,'input'),output=path.join(streams,'output');fs.writeFileSync(input,bytes);
    process.env.PATH=streams+path.delimiter+previousPath;
    const streamed=new Candidate(spec);
    assert.equal(streamed.exec(['fake-stream'],{inputFile:input,outputFile:output,timeout:2000}),'');
    assert(fs.readFileSync(output).equals(bytes),'Streaming preserves binary bytes without buffering stdout.');
    assert.equal(fs.statSync(output).mode&0o777,0o600);
    assert.throws(()=>streamed.exec(['fake-stream'],{inputFile:input,outputFile:output}),/EEXIST/);
    fs.writeFileSync(path.join(streams,'docker'),'#!/bin/sh\nprintf "%s\\n" "Fixed fixture failure" "secret-fixture-token" >&2\nexit 7\n',{mode:0o755});
    assert.throws(()=>streamed.exec(['exec'],{failureCodes:{'Fixed fixture failure':'configuration-round-trip-mismatch'},timeout:2000}),error=>{
      assert.equal(error.message,'configuration-round-trip-mismatch');assert.equal(error.exitCode,7);
      assert(!JSON.stringify(error).includes('secret-fixture-token'));return true;
    });
    for(const failureCodes of [{'Fixed fixture failure':'secret-fixture-token'},{'fixture failure':'configuration-round-trip-mismatch'}]) {
      assert.throws(()=>streamed.exec(['exec'],{failureCodes,timeout:2000}),error=>error.message==='docker-exec-failed'&&error.exitCode===7);
    }
    fs.writeFileSync(path.join(streams,'docker'),'#!/bin/sh\nexec sleep 2\n',{mode:0o755});
    await assert.rejects(streamed.stage('recovery-completed-cold-seed',async()=>streamed.exec(['exec'],{timeout:30})));
    assert.equal(streamed.results.at(-1).systemCode,'ETIMEDOUT');
    assert.equal(streamed.results.at(-1).exitCode,undefined);
  } finally {process.env.PATH=previousPath;fs.rmSync(streams,{recursive:true,force:true});}
  const routed=fixture();
  routed.instance.inner=async(args,options)=>{
    if(args[0]==='inspect'){assert(args.includes('{{json .NetworkSettings.Networks}}'));return JSON.stringify({bridge:{Gateway:'172.17.0.1'}});}
    const input=JSON.parse(options.input);
    assert.equal(input.url,'http://172.17.0.1/api/v4/pipelines?ref=main');
    return JSON.stringify({status:200,body:'[]'});
  };
  assert.equal((await routed.instance.httpFromCandidate('http://candidate.invalid/api/v4/pipelines?ref=main')).status,200);
  const http=require('http');
  const server=http.createServer((request,response)=>{
    response.statusCode=request.headers.host==='wizard.candidate.test' && request.url==='/probe?ref=main'?200:421;
    response.end('<html>private transport probe</html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const actual=fixture();
    actual.instance.inner=async(args,options)=>{
      if(args[0]==='inspect')return JSON.stringify({bridge:{Gateway:'127.0.0.1'}});
      const input=JSON.parse(options.input);input.url=input.url.replace('127.0.0.1','127.0.0.1:'+server.address().port);
      return await new Promise((resolve,reject)=>{
        const child=require('child_process').spawn(process.execPath,['-e',args.at(-1)],{stdio:['pipe','pipe','ignore']});
        let output='';child.stdout.on('data',chunk=>output+=chunk);child.once('error',reject);
        child.once('exit',code=>code===0?resolve(output):reject(Error('private-http-transport-failed')));
        child.stdin.end(JSON.stringify(input));
      });
    };
    assert.equal((await actual.instance.httpFromCandidate('http://candidate.invalid/probe?ref=main',{headers:{Host:'wizard.candidate.test'}})).status,200,
      'The actual Node transport must preserve the NGINX virtual Host header.');
  } finally {await new Promise(resolve=>server.close(resolve));}
  const diagnostic=require('./job-diagnostics');
  const trace='$ docker build --network none -t private-image .\n$ printf secret-fixture-token | docker login registry.test --password-stdin\nhttp: server gave HTTP response to HTTPS client\nERROR: Job failed: exit code 1\n';
  const classified=diagnostic.classify(trace);
  assert.deepEqual(classified,{commands:['build','login'],codes:['registry-protocol'],exitCode:1});
  assert(!JSON.stringify(classified).includes('secret-fixture-token'));
  assert.deepEqual(diagnostic.sanitize({...classified,private:'secret-fixture-token',codes:['registry-protocol','secret-fixture-token']}),classified);
  assert.deepEqual(diagnostic.classify('x'.repeat(524289)),{codes:['trace-unavailable']});
  assert.deepEqual(diagnostic.classify('ERROR: Job failed (system failure): the configured PullPolicies ([never]) are not allowed by AllowedPullPolicies ([always])'),{commands:[],codes:['runner-pull-policy']});
  assert.equal(diagnostic.failureReason('runner_configuration_error'),'runner_configuration_error');
  assert.equal(diagnostic.failureReason('secret-fixture-token'),undefined);
  const failing=fixture().instance;
  const policyDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-runner-policy-'));
  const policyFile=path.join(policyDirectory,'runners/runner/1/config/config.toml');
  fs.mkdirSync(path.dirname(policyFile),{recursive:true});
  fs.writeFileSync(policyFile,'[[runners]]\r\n  token = "secret-fixture-token"\r\n  [runners.docker]\r\n    image = "alpine"\r\n');
  failing.spec={...spec,supportImages:{helper:{}},restore:{base:policyDirectory}};
  const policyTransport=failing.inner.bind(failing);
  failing.inner=async(args,options)=>{
    if(args.includes('node')&&args.includes('-e'))return require('child_process').execFileSync(process.execPath,['-e',args.at(-1)],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    return policyTransport(args,options);
  };
  failing.rails=async()=>({token:'secret-fixture-token',pools:1,active_setup:0});
  failing.stage=async(name,action)=>{if(name==='gitlab-and-runner-ready')return;return action();};
  failing.wait=async action=>{if(!await action())throw Error('fixture-wait-failed');};
  let createdProjects=0;
  failing.api=async(route)=>{
    if(route==='/projects'){createdProjects++;return {id:2,default_branch:'main'};}
    if(route.endsWith('/pipelines'))return [{id:3,status:'failed'}];
    if(route.endsWith('/jobs'))return [{id:4,name:'registry-round-trip',status:'failed',runner:{id:1},failure_reason:'runner_configuration_error'}];
    if(route.endsWith('/trace'))return trace;
    return null;
  };
  failing.request=async()=>({status:401});
  try {
    await assert.rejects(failing.platform(),/candidate-pipeline-failed/);
    assert(fs.readFileSync(policyFile,'utf8').includes('allowed_pull_policies = ["never", "if-not-present"]'));
    assert.deepEqual(failing.evidence.jobs[0].diagnostics,classified);
    assert.equal(failing.evidence.jobs[0].failureReason,'runner_configuration_error');
    fs.writeFileSync(policyFile,'[[runners]]\n  token = "secret-fixture-token"\n');
    await assert.rejects(failing.platform());
    assert.equal(createdProjects,1,'A missing real Docker TOML section must fail before creating any CI project.');
  } finally {fs.rmSync(policyDirectory,{recursive:true,force:true});}
  const test=fixture(); await test.instance.start(); await test.instance.smoke();
  const creation=test.commands.find(x=>x.args[0]==='create').args;
  assert(creation.includes('--privileged')); assert(!creation.includes('--publish'));
  assert(creation.some((value,index)=>value==='--insecure-registry'&&creation[index+1]==='registry.candidate.test'));
  assert(creation.some((value,index)=>value==='--insecure-registry'&&creation[index+1]==='registry.candidate.test:5050'));
  assert.equal(test.instance.url,'http://candidate.invalid');
  assert(!creation.some(x=>x.includes('docker.sock:') || x.includes('source=/var/run'))); assert(!creation.includes('--network=host'));
  assert(test.commands.find(x=>x.args[0]==='network' && x.args[1]==='create').args.includes('--internal'));
  assert.equal(test.commands.filter(x=>x.args.includes('load')).length,5);
  assert(test.commands.filter(x=>x.args.includes('load')).every(x=>path.isAbsolute(x.options.inputFile)));
  assert(test.commands.some(x=>x.args.includes('COMPOSE_COMPATIBILITY=1')));
  const bootstrap=test.commands.find(x=>x.args.includes('SYSTEM_CONFIG_DIR=/state')).args;
  assert(bootstrap.includes('PERSISTENT_DIR=/candidate-data/platform'));
  assert(bootstrap.includes('system_configuration:/state'));
  assert(bootstrap.includes('/candidate-data/platform/runners:/candidate-data/platform/runners'));
  assert(test.commands.some(x=>x.args.includes('device=/candidate-data/platform/gitlab/data')));
  assert.equal(test.instance.cleanup(),true); assert.equal(test.records.size,0);
  assert(test.commands.some(x=>x.args[0]==='container' && x.args[1]==='ls' && x.args.includes('--all')));
  assert.equal(test.instance.cleanup(),true); // confirmed absent resources
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-report-'));
  try {
    test.instance.report(output);
    const report=fs.readFileSync(path.join(output,'results.json'),'utf8');
    for(const secret of [...Object.values(test.instance.secrets),'private-token','secret-daemon-message']) assert(!report.includes(secret));
    assert(fs.readFileSync(path.join(output,'junit.xml'),'utf8').includes('authenticated-fetch'));
  } finally {fs.rmSync(output,{recursive:true,force:true});}
  const foreign=fixture(); await foreign.instance.start();
  foreign.records.get(foreign.instance.daemon).Labels[LABEL]='another-run';
  assert.equal(foreign.instance.cleanup(),false); assert.equal(foreign.records.size,3);
  assert.throws(()=>recover({runId:'bad',resources:[]}));
  const recovered=recover({runId:test.instance.id,resources:test.instance.resources,results:[{name:'authenticated-fetch',status:'failed',private:'must-not-copy'}]},()=>{throw new Error('offline');});
  assert.equal(recovered.cleanup(),false);
  assert.deepEqual(recovered.results[0],{name:'authenticated-fetch',status:'failed'});
  const errors=fixture();
  await assert.rejects(errors.instance.stage('recovery-acme-tls-and-config',async()=>{throw Error('restored-runtime-configuration-mismatch');}));
  await assert.rejects(errors.instance.stage('authenticated-fetch',async()=>{throw Error('secret-fixture-token');}));
  const sanitized=recover({runId:errors.instance.id,resources:[],results:errors.instance.results});
  assert.deepEqual(sanitized.results.map(item=>item.reason),['restored-runtime-configuration-mismatch','stage-error']);
  const twice=recover({runId:errors.instance.id,resources:[],results:sanitized.results});
  assert.deepEqual(twice.results,sanitized.results); // Independent after_script retries retain diagnostic identity.
  assert(!JSON.stringify(twice.results).includes('secret-fixture-token'));
  assert.equal(recover({runId:errors.instance.id,resources:[],results:[{name:'authenticated-fetch',status:'failed',reason:'secret-fixture-token'}]}).results[0].reason,'stage-error');
  const status=fixture();
  await assert.rejects(status.instance.stage('recovery-completed-cold-seed',async()=>{throw Object.assign(Error('docker-exec-failed'),{exitCode:7,systemCode:'ETIMEDOUT',private:'secret-fixture-token'});}));
  assert.equal(status.instance.results[0].exitCode,7);assert.equal(status.instance.results[0].systemCode,'ETIMEDOUT');
  const resumedStatus=recover({runId:status.instance.id,resources:[],results:status.instance.results});
  const repeatedStatus=recover({runId:status.instance.id,resources:[],results:resumedStatus.results});
  assert.deepEqual(repeatedStatus.results,status.instance.results);
  assert(!JSON.stringify(repeatedStatus.results).includes('secret-fixture-token'));
  for(const exitCode of [-1,256,'secret-fixture-token']) {
    const unsafeStatus=recover({runId:status.instance.id,resources:[],results:[{name:'cleanup',status:'failed',exitCode,systemCode:'secret-fixture-token'}]});
    assert.deepEqual(unsafeStatus.results,[{name:'cleanup',status:'failed'}]);
  }
  const fullReceipt={runId:test.instance.id,resources:test.instance.resources,startedAt:'2026-10-18T00:00:00Z',
    images:{candidate:'sha256:'+hash},daemonImage:spec.daemonImage,fullAcceptance:true,
    results:[{name:'registry-build-push-pull-run',status:'passed',milliseconds:123,private:'never retain'}],
    evidence:{projectId:1,pipelineId:2,private:'never retain',jobs:[{id:3,name:'registry-round-trip',status:'success',runnerId:4,duration:5,private:'never retain'}]}};
  const fullRecovery=recover(fullReceipt,()=>{throw Error('offline');});
  assert.equal(fullRecovery.spec.fullAcceptance,true);
  assert.equal(fullRecovery.spec.images.candidate.id,'sha256:'+hash);
  assert.equal(fullRecovery.results[0].name,'registry-build-push-pull-run');
  assert.equal(fullRecovery.results[0].milliseconds,123);
  const durable=recover({...fullReceipt,evidence:{jobs:[{id:3,name:'registry-round-trip',status:'failed',diagnostics:{...classified,private:'secret-fixture-token'}}],
    recovery:{runId:'a'.repeat(24),backupOnly:true,originalHostRemoved:true,syntheticTlsVerified:true,acmeRenewalVerified:false,privateWizardPinVerified:false,private:'secret-fixture-token'}}});
  assert.deepEqual(durable.evidence.jobs[0].diagnostics,classified);
  assert.deepEqual(durable.evidence.recovery,{runId:'a'.repeat(24),backupOnly:true,originalHostRemoved:true,syntheticTlsVerified:true,acmeRenewalVerified:false,privateWizardPinVerified:false});
  assert(!JSON.stringify(durable.evidence).includes('secret-fixture-token'));
  assert.deepEqual(fullRecovery.evidence,{projectId:1,pipelineId:2,jobs:[{id:3,name:'registry-round-trip',status:'success',runnerId:4,duration:5}]});
  assert(!JSON.stringify(fullRecovery).includes('never retain'));

  const failure=fixture(); await failure.instance.start(); failure.failRemoval(); assert.equal(failure.instance.cleanup(),false);
  const broken=fixture(); await broken.instance.start(); broken.offline(); assert.equal(broken.instance.cleanup(),false);
  const pending=fixture(); await pending.instance.start();
  pending.instance.resources.at(-1).id=null; // server created it, response/receipt ID was interrupted
  assert.equal(pending.instance.cleanup(),true); assert.equal(pending.records.size,0);
  const foreignPending=fixture(); await foreignPending.instance.start();
  foreignPending.instance.resources.at(-1).id=null;
  foreignPending.records.get(foreignPending.instance.daemon).Labels[LABEL]='foreign';
  assert.equal(foreignPending.instance.cleanup(),false); assert.equal(foreignPending.records.size,3);
  const badImage=fixture();
  const base=badImage.instance.exec;
  badImage.instance.exec=(args,options)=>args.includes('{{.Id}}')?'sha256:'+'d'.repeat(64):base(args,options);
  await assert.rejects(()=>badImage.instance.start(),/image-identity-mismatch/);
  assert.equal(badImage.instance.cleanup(),true);
  const denied=fixture(); await denied.instance.start(); denied.instance.spec={...spec,readinessMilliseconds:1000};
  denied.instance.request=async()=>({status:403,body:'private-error'});
  await assert.rejects(()=>denied.instance.smoke(),/readiness-timeout/); assert.equal(denied.instance.cleanup(),true);
  const badFetch=fixture(); await badFetch.instance.start(); const request=badFetch.instance.request;
  badFetch.instance.request=async(url,options)=>url.endsWith('/config/main')?{status:200,body:'{"data":"wrong Cube"}'}:request(url,options);
  await assert.rejects(()=>badFetch.instance.smoke(),/invalid-cube-signature/); assert.equal(badFetch.instance.cleanup(),true);
  const timed=fixture(); await assert.rejects(()=>timed.instance.wait(()=>false,2000),/readiness-timeout/);
  const canceled=fixture(); canceled.instance.canceled=true; await assert.rejects(()=>canceled.instance.start());

  // Actual child exit during a partial write must leave the old receipt intact.
  // process.exit bypasses finally, unlike an ordinary injected JS exception.
  const journal=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-journal-'));
  try {
    test.instance.report(journal);
    const filename=path.join(journal,'results.json');
    const previous=fs.readFileSync(filename,'utf8');
    const child="const fs=require('fs');const {atomicReplace}=require(process.argv[1]);atomicReplace(process.argv[2],'new receipt',{...fs,writeFileSync(fd){fs.writeFileSync(fd,'{');process.exit(23);}});";
    assert.throws(()=>require('child_process').execFileSync(process.execPath,['-e',child,require.resolve('./disposable-candidate'),filename],{stdio:'pipe'}),error=>error.status===23);
    assert.equal(fs.readFileSync(filename,'utf8'),previous);
    assert.equal(JSON.parse(fs.readFileSync(filename,'utf8')).runId,test.instance.id);
    assert(fs.readdirSync(journal).some(name=>name.endsWith('.tmp')));

    // The server has created the daemon but persisting its full ID fails.
    // The previous complete checkpoint still contains its unique pending name.
    const interrupted=fixture(); let failedCheckpoint=false;
    interrupted.instance.checkpoint=instance=>{
      const shouldFail=instance.resources.some(item=>item.kind==='container' && item.id!==null);
      const io=shouldFail ? {...fs,writeFileSync(fd){failedCheckpoint=true;fs.writeFileSync(fd,'{');throw new Error('disk-full');}} : fs;
      instance.report(journal,io);
    };
    await assert.rejects(()=>interrupted.instance.start(),/disk-full/);
    assert(failedCheckpoint); assert.equal(interrupted.records.size,3);
    const receipt=JSON.parse(fs.readFileSync(filename,'utf8'));
    assert.equal(receipt.runId,interrupted.instance.id);
    assert.equal(receipt.resources.at(-1).kind,'container'); assert.equal(receipt.resources.at(-1).id,null);
    const resumed=recover(receipt,interrupted.instance.exec);
    assert.equal(resumed.cleanup(),true); assert.equal(interrupted.records.size,0);
  } finally {fs.rmSync(journal,{recursive:true,force:true});}

  // Linux persistence order includes the entire report-directory ancestry,
  // including existing parents, plus each renamed receipt.
  // Injected IO keeps this deterministic on Windows without filesystem writes.
  const durableRoot=path.resolve(os.tmpdir(),'candidate-virtual-root');
  const firstDirectory=path.join(durableRoot,'new');
  const reportDirectory=path.join(firstDirectory,'e2e','run');
  const events=[]; let nextDescriptor=0;
  const handles=new Map();
  const orderedIo={
    mkdirSync(directory){events.push(['mkdir',directory]);return firstDirectory;},
    openSync(filename,flags){const fd=++nextDescriptor;handles.set(fd,{filename,flags});events.push(['open',filename,flags]);return fd;},
    writeFileSync(fd){events.push(['write',handles.get(fd).filename]);},
    fsyncSync(fd){events.push(['sync',handles.get(fd).filename]);},
    closeSync(fd){events.push(['close',handles.get(fd).filename]);},
    renameSync(from,to){events.push(['rename',from,to]);},
    unlinkSync(){throw Object.assign(new Error('absent'),{code:'ENOENT'});}
  };
  test.instance.report(reportDirectory,orderedIo,'linux');
  const directories=[];
  for(let current=reportDirectory;;current=path.dirname(current)) {
    directories.push(current); if(current===path.dirname(current)) break;
  }
  const expectedFirstFile=1+directories.length*3;
  assert.deepEqual(events.slice(1,expectedFirstFile),directories.flatMap(directory=>[
    ['open',directory,'r'],['sync',directory],['close',directory]
  ]));
  // Explicitly assert each complete atomic replacement, independent of random
  // temporary names: data -> file fsync/close -> rename -> directory fsync/close.
  const firstFile=events.findIndex(event=>event[0]==='open' && event[2]==='wx');
  assert.equal(firstFile,expectedFirstFile);
  for(const offset of [firstFile,firstFile+8]) {
    const filename=events[offset][1];
    const target=events[offset+4][2];
    assert.deepEqual(events.slice(offset,offset+8),[
      ['open',filename,'wx'],['write',filename],['sync',filename],['close',filename],
      ['rename',filename,target],['open',reportDirectory,'r'],['sync',reportDirectory],['close',reportDirectory]
    ]);
  }
  assert.equal(events[firstFile+4][2],path.join(reportDirectory,'results.json'));
  assert.equal(events[firstFile+12][2],path.join(reportDirectory,'junit.xml'));
  const failedSync=fixture(); let dockerActions=0;
  failedSync.instance.exec=()=>{dockerActions++;throw new Error('must-not-create');};
  failedSync.instance.checkpoint=instance=>instance.report(reportDirectory,
    {...orderedIo,fsyncSync(){throw new Error('directory-sync-failed');}},'linux');
  await assert.rejects(()=>failedSync.instance.start(),/directory-sync-failed/);
  assert.equal(dockerActions,0,'An undurable directory checkpoint must precede no Docker creation');
  const failedRenameSync=fixture();
  failedRenameSync.instance.exec=()=>{dockerActions++;throw new Error('must-not-create');};
  failedRenameSync.instance.checkpoint=instance=>instance.report(reportDirectory,
    {...orderedIo,mkdirSync(){return undefined;},fsyncSync(fd){
      if(handles.get(fd).flags==='r' && events.at(-2)?.[0]==='rename') throw new Error('rename-directory-sync-failed');
    }},'linux');
  await assert.rejects(()=>failedRenameSync.instance.start(),/rename-directory-sync-failed/);
  assert.equal(dockerActions,0,'A failed post-rename directory sync must block Docker creation');
  const retryOffset=events.length;
  test.instance.report(reportDirectory,{...orderedIo,mkdirSync(){events.push(['mkdir-existing']);return undefined;}},'linux');
  assert.deepEqual(events.slice(retryOffset+1,retryOffset+expectedFirstFile),directories.flatMap(directory=>[
    ['open',directory,'r'],['sync',directory],['close',directory]
  ]),'Retry must synchronize existing ancestors left by an interrupted directory creation');
  const windowsEvents=[];
  test.instance.report(reportDirectory,{...orderedIo,openSync(filename,flags){
    windowsEvents.push(flags); return orderedIo.openSync(filename,flags);
  }},'win32');
  assert.deepEqual(windowsEvents,['wx','wx'],'Windows must not pretend to fsync directory entries');

  // A macrotask-delivered signal after a successful synchronous copy must be
  // processed BEFORE the following load, not after all five image operations.
  const signaled=fixture(); const transport=signaled.instance.exec;
  const signalHandler=()=>{signaled.instance.canceled=true;};
  process.once('SIGTERM',signalHandler);
  signaled.instance.exec=(args,options)=>{
    const result=transport(args,options);
    if(args.includes('load')) setImmediate(()=>process.emit('SIGTERM'));
    return result;
  };
  try {
    await assert.rejects(()=>signaled.instance.start(),/canceled-or-overall-timeout/);
    assert.equal(signaled.instance.canceled,true);
    assert.equal(signaled.commands.filter(item=>item.args[0]==='cp').length,0);
    assert.equal(signaled.commands.filter(item=>item.args.includes('load')).length,1);
    assert.equal(signaled.instance.cleanup(),true); assert.equal(signaled.records.size,0);
  } finally {process.removeListener('SIGTERM',signalHandler);}
  console.log('Disposable candidate offline contracts passed; no Docker or live HTTP used.');
})().catch(error=>{console.error(error);process.exitCode=1;});
