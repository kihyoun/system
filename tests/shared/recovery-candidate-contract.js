'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {test}=require('node:test');
const recovery=require('../e2e/recovery');
const storageFixture={prepareLocal:async()=>{},attach:async()=>{},refuseInvalidRestore:async()=>{},detach:async()=>{}};

function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-adapter-contract-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const configArchive=path.join(directory,'bootstrapper.zip'),seedArchive=path.join(directory,'seed.tgz');
  fs.writeFileSync(configArchive,Buffer.from([0,255,17,128,10]),{mode:0o600});
  fs.writeFileSync(seedArchive,Buffer.from([17,0,128,33]),{mode:0o600});
  return {directory,configArchive,seedArchive,configHash:recovery.hashFile(configArchive),seedHash:recovery.hashFile(seedArchive),base:recovery.BASE,seed:recovery.SEED,expected:{}};
}
function original() {
  const events=[];
  return {id:'a'.repeat(24),deadline:12345,spec:{images:{}},secrets:{user:'oracle-only',password:'private-oracle'},evidence:{},events,canceled:false,
    stage:async(name,action)=>{events.push(name);return action();},
    cleanup(){events.push('original-cleanup');this.removed=true;return true;}};
}
function privateFixture(){
  const images={wizard:{id:'sha256:'+'b'.repeat(64)},candidate:{id:'sha256:'+'c'.repeat(64)}};
  const expected={projectId:12,projectPath:'root/wizard',imageDigest:'sha256:'+'d'.repeat(64),imageId:'sha256:'+'e'.repeat(64),
    sourceImageId:images.wizard.id,marker:'a'.repeat(24),markerPath:'/opt/system-bootstrapper/private-recovery-proof',pipelineId:21,jobId:31};
  expected.imageRef='registry.candidate.test:5050/root/wizard/recovery-wizard@'+expected.imageDigest;
  return {images,expected};
}
function privateNativeFixture(){
  const {images}=privateFixture(),expected={kind:'source-primary-native-v1',projectId:12,projectPath:'team/native-source',registryHost:'registry.candidate.test:5050',
    imageDigest:'sha256:'+'d'.repeat(64),imageId:'sha256:'+'e'.repeat(64),sourceCommit:'f'.repeat(40),pipelineId:21,jobId:31,runnerId:41};
  expected.imageRef=expected.registryHost+'/'+expected.projectPath+'@'+expected.imageDigest;
  return {images,expected};
}
function dependencies(first,input,options={}) {
  const events=first.events;
  class FakeCandidate {
    constructor(spec){this.spec=spec;this.id='b'.repeat(24);FakeCandidate.instance=this;events.push('new-host-created');}
    report(){events.push('new-host-receipt');}
    async start(){assert(first.removed,'old daemon must be removed before fresh daemon startup');events.push('new-host-started');if(options.failStart)throw Error('new-start-failed');}
    async platform(){events.push('new-host-ci-registry');if(options.cancelDuringPlatform){first.canceled=true;assert.equal(this.canceled,true);throw Error('canceled');}}
    cleanup(){events.push('new-host-cleanup');return !options.failCleanup;}
  }
  return {Candidate:FakeCandidate,capture:async()=>{events.push('backups-captured');return input;},
    verifyRestore:async()=>events.push('identity-and-tls-verified'),verifyRegistryBlob:async()=>events.push('old-registry-blob-verified')};
}

test('recovery removes original host before starting fresh host, preserves budget and records only safe evidence',async t=>{
  const input=fixture(t),first=original(),deps=dependencies(first,input);
  await recovery.run(first,()=>'/unused',deps);
  const second=deps.Candidate.instance;
  assert.equal(second.deadline,first.deadline);
  assert.equal(second.spec.restore,input);
  assert.equal(second.secrets.password,first.secrets.password,'expected credentials are a verification oracle');
  assert(first.events.indexOf('original-cleanup')<first.events.indexOf('new-host-started'));
  assert(first.events.indexOf('identity-and-tls-verified')<first.events.indexOf('new-host-ci-registry'));
  assert(first.events.indexOf('new-host-ci-registry')<first.events.indexOf('old-registry-blob-verified'));
  assert.equal(first.evidence.recovery.backupOnly,true);
  assert.equal(first.evidence.recovery.acmeRenewalVerified,false);
  assert(!JSON.stringify(first.evidence).includes(first.secrets.password));
  assert(!fs.existsSync(input.directory),'private archives removed only after cleanup');
});

test('failed original-host removal prevents a second daemon',async t=>{
  const input=fixture(t),first=original(),deps=dependencies(first,input);
  first.cleanup=()=>false;
  await assert.rejects(()=>recovery.run(first,()=>'/unused',deps),/original-host-cleanup-failed/);
  assert(!first.events.includes('new-host-created'));
});

for(const [budget,guided]of [[3600000,false],[4500000,true]])test(`upgrade recovery preserves its shared ${budget/60000}-minute deadline`,async t=>{
  const {Candidate}=require('./disposable-candidate');
  const input=fixture(t),first=original(),deps=dependencies(first,input),calls=[];
  first.startedAt=1000;first.deadline=first.startedAt+budget;
  first.spec.gitlabUpgradeAcceptance=true;
  first.spec.guidedPreviewAcceptance=guided;
  let now=first.deadline-25*60000;
  deps.Candidate.prototype.start=async function(){
    assert(first.removed);
    assert.equal(this.deadline,first.deadline,'fresh host must inherit the original absolute end');
    this.now=()=>now;this.exec=(args,options)=>{calls.push({args,options});return '';};
    await Candidate.prototype.call.call(this,['fixture-operation'],{timeout:30*60000});
    assert.equal(calls.at(-1).options.timeout,25*60000,
      'time spent on the removed host is unavailable to the fresh host');
    now=first.deadline+1;
    await assert.rejects(()=>Candidate.prototype.call.call(this,['fixture-after-expiry']),/canceled-or-overall-timeout/);
    assert.equal(calls.length,1,'no command may reset or outlive the shared deadline');
    throw Error('fixture-deadline-observed');
  };
  await assert.rejects(()=>recovery.run(first,()=>'/unused',deps),/fixture-deadline-observed/);
  assert(first.events.includes('new-host-cleanup'));
  assert(!fs.existsSync(input.directory));
});

test('restored startup failure still cleans owned daemon',async t=>{
  const input=fixture(t),first=original(),deps=dependencies(first,input,{failStart:true});
  await assert.rejects(()=>recovery.run(first,()=>'/unused',deps),/new-start-failed/);
  assert(first.events.includes('new-host-cleanup'));
  assert(!fs.existsSync(input.directory));
});

test('cancellation remains shared with second daemon lifecycle',async t=>{
  const input=fixture(t),first=original(),deps=dependencies(first,input,{cancelDuringPlatform:true});
  await assert.rejects(()=>recovery.run(first,()=>'/unused',deps),/canceled/);
  assert(first.events.includes('new-host-cleanup'));
});

test('cleanup failure fails acceptance and retains private recovery inputs',async t=>{
  const input=fixture(t),first=original(),deps=dependencies(first,input,{failCleanup:true});
  await assert.rejects(()=>recovery.run(first,()=>'/unused',deps),/restored-host-cleanup-failed/);
  assert(fs.existsSync(input.configArchive));
  assert.equal(fs.statSync(input.configArchive).mode&0o777,0o600);
});

