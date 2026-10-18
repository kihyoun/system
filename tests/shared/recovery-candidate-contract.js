'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {test}=require('node:test');
const recovery=require('../e2e/recovery');

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
  const input=fixture(t),calls=[];
  const candidate={spec:{restore:input},daemon:'owned-private-daemon',call:async(args,options)=>{calls.push({args,options});return '';},inner:async(args,options)=>{calls.push({args,options});return args.includes('source /state/.docker.env; printf "%s" "${WIZARD_IMAGE:-systembootstrapper/wizard}"')?'systembootstrapper/wizard':'';}};
  await recovery.bootstrapRestore(candidate,{rewriter:'print("public fixture only")'});
  assert(!calls.some(call=>call.args[0]==='cp'),'no Docker cp binary transport');
  const uploads=calls.filter(call=>call.options?.inputFile);
  assert.deepEqual(uploads.map(call=>call.options.inputFile),[input.configArchive,input.seedArchive]);
  assert(!calls.some(call=>call.options?.input && Buffer.isBuffer(call.options.input)),'archive bytes never buffered into JSON input');
  const seed=calls.findIndex(call=>call.args.includes('seed.sh'));
  const normalCreate=calls.findIndex(call=>call.args[0]==='create'&&!call.args.includes('--entrypoint'));
  assert(seed>=0&&normalCreate>seed,'restore completes before normal controller creation');
  const initialCreate=calls.find(call=>call.args[0]==='create');
  assert(initialCreate.args.includes('/bin/sh')&&initialCreate.args.includes('sleep infinity'));
  assert(initialCreate.args.includes(recovery.SEED+':/seed'));
  assert(initialCreate.args.includes(recovery.BASE+'/host/letsencrypt:/host-letsencrypt'));
  assert(!initialCreate.args.some(arg=>arg.includes('/candidate-data/platform')),'old live paths never mounted');
  const python=calls.find(call=>call.args.includes('/opt/gitlab/embedded/bin/python3'));
  assert(python.args.includes('candidate-gitlab:under-test')&&python.args.includes('--network'));
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
      '-addext','subjectAltName=DNS:wizard.candidate.test','-keyout',privateKey,'-out',certificate],{stdio:'ignore'});
  }
  const server=https.createServer({cert:fs.readFileSync(cert),key:fs.readFileSync(key)},(req,res)=>{assert.equal(req.headers.host.split(':')[0],'wizard.candidate.test');res.end('verified synthetic TLS');});
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
  await assert.rejects(()=>recovery.tlsProbe(candidate,'wrong.candidate.test','/',{},connection),/tls-rejected/);
  await assert.rejects(()=>recovery.tlsProbe(candidate,'wizard.candidate.test','/',{},{...connection,certificate:foreignCert}),/tls-rejected/);
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
  await assert.rejects(()=>recovery.bootstrapRestore(candidate,{rewriter:'public fixture'}),/wizard-pin-recovery-artifact-not-declared/);
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
  const candidate={spec:{restore:input,privateWizardRecovery:true,images:f.images},daemon:'owned-private-daemon',call:async(args,options)=>{calls.push({args,options});return '';},inner:async(args,options)=>{
    calls.push({args,options});if(args[0]==='image')throw Error('absent image');
    return args.includes('source /state/.docker.env; printf "%s" "${WIZARD_IMAGE:-systembootstrapper/wizard}"')?f.expected.imageRef:'';
  }};
  await recovery.bootstrapRestore(candidate,{rewriter:'public source fixture'});
  assert.deepEqual(calls.filter(call=>call.args[0]==='image').map(call=>call.args.at(-1)),[f.expected.imageRef,f.expected.imageId]);
  assert(calls.some(call=>call.args[0]==='create'&&!call.args.includes('--entrypoint')));
  assert(!calls.some(call=>call.args.some(arg=>arg===f.expected.imageRef)&&call.args[0]==='tag'),'the test must not manufacture a cached pin');
});
test('an already cached private layer fails acceptance before normal platform startup',async t=>{
  const input=fixture(t),f=privateFixture(),calls=[];input.expected.privateWizard=f.expected;
  const candidate={spec:{restore:input,privateWizardRecovery:true,images:f.images},daemon:'owned-private-daemon',call:async()=>'',inner:async args=>{
    calls.push(args);return args.includes('source /state/.docker.env; printf "%s" "${WIZARD_IMAGE:-systembootstrapper/wizard}"')?f.expected.imageRef:'cached image';
  }};
  await assert.rejects(()=>recovery.bootstrapRestore(candidate),/image-already-cached/);
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
  const candidate={id:'c'.repeat(24),evidence:{projectId:12,pipelineId:21},rails:async()=>({token:'private-fixture-token',root_id:1}),
    stage:async(name,action)=>{try{const value=await action();stages.push({name,status:'passed'});return value;}catch(error){stages.push({name,status:'failed',reason:error.message});throw error;}},
    api:async(route,token,method='GET',body)=>{
      assert.equal(token,'private-fixture-token');requests.push({route,method});
      if(route===failRoute)throw Error('private-upstream-body-token-must-not-escape');
      if(route==='/projects/12')return {default_branch:'main',path_with_namespace:'root/recovery'};
      if(route==='/projects/12/repository/branches/main')return {commit:{id:sha}};
      if(route==='/projects/12/pipelines/21')return {status:'success',sha};
      if(route==='/projects/12/issues'){assert.equal(method,'POST');return {iid:7};}
      if(route==='/projects/12/variables'){assert.equal(method,'POST');return {};}
      if(route==='/users'){assert.equal(method,'POST');return {id:9,username:body.username};}
      if(route==='/projects/12/registry/repositories')return [{id:14,path:'root/recovery/probe'}];
      if(route==='/projects/12/registry/repositories/14/tags/'+sha)return {digest};
      if(route==='/personal_access_tokens/self'){assert.equal(method,'DELETE');return null;}
      throw Error('unexpected API route');
    }};
  return {candidate,requests,stages,sha,digest};
}
test('identity capture uses the documented project-scoped tag endpoint and journals every data boundary',async()=>{
  const f=identityFixture();const result=await recovery.recordIdentity(f.candidate);
  assert.equal(result.registryDigest,f.digest);assert.equal(result.imageCommit,f.sha);assert.equal(result.registryId,14);
  assert(f.requests.some(item=>item.route==='/projects/12/registry/repositories/14/tags/'+f.sha));
  assert(!f.requests.some(item=>item.route.startsWith('/registry/repositories/')));
  assert.deepEqual(f.stages.map(item=>item.name),['credential','project','repository-head','pipeline','issue','encrypted-variable','user','registry-repositories','registry-tag','credential-revoked'].map(name=>'recovery-identity-'+name));
  assert(f.stages.every(item=>item.status==='passed'));
});
test('capture failures identify the precise operation, revoke credentials and suppress upstream private errors',async()=>{
  for(const [route,label]of [['/projects/12','project'],['/projects/12/issues','issue'],['/projects/12/registry/repositories/14/tags/'+'a'.repeat(40),'registry-tag']]){
    const f=identityFixture(route);
    await assert.rejects(()=>recovery.recordIdentity(f.candidate),new RegExp('recovery-identity-'+label+'-failed'));
    assert(f.requests.some(item=>item.route==='/personal_access_tokens/self'&&item.method==='DELETE'));
    assert(f.stages.some(item=>item.name==='recovery-identity-'+label&&item.status==='failed'));
    assert(!JSON.stringify(f.stages).includes('private-'));
  }
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