test('bootstrap uses only declared binary streams and restores before normal controller startup',async t=>{
  const input=fixture(t),calls=[],stages=[];
  const candidate={spec:{restore:input},daemon:'owned-private-daemon',stage:async(name,action)=>{stages.push(name);return action();},call:async(args,options)=>{calls.push({args,options});return '';},inner:async(args,options)=>{calls.push({args,options});return args.includes('source /state/.docker.env; printf "%s" "${WIZARD_IMAGE:-systembootstrapper/wizard}"')?'systembootstrapper/wizard':'';}};
  await recovery.bootstrapRestore(candidate,{rewriter:'print("public fixture only")',storage:storageFixture});
  assert(!calls.some(call=>call.args[0]==='cp'),'no Docker cp binary transport');
  const uploads=calls.filter(call=>call.options?.inputFile);
  assert.deepEqual(uploads.map(call=>call.options.inputFile),[input.configArchive,input.seedArchive,input.configArchive,input.configArchive]);
  assert(!calls.some(call=>call.options?.input && Buffer.isBuffer(call.options.input)),'archive bytes never buffered into JSON input');
  const seed=calls.findIndex(call=>call.args.includes('seed.sh'));
  const normalCreate=calls.findIndex(call=>call.args[0]==='create'&&!call.args.includes('--entrypoint'));
  assert(seed>=0&&normalCreate>seed,'restore completes before normal controller creation');
  assert(calls[seed].args.includes('SYSTEM_SEED_CONFIGURATION_BACKUP=/recovery-inputs/bootstrapper.zip'),
    'the native helper must validate and import the real Wizard ZIP');
  assert.deepEqual(stages,['recovery-seed-native-restore']);
  assert.deepEqual(calls[seed].options.failureCodes,recovery.SEED_RESTORE_FAILURE_CODES);
  const hostBackup=calls.findIndex(call=>call.args.at(-1)?.includes('cat > /recovery-inputs/bootstrapper.zip'));
  assert(hostBackup>=0&&hostBackup<seed);
  const clearFixture=calls.findIndex(call=>call.args.at(-1)?.includes("fs.unlinkSync('/state/.docker.env')"));
  assert(clearFixture>=0&&clearFixture<hostBackup,'the native import starts from fresh configuration storage');
  assert(calls.at(-1).args.at(-1)==='/system/bootstrapper.zip','the recreated controller receives the actual archive for the Push proof');
  const initialCreate=calls.find(call=>call.args[0]==='create');
  const controllers=calls.filter(call=>call.args[0]==='create');
  assert.equal(controllers.length,2);
  for(const {args}of controllers)assert(args.some((value,index)=>value==='--env'&&args[index+1]==="GITLAB_OMNIBUS_CONFIG=puma['worker_processes'] = 2"),
    'both the restore helper controller and the normal restored controller retain the disposable Puma bound');
  assert(initialCreate.args.includes('/bin/sh')&&initialCreate.args.includes('sleep infinity'));
  assert(!initialCreate.args.includes(recovery.SEED+':/seed'),'backup is attached only to the transient operation helper');
  assert(initialCreate.args.includes('PERSISTENCE_MODE=local'));
  assert(initialCreate.args.includes('--restart'));
  assert(initialCreate.args.includes(recovery.BASE+'/host/letsencrypt:/host-letsencrypt'));
  assert(!initialCreate.args.some(arg=>arg.includes('/candidate-data/platform')),'old live paths never mounted');
  const python=calls.find(call=>call.args.includes('/opt/gitlab/embedded/bin/python3'));
  assert(python.args.includes('candidate-gitlab:under-test')&&python.args.includes('--network'));
});

test('native Seed restore records exact public failures through the Docker boundary and redacts other output',async t=>{
  const {Candidate}=require('./disposable-candidate');
  const input=fixture(t),bin=path.join(input.directory,'bin');fs.mkdirSync(bin);
  const example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
  const hash='a'.repeat(64),driver=new Candidate({example,daemonImage:'docker:29-dind@sha256:'+hash,
    images:Object.fromEntries(['candidate','wizard','gitlab','runner','nginx'].map(role=>[role,{id:'sha256:'+hash,archive:path.join(input.directory,role+'.tar')}]))});
  const previousPath=process.env.PATH;
  try{
    process.env.PATH=bin+path.delimiter+previousPath;
    for(const [line,reason]of [...Object.entries(recovery.SEED_RESTORE_FAILURE_CODES),
      ['Seed operation failed: private-fixture-token.','docker-exec-failed'],
      ['prefix Seed operation failed: invalid-configuration-backup.','docker-exec-failed']]){
      const lines=[line,'private-fixture-token /private/operator-path'];
      if(reason!=='docker-exec-failed')lines.push('Seed operation failed: seed-helper-operation-failed.');
      fs.writeFileSync(path.join(bin,'docker'),'#!/bin/sh\nprintf "%s\\n" '+lines.map(value=>"'"+value+"'").join(' ')+' >&2\nexit 7\n',{mode:0o755});
      const stages=[],events=[];
      const candidate={spec:{restore:input},daemon:'owned-private-daemon',results:stages,now:()=>0,checkpoint:()=>{},stage:Candidate.prototype.stage,
        call:async()=>'',inner:async(args,options)=>{
          if(args.includes('seed.sh'))return driver.exec(['exec'],options);
          return args.includes('source /state/.docker.env; printf "%s" "${WIZARD_IMAGE:-systembootstrapper/wizard}"')?'systembootstrapper/wizard':'';
        }};
      await assert.rejects(()=>recovery.bootstrapRestore(candidate,{storage:{...storageFixture,detach:async()=>events.push('detached')}}),error=>{
        assert.equal(error.message,reason);assert.equal(error.exitCode,7);return true;
      });
      assert.deepEqual(stages,[{name:'recovery-seed-native-restore',status:'failed',milliseconds:0,reason,exitCode:7}]);
      assert.deepEqual(events,[],'a failed native restore does not detach its backup');
      assert(!JSON.stringify(stages).includes('private-fixture-token'));
      assert(!JSON.stringify(stages).includes('/private/operator-path'));
    }
  }finally{process.env.PATH=previousPath;}
});

test('tampered or wrong-path recovery input fails before any Docker action',async t=>{
  const input=fixture(t),calls=[];
  const candidate={spec:{restore:{...input,configHash:'0'.repeat(64)}},call:async args=>calls.push(args),inner:async args=>calls.push(args)};
  await assert.rejects(()=>recovery.bootstrapRestore(candidate),/input-identity-mismatch/);
  candidate.spec.restore={...input,base:'/candidate-data/platform'};
  await assert.rejects(()=>recovery.bootstrapRestore(candidate),/input-identity-mismatch/);
  assert.equal(calls.length,0);
});

test('exporter requires exact artifact hash and refuses symlink inputs',t=>{
  const input=fixture(t),spec={configurationExporter:{archive:input.configArchive,sha256:input.configHash}};
  assert.equal(recovery.exporter(spec),input.configArchive);
  assert.throws(()=>recovery.exporter({configurationExporter:{...spec.configurationExporter,sha256:'0'.repeat(64)}}),/identity-mismatch/);
  const link=path.join(input.directory,'linked-exporter');fs.symlinkSync(input.configArchive,link);
  assert.throws(()=>recovery.exporter({configurationExporter:{archive:link,sha256:input.configHash}}),/identity-mismatch/);
});


test('actual TLS probe validates its CA, SNI and host using Node 24 DNS lookup semantics',async t=>{
  const https=require('node:https');
  const {execFileSync,spawn}=require('node:child_process');
  const input=fixture(t),cert=path.join(input.directory,'cert.pem'),key=path.join(input.directory,'key.pem');
  const foreignCert=path.join(input.directory,'foreign.pem'),foreignKey=path.join(input.directory,'foreign.key');
  for(const [certificate,privateKey]of [[cert,key],[foreignCert,foreignKey]]){
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=wizard.candidate.test',
      '-addext','subjectAltName=DNS:wizard.candidate.test,DNS:'+recovery.WIZARD_ALIAS,'-keyout',privateKey,'-out',certificate],{stdio:'ignore'});
  }
  const server=https.createServer({cert:fs.readFileSync(cert),key:fs.readFileSync(key)},(req,res)=>{
    const host=req.headers.host.split(':')[0];assert.equal(req.socket.servername,host);
    if(host===recovery.WIZARD_ALIAS){res.writeHead(308,{Location:'https://wizard.candidate.test'+req.url});res.end();}
    else {assert.equal(host,'wizard.candidate.test');res.end('verified synthetic TLS');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const candidate={inner:async(args,options)=>{
    if(args[0]==='inspect')return JSON.stringify({bridge:{Gateway:'127.0.0.1'}});
    return new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['-e',args.at(-1)],{stdio:['pipe','pipe','pipe']});let output='';
      child.stdout.on('data',chunk=>output+=chunk);child.stderr.resume();child.on('error',reject);
      child.on('close',code=>code===0?resolve(output):reject(Error('verified-tls-rejected')));
      child.stdin.end(options.input);
    });
  }};
  const connection={certificate:cert,port:server.address().port};
  const response=await recovery.tlsProbe(candidate,'wizard.candidate.test','/',{},connection);
  assert.equal(response.status,200);assert.equal(response.body,'verified synthetic TLS');
  assert.equal(response.serial,new (require('crypto').X509Certificate)(fs.readFileSync(cert)).serialNumber);
  const alias=await recovery.tlsProbe(candidate,recovery.WIZARD_ALIAS,recovery.ALIAS_ROUTE,{},connection);
  assert.equal(alias.status,308);assert.equal(alias.headers.location,'https://wizard.candidate.test'+recovery.ALIAS_ROUTE);assert.equal(alias.serial,response.serial);
  await assert.rejects(()=>recovery.tlsProbe(candidate,'wrong.candidate.test','/',{},connection),/tls-rejected/);
  await assert.rejects(()=>recovery.tlsProbe(candidate,'wizard.candidate.test','/',{},{...connection,certificate:foreignCert}),/tls-rejected/);
});

test('HTTP routing probe preserves the raw path/query and response Location without following redirects',async t=>{
  const {spawn}=require('node:child_process'),http=require('node:http');
  const server=http.createServer((req,res)=>{
    assert.equal(req.headers.host.split(':')[0],recovery.WIZARD_ALIAS);assert.equal(req.url,recovery.ALIAS_ROUTE);
    res.writeHead(308,{Location:'https://wizard.candidate.test'+req.url});res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const candidate={inner:async(args,options)=>{
    if(args[0]==='inspect')return JSON.stringify({bridge:{Gateway:'127.0.0.1'}});
    return new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['-e',args.at(-1)],{stdio:['pipe','pipe','pipe']});let output='';
      child.stdout.on('data',chunk=>output+=chunk);child.stderr.resume();child.on('error',reject);
      child.on('close',code=>code===0?resolve(output):reject(Error('http-routing-rejected')));child.stdin.end(options.input);
    });
  }};
  const response=await recovery.httpProbe(candidate,recovery.WIZARD_ALIAS,recovery.ALIAS_ROUTE,{},{port:server.address().port});
  assert.equal(response.status,308);assert.equal(response.headers.location,'https://wizard.candidate.test'+recovery.ALIAS_ROUTE);
  assert.equal(response.serial,undefined);
});

function aliasFixture(change){
  const requests=[],files=[];
  const candidate={spec:{},wait:async action=>assert(await action())};
  const probe=tls=>async(_candidate,host,route,_options,connection)=>{
    requests.push({tls,host,route,connection});
    const challenge=route.startsWith('/.well-known/acme-challenge/');
    const response=challenge?{status:route.endsWith('-missing')?404:200,headers:{},body:route.endsWith('-missing')?'':'system-bootstrapper-canonical-alias-http01'}:
      {status:308,headers:{location:'https://wizard.candidate.test'+route},body:''};
    if(tls)response.serial='BB';return change?change(response,{tls,route,challenge}):response;
  };
  return {candidate,requests,files,dependencies:{httpProbe:probe(false),tlsProbe:probe(true),node:async(_candidate,action,input)=>files.push({action:action.toString(),input})}};
}
test('alias verification checks HTTP and CA-verified HTTPS redirects, exact URI, direct challenges and the served serial',async()=>{
  const f=aliasFixture();await recovery.verifyAliasRouting(f.candidate,{certificate:'/fixture-ca',serial:'BB'},f.dependencies);
  assert.equal(f.requests.length,8);assert(f.requests.every(request=>request.host===recovery.WIZARD_ALIAS));
  for(const tls of [false,true])assert.deepEqual(f.requests.filter(request=>request.tls===tls).map(request=>request.route),
    ['/',recovery.ALIAS_ROUTE,'/.well-known/acme-challenge/canonical-alias-check','/.well-known/acme-challenge/canonical-alias-check-missing']);
  assert.equal(f.files.length,2);assert(f.files[0].action.includes('writeFileSync'));assert(f.files[1].action.includes('rmSync'));
  assert(f.requests.filter(request=>request.tls).every(request=>request.connection.certificate==='/fixture-ca'));
});
test('alias verification rejects stripped/changed targets, redirecting challenges and stale TLS before recording acceptance',async()=>{
  const cases=[
    [(response,{challenge})=>challenge?response:{...response,status:200},'redirect'],
    [(response,{challenge})=>challenge?response:{...response,headers:{location:'https://wizard.candidate.test/'}},'redirect'],
    [(response,{challenge})=>challenge?response:{...response,headers:{location:'https://other.candidate.test'+recovery.ALIAS_ROUTE}},'redirect'],
    [(response,{challenge})=>challenge?{...response,status:308,headers:{location:'https://wizard.candidate.test/'}}:response,'challenge'],
    [(response,{challenge})=>challenge?{...response,body:'private-upstream-body'}:response,'challenge'],
    [(response,{tls})=>tls?{...response,serial:'AA'}:response,'redirect']
  ];
  for(const [change,reason]of cases){
    const f=aliasFixture(change);
    await assert.rejects(()=>recovery.verifyAliasRouting(f.candidate,{serial:'BB'},f.dependencies),{message:'canonical-alias-'+reason+'-failed'});
    assert.equal(f.files.length,2,'failed verification still removes its owned challenge');
  }
});
test('original and restored alias checks rerender/reload and restart only the private entry proxy',async()=>{
  for(const phase of ['original','restored']){
    const events=[],connection={certificate:'/fixture-ca'};
    const candidate={stage:async(name,action)=>{events.push(name);return action();},inner:async args=>events.push(args)};
    await recovery.verifyAliasLifecycle(candidate,connection,phase,{verifyAliasRouting:async(actual,actualConnection)=>{
      assert.equal(actual,candidate);assert.equal(actualConnection,connection);events.push('verified');
    }});
    assert.deepEqual(events,[
      'recovery-'+phase+'-alias-routing','verified','recovery-'+phase+'-alias-reload',
      ['exec','-w','/system/nginx','system_bootstrapper_1','bash','-e','start.sh','reload'],'verified',
      'recovery-'+phase+'-alias-restart',['restart','system_web_1'],'verified'
    ]);
  }
});
test('alias lifecycle failures retain bounded diagnostic codes and the shared cancellation reason',async()=>{
  const {Candidate}=require('./disposable-candidate');
  for(const phase of ['original','restored'])for(const failed of ['routing','reload','restart']){
    const stages=[],events=[];
    const candidate={results:stages,now:()=>0,checkpoint:()=>{},stage:Candidate.prototype.stage,
      inner:async args=>{
        const name=args[0]==='restart'?'restart':'reload';events.push(name);
        if(name===failed)throw Object.assign(Error('private-upstream-error'),{exitCode:23});
      }};
    const dependencies={verifyAliasRouting:async()=>{if(failed==='routing')throw Error('canonical-alias-redirect-failed');}};
    const reason=failed==='routing'?'canonical-alias-redirect-failed':'recovery-'+phase+'-alias-'+failed+'-failed';
    await assert.rejects(()=>recovery.verifyAliasLifecycle(candidate,{},phase,dependencies),{message:reason});
    assert.equal(stages.at(-1).reason,reason);assert.equal(stages.at(-1).name,'recovery-'+phase+'-alias-'+failed);
    assert(!JSON.stringify(stages).includes('private-'));
    if(failed!=='routing')assert.equal(stages.at(-1).exitCode,23);
    if(failed==='reload')assert(!events.includes('restart'));
  }
  const canceled={stage:async(_name,action)=>action()};
  await assert.rejects(()=>recovery.verifyAliasLifecycle(canceled,{},'original',{verifyAliasRouting:async()=>{throw Error('canceled-or-overall-timeout');}}),
    {message:'canceled-or-overall-timeout'});
});


test('recording backup fixture settings never replaces an existing image/version/binding choice',()=>{
  const actual='export WIZARD_IMAGE="registry.private.test/wizard@sha256:'+'a'.repeat(64)+'"\nGITLAB_IMAGE="gitlab/gitlab-ce:19.4.2-ce.0"\nGITLAB_SSH_BIND="127.0.0.1:2222"\nSYNC_DOMAIN_MODE="0"\n';
  const updated=recovery.updateConfiguration(actual,{WIZARD_IMAGE:'systembootstrapper/wizard',GITLAB_IMAGE:'incompatible-default',GITLAB_SSH_BIND:'22',SYNC_DOMAIN_MODE:'2'});
  assert(updated.includes('registry.private.test/wizard@sha256:'));
  assert(updated.includes('gitlab/gitlab-ce:19.4.2-ce.0'));
  assert(updated.includes('127.0.0.1:2222'));
  assert(updated.includes("SYNC_DOMAIN_MODE='2'"));
  assert(!updated.includes('incompatible-default'));
});

test('a private Wizard pin fails explicitly without silently selecting the fixture image',async t=>{
  const input=fixture(t),calls=[];
  const candidate={spec:{restore:input},daemon:'owned-private-daemon',call:async(args,options)=>{calls.push({args,options});return '';},inner:async(args,options)=>{calls.push({args,options});return args.includes('source /state/.docker.env; printf "%s" "${WIZARD_IMAGE:-systembootstrapper/wizard}"')?'registry.private.test/wizard@sha256:'+'a'.repeat(64):'';}};
  await assert.rejects(()=>recovery.bootstrapRestore(candidate,{rewriter:'public fixture',storage:storageFixture}),/wizard-pin-recovery-artifact-not-declared/);
  assert(!calls.some(call=>call.args[0]==='create'&&!call.args.includes('--entrypoint')),'normal provisioning must not conceal a substituted image');
});

test('the private image oracle requires an exact owned-registry artifact absent from declared build archives',()=>{
  const f=privateFixture();assert.equal(recovery.privateWizardDescriptor(f.expected,f),f.expected);
  for(const change of [{imageId:f.images.wizard.id},{sourceImageId:'sha256:'+'0'.repeat(64)},{imageRef:f.expected.imageRef.replace('root/wizard','root/other')},{markerPath:'/etc/passwd'},{projectId:0}]){
    assert.throws(()=>recovery.privateWizardDescriptor({...f.expected,...change},f),/descriptor-invalid/);
  }
});
test('declared private pin remains exact and both its new image ID and reference must be absent before startup',async t=>{
  const input=fixture(t),f=privateFixture(),calls=[];input.expected.privateWizard=f.expected;
  const candidate={spec:{restore:input,privateWizardRecovery:true,images:f.images},daemon:'owned-private-daemon',stage:async(_name,action)=>action(),call:async(args,options)=>{calls.push({args,options});return '';},inner:async(args,options)=>{
    calls.push({args,options});if(args[0]==='image')throw Error('absent image');
    return args.includes('source /state/.docker.env; printf "%s" "${WIZARD_IMAGE:-systembootstrapper/wizard}"')?f.expected.imageRef:'';
  }};
  await recovery.bootstrapRestore(candidate,{rewriter:'public source fixture',storage:storageFixture});
  assert.deepEqual(calls.filter(call=>call.args[0]==='image').map(call=>call.args.at(-1)),[f.expected.imageRef,f.expected.imageId]);
  assert(calls.some(call=>call.args[0]==='create'&&!call.args.includes('--entrypoint')));
  assert(!calls.some(call=>call.args.some(arg=>arg===f.expected.imageRef)&&call.args[0]==='tag'),'the test must not manufacture a cached pin');
});
test('an already cached private layer fails acceptance before normal platform startup',async t=>{
  const input=fixture(t),f=privateFixture(),calls=[];input.expected.privateWizard=f.expected;
  const candidate={spec:{restore:input,privateWizardRecovery:true,images:f.images},daemon:'owned-private-daemon',call:async()=>'',inner:async args=>{
    calls.push(args);return args.includes('source /state/.docker.env; printf "%s" "${WIZARD_IMAGE:-systembootstrapper/wizard}"')?f.expected.imageRef:'cached image';
  }};
  await assert.rejects(()=>recovery.bootstrapRestore(candidate,{storage:storageFixture}),/image-already-cached/);
  assert(!calls.some(args=>args[0]==='create'&&!args.includes('--entrypoint')));
});
test('private-image proof requires the restored container identity, marker and zero live recovery credentials',async()=>{
  const expected=privateFixture().expected;
  const candidate={stage:async(_name,action)=>action(),inner:async args=>args[0]==='inspect'?expected.imageId:expected.marker,rails:async()=>({active:0})};
  await recovery.verifyPrivateWizard(candidate,expected);assert.equal(candidate.privateWizardPinVerified,true);
  for(const fault of ['image','marker','credential']){
    const bad={...candidate,privateWizardPinVerified:false,inner:async args=>args[0]==='inspect'?(fault==='image'?'sha256:'+'f'.repeat(64):expected.imageId):(fault==='marker'?'different-marker':expected.marker),rails:async()=>({active:fault==='credential'?1:0})};
    await assert.rejects(()=>recovery.verifyPrivateWizard(bad,expected),/restoration-or-credential-cleanup-failed/);assert.equal(bad.privateWizardPinVerified,false);
  }
});
test('native private image descriptors retain exact project, build, source, registry and uncached image identity',()=>{
  const f=privateNativeFixture();assert.equal(recovery.privateWizardDescriptor(f.expected,f),f.expected);
  for(const change of [{kind:'unknown'},{projectId:0},{pipelineId:0},{jobId:0},{runnerId:0},{sourceCommit:'latest'},
    {registryHost:'foreign.invalid'},{projectPath:'team/../native-source'},{imageId:f.images.wizard.id},
    {imageRef:f.expected.imageRef.replace('team/native-source','team/other')},{marker:'a'.repeat(24)},{sourceImageId:f.images.wizard.id}])
    assert.throws(()=>recovery.privateWizardDescriptor({...f.expected,...change},f),/descriptor-invalid/);
  assert.throws(()=>recovery.privateWizardDescriptor(f.expected,{...f,supportImages:{helper:{id:f.expected.imageId}}}),/descriptor-invalid/);
});
test('native private recovery starts with neither immutable reference nor image ID cached',async t=>{
  for(const cached of [false,true]) {
    const input=fixture(t),f=privateNativeFixture(),calls=[];input.expected.privateWizard=f.expected;
    const candidate={spec:{restore:input,privateWizardRecovery:true,images:f.images},daemon:'owned-private-daemon',stage:async(_name,action)=>action(),
      call:async(args,options)=>{calls.push({args,options});return '';},inner:async(args,options)=>{
        calls.push({args,options});if(args[0]==='image'){if(cached)return 'cached image';throw Error('absent image');}
        return args.includes('source /state/.docker.env; printf "%s" "${WIZARD_IMAGE:-systembootstrapper/wizard}"')?f.expected.imageRef:'';
      }};
    if(cached)await assert.rejects(recovery.bootstrapRestore(candidate,{storage:storageFixture}),/image-already-cached/);
    else {
      await recovery.bootstrapRestore(candidate,{rewriter:'public source fixture',storage:storageFixture});
      assert.deepEqual(calls.filter(call=>call.args[0]==='image').map(call=>call.args.at(-1)),[f.expected.imageRef,f.expected.imageId]);
    }
    assert(!calls.some(call=>call.args[0]==='tag'||call.args[0]==='build'),'Native recovery manufactured its image');
  }
});
test('native private restoration verifies exact running ID, OCI source revision and revoked deploy tokens without a marker',async()=>{
  const {expected}=privateNativeFixture(),calls=[];
  const candidate={stage:async(_name,action)=>action(),inner:async args=>{
    calls.push(args);assert.equal(args[0],'inspect','Native recovery must not require a synthetic marker');
    return args[2]==='{{.Image}}'?expected.imageId:expected.sourceCommit;
  },rails:async()=>({active:0})};
  await recovery.verifyPrivateWizard(candidate,expected);assert.equal(candidate.privateWizardPinVerified,true);
  assert.equal(calls.length,2);
  for(const fault of ['image','source','credential']) {
    const bad={...candidate,privateWizardPinVerified:false,inner:async args=>args[2]==='{{.Image}}'?
      (fault==='image'?'sha256:'+'0'.repeat(64):expected.imageId):(fault==='source'?'0'.repeat(40):expected.sourceCommit),
      rails:async()=>({active:fault==='credential'?1:0})};
    await assert.rejects(recovery.verifyPrivateWizard(bad,expected),/restoration-or-credential-cleanup-failed/);
    assert.equal(bad.privateWizardPinVerified,false);
  }
});
test('an independent ACME authority survives the host switch and is removed after both heavy hosts',async t=>{
  const input=fixture(t),first=original();first.spec.acmeRenewalAcceptance=true;input.expected.acme={account:'oracle'};
  const deps=dependencies(first,input);
  deps.LocalAcme=class{
    constructor(owner){assert.equal(owner,first);}
    async start(){first.events.push('authority-start');}
    async renew(second,expected){assert.equal(expected,input.expected.acme);first.events.push('actual-renewal-proof');second.acmeRenewalVerified=true;}
    cleanup(){first.events.push('authority-cleanup');return true;}
  };
  await recovery.run(first,()=>'/unused',deps);
  assert(first.events.indexOf('authority-start')<first.events.indexOf('backups-captured'));
  assert(first.events.indexOf('new-host-started')<first.events.indexOf('actual-renewal-proof'));
  assert(first.events.indexOf('new-host-cleanup')<first.events.indexOf('authority-cleanup'));
  assert.equal(first.evidence.recovery.acmeRenewalVerified,true);assert.equal(first.evidence.recovery.syntheticTlsVerified,false);
});
test('authority startup failure cleans the original owned host before removing tiny fixture dependencies',async t=>{
  const input=fixture(t),first=original();first.spec.acmeRenewalAcceptance=true;
  const deps=dependencies(first,input);
  deps.LocalAcme=class{
    async start(){throw Error('authority-start-failed');}
    cleanup(){first.events.push('authority-cleanup');return true;}
  };
  await assert.rejects(()=>recovery.run(first,()=>'/unused',deps),/authority-start-failed/);
  assert(first.events.indexOf('original-cleanup')<first.events.indexOf('authority-cleanup'));
  assert(!first.events.includes('new-host-created'));
});
test('failed restored-host cleanup retains authority dependencies and private archives',async t=>{
  const input=fixture(t),first=original();first.spec.acmeRenewalAcceptance=true;
  const deps=dependencies(first,input,{failCleanup:true});
  deps.LocalAcme=class{async start(){}async renew(){}cleanup(){first.events.push('authority-cleanup');return true;}};
  await assert.rejects(()=>recovery.run(first,()=>'/unused',deps),/restored-host-cleanup-failed/);
  assert(!first.events.includes('authority-cleanup'));assert(fs.existsSync(input.configArchive));
});
test('Fetch after ACME activation uses authenticated CA-verified HTTPS for all configuration requests',async()=>{
  const requests=[],logo=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8').slice(0,1184);
  const candidate={secrets:{user:'synthetic-user',password:'synthetic-password'},request:async()=>{throw Error('unsafe HTTP request');},inner:async(args,options)=>{
    if(args[0]==='inspect')return JSON.stringify({bridge:{Gateway:'127.0.0.1'}});
    const input=JSON.parse(options.input);requests.push(input);assert.equal(input.host,'sync.candidate.test');assert.equal(input.certificate,'/ssl/fixture-ca.pem');
    if(input.route==='/login')return JSON.stringify({status:200,body:JSON.stringify({accessToken:'synthetic-token'})});
    assert.equal(input.options.headers.Authorization,'Bearer synthetic-token');
    return JSON.stringify({status:200,body:JSON.stringify(input.route==='/config/main'?{data:logo}:[{filename:'.wizard.env'}])});
  }};
  const result=await recovery.syncFetch(candidate,{certificate:'/ssl/fixture-ca.pem'});
  assert.equal(result.main.data,logo);assert.deepEqual(requests.map(input=>input.route),['/login','/config/main','/config/projects']);
});
function identityFixture(failRoute){
  const requests=[],stages=[],sha='a'.repeat(40),digest='sha256:'+'b'.repeat(64);
  const reviewSha='d'.repeat(40),reviewBranch='recovery-review-cccccccc',createdAt='2026-01-01T00:00:00.000Z';
  const state={review:null,discussion:null,nonce:null,username:null};
  const candidate={id:'c'.repeat(24),evidence:{projectId:12,pipelineId:21},rails:async()=>({token:'private-fixture-token',root_id:1}),
    wait:async action=>assert.equal(await action(),true),
    stage:async(name,action)=>{try{const value=await action();stages.push({name,status:'passed'});return value;}catch(error){stages.push({name,status:'failed',reason:error.message});throw error;}},
    api:async(route,token,method='GET',body)=>{
      assert.equal(token,'private-fixture-token');requests.push({route,method});
      if(route===failRoute)throw Error('private-upstream-body-token-must-not-escape');
      if(route==='/projects/12')return {default_branch:'main',path_with_namespace:'root/recovery'};
      if(route==='/projects/12/repository/branches/main')return {commit:{id:sha}};
      if(route==='/projects/12/repository/branches/'+reviewBranch)return {commit:{id:reviewSha}};
      if(route==='/projects/12/pipelines/21')return {status:'success',sha};
      if(route==='/projects/12/issues'){assert.equal(method,'POST');state.nonce=body.description;return {iid:7};}
      if(route==='/projects/12/issues/7')return {iid:7,description:state.nonce};
      if(route==='/projects/12/repository/commits'){
        assert.equal(method,'POST');assert.equal(body.branch,reviewBranch);assert.equal(body.start_sha,sha);
        assert.match(body.commit_message,/\[skip ci\]/);assert.deepEqual(body.actions,[{action:'create',file_path:'recovery-proof.txt',content:state.nonce+'\n'}]);
        return {id:reviewSha};
      }
      if(route==='/projects/12/merge_requests'){
        assert.equal(method,'POST');assert.equal(body.source_branch,reviewBranch);assert.equal(body.target_branch,'main');
        assert.match(body.description,/Recovery proof for #7/);assert.match(body.title,/^Draft:/);
        state.review={id:31,iid:3,project_id:12,title:body.title,description:body.description,state:'opened',
          source_branch:body.source_branch,target_branch:body.target_branch,source_project_id:12,target_project_id:12,
          author:{id:1},created_at:createdAt,sha:reviewSha,merge_commit_sha:null,merged_at:null};
        return state.review;
      }
      if(route==='/projects/12/merge_requests/3')return state.review;
      const discussionRoute='/projects/12/merge_requests/3/discussions';
      if(route===discussionRoute){
        assert.equal(method,'POST');state.discussion={id:'e'.repeat(40),individual_note:false,
          notes:[{id:41,body:body.body,author:{id:1},created_at:createdAt,updated_at:createdAt,resolvable:true,resolved:false}]};
        return state.discussion;
      }
      if(route===discussionRoute+'/'+'e'.repeat(40)+'/notes'){
        assert.equal(method,'POST');const note={id:42,body:body.body,author:{id:1},created_at:createdAt,updated_at:createdAt,resolvable:true,resolved:false};
        state.discussion.notes.push(note);return note;
      }
      if(route===discussionRoute+'/'+'e'.repeat(40))return state.discussion;
      if(route==='/projects/12/variables'){assert.equal(method,'POST');return {};}
      if(route==='/projects/12/variables/RECOVERY_ENCRYPTED_PROOF')return {value:state.nonce};
      if(route==='/users'){assert.equal(method,'POST');state.username=body.username;return {id:9,username:body.username};}
      if(route==='/users/9')return {id:9,username:state.username};
      if(route==='/projects/12/registry/repositories')return [{id:14,path:'root/recovery/probe'}];
      if(route==='/projects/12/registry/repositories/14/tags/'+sha)return {digest};
      if(route==='/personal_access_tokens/self'){assert.equal(method,'DELETE');return null;}
      throw Error('unexpected API route');
    }};
  return {candidate,requests,stages,sha,digest,reviewSha,state};
}
test('identity capture uses the documented project-scoped tag endpoint and journals every data boundary',async()=>{
  const f=identityFixture();const result=await recovery.recordIdentity(f.candidate);
  assert.equal(result.registryDigest,f.digest);assert.equal(result.imageCommit,f.sha);assert.equal(result.registryId,14);
  assert(f.requests.some(item=>item.route==='/projects/12/registry/repositories/14/tags/'+f.sha));
  assert(!f.requests.some(item=>item.route.startsWith('/registry/repositories/')));
  assert.deepEqual(f.stages.map(item=>item.name),['credential','project','repository-head','pipeline','issue','review-branch','merge-request','review-discussion','review-reply','review-metadata','encrypted-variable','user','registry-repositories','registry-tag','credential-revoked'].map(name=>'recovery-identity-'+name));
  assert.equal(result.head,f.sha,'review fixture must not move the default branch');
  assert.equal(result.mergeRequest.review.sha,f.reviewSha);assert.equal(result.mergeRequest.review.state,'opened');
  assert.equal(result.mergeRequest.discussion.notes.length,2);assert.equal(result.mergeRequest.discussion.notes[1].body,'Recovery reply '+result.nonce);
  assert(f.stages.every(item=>item.status==='passed'));
});
test('capture failures identify the precise operation, revoke credentials and suppress upstream private errors',async()=>{
  const {failureReason}=require('./stage-diagnostics');
  for(const [route,label]of [['/projects/12','project'],['/projects/12/issues','issue'],['/projects/12/repository/commits','review-branch'],
    ['/projects/12/merge_requests','merge-request'],['/projects/12/merge_requests/3/discussions','review-discussion'],
    ['/projects/12/merge_requests/3/discussions/'+'e'.repeat(40)+'/notes','review-reply'],
    ['/projects/12/registry/repositories/14/tags/'+'a'.repeat(40),'registry-tag']]){
    const f=identityFixture(route);
    await assert.rejects(()=>recovery.recordIdentity(f.candidate),new RegExp('recovery-identity-'+label+'-failed'));
    assert.equal(failureReason('recovery-identity-'+label+'-failed'),'recovery-identity-'+label+'-failed');
    assert(f.requests.some(item=>item.route==='/personal_access_tokens/self'&&item.method==='DELETE'));
    assert(f.stages.some(item=>item.name==='recovery-identity-'+label&&item.status==='failed'));
    assert(!JSON.stringify(f.stages).includes('private-'));
  }
});
test('restored service identity includes review branch, MR metadata and both attributed discussion notes',async()=>{
  const f=identityFixture(),expected=await recovery.recordIdentity(f.candidate);
  f.requests.length=0;f.stages.length=0;
  await recovery.verifyServiceIdentity(f.candidate,expected);
  assert.equal(f.candidate.mergeRequestRecoveryVerified,true);
  assert(f.requests.some(item=>item.route==='/projects/12/repository/branches/'+expected.mergeRequest.review.sourceBranch));
  assert(f.stages.some(item=>item.name==='recovery-restored-merge-request'&&item.status==='passed'));
  assert.equal(f.requests.at(-1).route,'/personal_access_tokens/self');
  assert(!JSON.stringify(f.stages).includes(expected.nonce));
});
test('missing or changed MR state, source commit, author, timestamp and discussion fail recovery and revoke the credential',async()=>{
  const {failureReason}=require('./stage-diagnostics');
  assert.equal(failureReason('recovery-restored-merge-request-failed'),'recovery-restored-merge-request-failed');
  const changes=[
    f=>{f.state.review.state='closed';},
    f=>{f.state.review.source_branch='other-review';},
    f=>{f.state.review.target_branch='other-target';},
    f=>{f.state.review.sha='f'.repeat(40);},
    f=>{f.state.review.merge_commit_sha='f'.repeat(40);},
    f=>{f.state.review.author.id=2;},
    f=>{f.state.review.created_at='2026-01-02T00:00:00.000Z';},
    f=>{f.state.discussion.notes[0].body='changed review';},
    f=>{f.state.discussion.notes[1].author.id=2;},
    f=>{f.state.discussion.notes[1].created_at='2026-01-02T00:00:00.000Z';},
    f=>{f.state.discussion.notes[0].resolved=true;},
    f=>{f.state.discussion.notes.pop();}
  ];
  for(const change of changes){
    const f=identityFixture(),expected=await recovery.recordIdentity(f.candidate);
    change(f);f.requests.length=0;f.stages.length=0;
    await assert.rejects(()=>recovery.verifyServiceIdentity(f.candidate,expected),/recovery-restored-merge-request-failed/);
    assert.notEqual(f.candidate.mergeRequestRecoveryVerified,true);
    assert.equal(f.requests.at(-1).route,'/personal_access_tokens/self');
    assert(!JSON.stringify(f.stages).includes(expected.nonce));
  }
  const missing=identityFixture(),expected=await recovery.recordIdentity(missing.candidate);delete expected.mergeRequest;
  await assert.rejects(()=>recovery.verifyServiceIdentity(missing.candidate,expected),/recovery-restored-merge-request-failed/);
  assert.equal(missing.requests.at(-1).route,'/personal_access_tokens/self');
  const wrongBranch=identityFixture(),branchExpected=await recovery.recordIdentity(wrongBranch.candidate),api=wrongBranch.candidate.api;
  wrongBranch.candidate.api=(route,...args)=>route.endsWith('/repository/branches/'+branchExpected.mergeRequest.review.sourceBranch)?Promise.resolve({commit:{id:'f'.repeat(40)}}):api(route,...args);
  await assert.rejects(()=>recovery.verifyServiceIdentity(wrongBranch.candidate,branchExpected),/recovery-restored-merge-request-failed/);
  assert.notEqual(wrongBranch.candidate.mergeRequestRecoveryVerified,true);
  assert.equal(wrongBranch.requests.at(-1).route,'/personal_access_tokens/self');
});
test('tag-detail lookup refuses malformed project/repository/source identities without an API call',async()=>{
  const candidate={api:async()=>{throw Error('must not call API');}};
  for(const [project,repository,tag]of [[0,14,'a'.repeat(40)],[12,-1,'a'.repeat(40)],[12,14,'../other']]){
    await assert.rejects(()=>recovery.registryTag(candidate,project,repository,tag,'private-token'),/tag-identity-invalid/);
  }
});

function restoredConfigurationFixture(changes={}) {
  const {Candidate}=require('./disposable-candidate');
  let time=0;
  const stages=[],requests=[];
  const config=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8').slice(0,1184)+
    "export SEED_DIR='"+recovery.SEED+"'\nexport RECOVERY_RUNTIME_PROOF=\"literal=one=two \\$HOME\"\n";
  const input={expected:{certificateHash:'a'.repeat(64),accountIdentity:'test-account'}};
  const candidate={spec:{readinessMilliseconds:5000},secrets:{user:'restored-user',password:'restored-password'},
    results:stages,now:()=>time,deadline:10000,sleep:async value=>{time+=value;},checkpoint:()=>{},
    stage:Candidate.prototype.stage,wait:Candidate.prototype.wait};
  const dependencies={tlsProbe:async(_candidate,host,route,options)=>{
    requests.push({host,route,options});
    if(route==='/')return {status:200,body:'<html>Wizard ready</html>'};
    if(route==='/login'){
      assert.deepEqual(JSON.parse(options.body),{username:candidate.secrets.user,password:candidate.secrets.password});
      return {status:200,body:JSON.stringify({accessToken:'private-fixture-token'})};
    }
    assert.equal(options.headers.Authorization,'Bearer private-fixture-token');
    return {status:200,body:JSON.stringify({data:changes.config??config})};
  },node:async()=>JSON.stringify({certificate:input.expected.certificateHash,account:input.expected.accountIdentity,
    renewal:'webroot_path = '+recovery.BASE+'/ssl/acme-http01,\n',oldLivePresent:false,...changes.proof})};
  return {candidate,input,dependencies,requests,stages,config};
}
test('restored Wizard availability may precede Sync; authenticated readiness retries only startup failures',async()=>{
  const f=restoredConfigurationFixture(),probe=f.dependencies.tlsProbe;
  let login=0,fetch=0;
  f.dependencies.tlsProbe=async(...args)=>{
    if(args[2]==='/login'){
      login++;
      if(login===1)throw Error('private-upstream-transport-details');
      if(login===2)return {status:502,body:'private-proxy-response'};
      if(login===3)return {status:503,body:'private-proxy-response'};
    }
    if(args[2]==='/config/main'&&++fetch===1)return {status:504,body:'private-proxy-response'};
    return probe(...args);
  };
  await recovery.verifyConfiguration(f.candidate,f.input,f.dependencies);
  assert.equal(login,4);assert.equal(fetch,2);
  assert.deepEqual(f.stages.map(stage=>stage.name),['wizard-tls','sync-login','configuration-fetch','config-signature','seed-directory','runtime-extension','certificate-state','renewal-path'].map(name=>'recovery-restored-'+name));
  assert(f.stages.every(stage=>stage.status==='passed'));
  assert(!JSON.stringify(f.stages).includes('private-'));
});
test('reachable Sync rejects wrong credentials immediately instead of hiding them behind readiness retries',async()=>{
  for(const status of [400,401,403,404,500]){
    const f=restoredConfigurationFixture(),probe=f.dependencies.tlsProbe;let login=0;
    f.dependencies.tlsProbe=(...args)=>args[2]==='/login'?(login++,Promise.resolve({status,body:'private-response-with-secrets'})):probe(...args);
    await assert.rejects(()=>recovery.verifyConfiguration(f.candidate,f.input,f.dependencies),/recovery-restored-sync-login-failed/);
    assert.equal(login,1);assert.equal(f.stages.at(-1).reason,'recovery-restored-sync-login-failed');
    assert(!JSON.stringify(f.stages).includes('private-'));
  }
});
test('restored configuration failures have distinct safe checkpoints without leaking upstream data',async()=>{
  for(const [changes,checkpoint]of [
    [{config:'not-a-signed-configuration'},'config-signature'],
    [{config:restoredConfigurationFixture().config.replace(recovery.SEED,'/wrong-seed')},'seed-directory'],
    [{config:restoredConfigurationFixture().config.replace('RECOVERY_RUNTIME_PROOF','WRONG_RUNTIME_PROOF')},'runtime-extension'],
    [{config:restoredConfigurationFixture().config.replace('literal=one=two','wrong=one=two')},'runtime-extension'],
    [{proof:{certificate:'b'.repeat(64)}},'certificate-state'],
    [{proof:{renewal:'private-old-path /candidate-data/platform'}},'renewal-path']
  ]){
    const f=restoredConfigurationFixture(changes);
    await assert.rejects(()=>recovery.verifyConfiguration(f.candidate,f.input,f.dependencies),new RegExp('recovery-restored-'+checkpoint+'-failed'));
    assert.equal(f.stages.at(-1).name,'recovery-restored-'+checkpoint);
    assert(!JSON.stringify(f.stages).includes('private-old-path'));
  }
});
test('restored TLS readiness retains explicit global budget and stage timeout reasons',async()=>{
  for(const reason of ['canceled-or-overall-timeout','readiness-timeout']){
    const f=restoredConfigurationFixture();f.candidate.wait=async()=>{throw Error(reason);};
    await assert.rejects(()=>recovery.verifyConfiguration(f.candidate,f.input,f.dependencies),{message:reason});
    assert.equal(f.stages.at(-1).reason,reason);assert.equal(f.stages.at(-1).name,'recovery-restored-wizard-tls');
  }
});

test('restored path and runtime proofs compare shell values rather than the export quoting style',async()=>{
  const initial=restoredConfigurationFixture();
  const config=initial.config.replace("SEED_DIR='"+recovery.SEED+"'",'SEED_DIR="'+recovery.SEED+'"');
  const f=restoredConfigurationFixture({config});
  await recovery.verifyConfiguration(f.candidate,f.input,f.dependencies);
  assert(f.stages.every(stage=>stage.status==='passed'));
});
test('restored configuration must retain the exact exported alias before routing acceptance',async()=>{
  for(const value of [recovery.WIZARD_ALIAS,undefined,'other.candidate.test']){
    const initial=restoredConfigurationFixture();
    const f=restoredConfigurationFixture({config:initial.config+(value===undefined?'':"export WIZARD_ALIASES='"+value+"'\n")});
    f.input.expected.wizardAliases=recovery.WIZARD_ALIAS;
    if(value===recovery.WIZARD_ALIAS){
      await recovery.verifyConfiguration(f.candidate,f.input,f.dependencies);
      assert(f.stages.some(stage=>stage.name==='recovery-restored-alias-configuration'&&stage.status==='passed'));
    }else{
      await assert.rejects(()=>recovery.verifyConfiguration(f.candidate,f.input,f.dependencies),/recovery-restored-alias-configuration-failed/);
      assert.equal(f.stages.at(-1).reason,'recovery-restored-alias-configuration-failed');
    }
  }
});
test('persistent Sync startup failure remains bounded by readiness and shared cancellation',async()=>{
  const f=restoredConfigurationFixture(),probe=f.dependencies.tlsProbe;let count=0;
  f.dependencies.tlsProbe=(...args)=>args[2]==='/login'?(count++,Promise.resolve({status:502})):probe(...args);
  await assert.rejects(()=>recovery.verifyConfiguration(f.candidate,f.input,f.dependencies),{message:'readiness-timeout'});
  assert.equal(count,5);assert.equal(f.stages.at(-1).name,'recovery-restored-sync-login');
  const canceled=restoredConfigurationFixture();canceled.candidate.canceled=true;
  await assert.rejects(()=>recovery.verifyConfiguration(canceled.candidate,canceled.input,canceled.dependencies),{message:'canceled-or-overall-timeout'});
  assert.equal(canceled.requests.length,0);
});
test('restored configuration Fetch rejects missing or invalid application data at its own checkpoint',async()=>{
  for(const response of [{status:404,body:'private-missing-config-response'},{status:200,body:'private-malformed-json'},{status:200,body:JSON.stringify({data:null})}]){
    const f=restoredConfigurationFixture(),probe=f.dependencies.tlsProbe;let fetch=0;
    f.dependencies.tlsProbe=(...args)=>args[2]==='/config/main'?(fetch++,Promise.resolve(response)):probe(...args);
    await assert.rejects(()=>recovery.verifyConfiguration(f.candidate,f.input,f.dependencies),{message:'recovery-restored-configuration-fetch-failed'});
    assert.equal(fetch,1);assert.equal(f.stages.at(-1).name,'recovery-restored-configuration-fetch');
    assert(!JSON.stringify(f.stages).includes('private-'));
  }
});

function coldSeedFixture(t,failure){
  const input=fixture(t),events=[],stages=[];
  const candidate={daemon:'owned-daemon',results:stages,now:()=>0,checkpoint:()=>{},stage:require('./disposable-candidate').Candidate.prototype.stage,
    inner:async(args,options)=>{
      const kind=args.includes('stop.sh')?'runner-stop':args.includes('harvest.sh')?'harvest':'manifest-current';events.push(kind);
      if(kind==='harvest')assert.deepEqual(options.failureCodes,recovery.HARVEST_FAILURE_CODES);
      if(kind===failure?.step)throw Object.assign(Error(failure.message||'private-upstream-error'),failure.metadata);
      return kind==='manifest-current'?'/seed/snapshots/completed-fixture':'';
    },call:async(args,options)=>{events.push('archive');assert.equal(options.outputFile,input.seedArchive);if(failure?.step==='archive')throw Object.assign(Error('private-upstream-error'),failure.metadata);return '';}};
  return {input,candidate,events,stages};
}
test('cold Seed capture journals runner stop, actual Harvest, completed manifest and binary archive independently',async t=>{
  const f=coldSeedFixture(t);await recovery.captureSeed(f.candidate,f.input);
  assert.deepEqual(f.events,['runner-stop','harvest','manifest-current','archive']);
  assert.deepEqual(f.stages.map(stage=>stage.name),f.events.map(name=>'recovery-seed-'+name));
  assert(f.stages.every(stage=>stage.status==='passed'));
  assert.equal(f.input.configHash,recovery.hashFile(f.input.configArchive));assert.equal(f.input.seedHash,recovery.hashFile(f.input.seedArchive));
});
test('the fresh readonly manifest helper preserves the harvested image check without inheriting controller environment',async t=>{
  const f=coldSeedFixture(t),seed=path.join(f.input.directory,'seed'),snapshot=path.join(seed,'snapshots/completed');
  for(const directory of ['srv','ssl','letsencrypt'])fs.mkdirSync(path.join(snapshot,directory),{recursive:true});
  const manifest=require('../../system/seed-manifest').create(snapshot);
  manifest.gitlabImage='candidate-gitlab:under-test';
  fs.writeFileSync(path.join(snapshot,'manifest.json'),JSON.stringify(manifest));
  fs.symlinkSync('snapshots/completed',path.join(seed,'current'));
  const env={...process.env};delete env.GITLAB_IMAGE;
  const execute=environment=>require('child_process').spawnSync(process.execPath,
    [path.join(__dirname,'../../system/seed-manifest.js'),'current',seed],{env:environment,encoding:'utf8'});
  assert.notEqual(execute(env).status,0,'a fresh helper really refuses an undeclared harvested image');
  const inner=f.candidate.inner;
  f.candidate.inner=async(args,options)=>{
    if(!args.includes('/system/system/seed-manifest.js'))return inner(args,options);
    for(let index=0;index<args.length-1;index++)if(args[index]==='--env'){
      const match=/^([A-Z_]+)=(.*)$/.exec(args[++index]);if(match)env[match[1]]=match[2];
    }
    const actual=execute(env);
    assert.equal(actual.status,0,'the command must pass its expected image to the unchanged real verifier');
    assert.equal(env.GITLAB_IMAGE,manifest.gitlabImage);
    return actual.stdout.trim().replace(seed,'/seed');
  };
  await recovery.captureSeed(f.candidate,f.input);
});
test('cold Seed failures identify each command and do not attempt later operations',async t=>{
  const order=['runner-stop','harvest','manifest-current','archive'];
  for(const step of order){
    const f=coldSeedFixture(t,{step,metadata:{exitCode:23,systemCode:'ETIMEDOUT'}});
    await assert.rejects(()=>recovery.captureSeed(f.candidate,f.input),error=>{
      assert.equal(error.message,'recovery-seed-'+step+'-failed');assert.equal(error.exitCode,23);assert.equal(error.systemCode,'ETIMEDOUT');return true;
    });
    assert.deepEqual(f.events,order.slice(0,order.indexOf(step)+1));
    assert.equal(f.stages.at(-1).exitCode,23);assert.equal(f.stages.at(-1).systemCode,'ETIMEDOUT');
    assert(!JSON.stringify(f.stages).includes('private-upstream-error'));
  }
});
test('fixed Harvest failure codes identify internal phases without exposing arbitrary output',async t=>{
  const {failureReason}=require('./stage-diagnostics');
  const script=fs.readFileSync(path.join(__dirname,'../../system/harvest.sh'),'utf8');
  for(const [line,code]of Object.entries(recovery.HARVEST_FAILURE_CODES)){
    assert.equal(failureReason(code),code);
    if(line.startsWith('Harvest phase failed: '))assert(script.includes('phase='+line.slice('Harvest phase failed: '.length,-1)));
    else assert(script.includes(line));
    const f=coldSeedFixture(t,{step:'harvest',message:code,metadata:{exitCode:1}});
    await assert.rejects(()=>recovery.captureSeed(f.candidate,f.input),{message:code});
    assert.equal(f.stages.at(-1).reason,code);assert.deepEqual(f.events,['runner-stop','harvest']);
  }
});
