'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {spawnSync,spawn}=require('node:child_process');
const fixture=require('../e2e/guided-preview-platform');
const acme=require('../e2e/local-acme');
const runner='concurrent = 1\n\n[[runners]]\n  name = "runner-docker-1"\n  url = "http://gitlab/"\n  token = "retained-test-token"\n  clone_url = "http://gitlab/"\n  [runners.cache]\n    MaxUploadedArchiveSize = 0\n  [runners.docker]\n    image = "docker:reviewed"\n    volumes = ["/var/run/docker.sock:/var/run/docker.sock", "/cache"]\n    privileged = true\n    shm_size = 0\n';
function platform(){
  const calls=[],stages=[];
  const settings={version:1,namespace:'root',wizard:{mode:'import',project:'wizard-source',origin:'https://github.com/example/wizard.git'},
    review:{enabled:true,host:fixture.HOSTS.review,ssl:fixture.LEAF,sslKey:fixture.KEY},
    beta:{enabled:true,host:fixture.HOSTS.beta,ssl:fixture.LEAF,sslKey:fixture.KEY}};
  const candidate={id:'a'.repeat(24),daemon:'b'.repeat(64),spec:{fullAcceptance:true,guidedPreviewAcceptance:true,guidedPreviewSettings:settings,
    sourceRevision:'c'.repeat(40),sourceTree:'d'.repeat(40),wizardSourceRevision:'e'.repeat(40),
    images:{candidate:{id:'sha256:'+'1'.repeat(64)},wizard:{id:'sha256:'+'2'.repeat(64)}}},
    stage:async(name,action)=>{stages.push(name);return action();},
    wait:async action=>{assert(await action());},
    inner:async(args,options)=>{
      calls.push({inner:args,options});
      if(args.includes('-subject_hash'))return '1234abcd';
      if(args[0]==='exec'&&args[1]==='runner_docker_1'&&args[2]==='cat')return runner;
      if(args.includes('http://127.0.0.1/-/readiness'))return '{"status":"ok"}';
      if(args.includes('cat'))return 'fixture-private-bootstrap-input';
      return '';
    },
    call:async(args,options)=>{calls.push({call:args,options});return '';},
    rails:async(script)=>{calls.push({rails:script});return {id:9,tags:['docker','wizard-source-primary']};}};
  const authority={original:candidate,ready:true,issue:async(actual,options)=>{
    assert.equal(actual,candidate);calls.push({issue:options});return {serial:'AA',account:'fixture',keyHash:'retained',certificateHash:'leaf'};}};
  const dependencies={node:async(actual,action,input)=>{
    assert.equal(actual,candidate);calls.push({node:action.toString(),input});
    if(input.root)return {root:'-----BEGIN CERTIFICATE-----\npublic fixture root\n-----END CERTIFICATE-----\n',
      bundle:'public Mozilla bundle plus fixture root\n',rootSha256:'f'.repeat(64),publicBundleSha256:'0'.repeat(64)};
  },tlsProbe:async(actual,host,route,options,connection)=>{
    assert.equal(actual,candidate);assert.equal(connection.certificate,acme.ISSUANCE_CA);calls.push({probe:{host,route}});return {status:200};}};
  return {candidate,authority,dependencies,calls,stages};
}
test('fixture TLS uses one existing authority and extends its exact owned SANs',async()=>{
  const f=platform(),result=await fixture.prepare(f.candidate,f.authority,f.dependencies);
  assert.deepEqual(result.domains,['wizard.candidate.test','sync.candidate.test','alias.candidate.test','gitlab.candidate.test','review.candidate.test','beta.candidate.test']);
  assert.equal(f.calls.filter(call=>call.issue).length,1);
  assert.equal(f.candidate.guidedAcmeIdentity.serial,'AA');
  assert.equal(f.calls.filter(call=>call.probe).length,3);
  const configure=f.calls.find(call=>call.inner?.includes('/system/gitlab')).inner;
  assert(configure.includes('start.sh'),'the native committed GitLab configuration entrypoint is required');
  const tls=f.calls.find(call=>call.input?.settings).input;
  assert.equal(tls.settings.GITLAB_EXTERNAL_URL,'https://gitlab.candidate.test');
  assert.equal(tls.settings.GITLAB_DOMAIN_MODE,'2');
  assert(!Object.hasOwn(tls.settings,'GITLAB_REGISTRY_URL'));
  assert(!Object.hasOwn(tls.settings,'WIZARD_IMAGE'));assert(!Object.hasOwn(tls.settings,'BOOTSTRAPPER_IMAGE'));
  const recording=f.calls.find(call=>call.inner?.includes('/system/bootstrapper/record-source-installation.js')).inner;
  for(const value of [f.candidate.spec.sourceRevision,f.candidate.spec.sourceTree,f.candidate.spec.wizardSourceRevision,
    f.candidate.spec.images.candidate.id,f.candidate.spec.images.wizard.id])assert(recording.includes(value));
  assert.equal(f.stages.at(-1),'guided-preview-native-source-installation-record');
});
test('runner trust adds only a read-only public bundle and preserves native endpoints, image, token and producer bytes',()=>{
  const result=fixture.runnerTrust(runner);
  assert.equal(fixture.runnerTrust(result),result,'runner trust setup must be idempotent');
  for(const line of runner.split('\n').filter(line=>line&&!line.includes('volumes')))assert(result.includes(line));
  assert(result.includes(fixture.TRUST+':'+fixture.JOB_TRUST+':ro'));
  for(const name of ['SSL_CERT_FILE','GIT_SSL_CAINFO','CURL_CA_BUNDLE','NODE_EXTRA_CA_CERTS','REQUESTS_CA_BUNDLE'])assert(result.includes(name+'='+fixture.JOB_TRUST));
  assert(!result.includes('/ssl:'));assert(!result.includes('privkey'));assert(!result.includes('SSL_NO_VERIFY'));
  assert(!result.includes('pre_build_script'));assert(!result.includes('.gitlab/'));
  assert.throws(()=>fixture.runnerTrust(runner+'\n[[runners]]\n'),/single-managed-runner/);
  assert.throws(()=>fixture.runnerTrust(runner.replace('  name =','  environment = ["SSL_CERT_FILE=/unrelated"]\n  name =')),/trust-conflict/);
});
test('trust setup remains inside the owned daemon and installs public union trust without disabling validation',async()=>{
  const f=platform();await fixture.prepare(f.candidate,f.authority,f.dependencies);
  for(const call of f.calls.filter(call=>call.call)){
    assert.equal(call.call[0],'exec');assert.equal(call.call[2],f.candidate.daemon);
    assert(!call.call.includes('--privileged'));assert(!call.call.includes('docker.sock'));
    assert(!call.options.input.includes('fixture-private-bootstrap-input'));
  }
  const trust=f.calls.find(call=>call.input?.root);
  assert(!trust.node.includes('appendFileSync'));
  assert(trust.node.includes('publicBundle.trimEnd()'));assert(trust.node.includes('certificate.verify(certificate.publicKey)'));
  assert(!trust.node.includes('rejectUnauthorized:false'));
  assert(!f.calls.some(call=>JSON.stringify(call).includes('NODE_TLS_REJECT_UNAUTHORIZED')));
});
test('restored daemon recreates the same public trust path before jobs resume',async()=>{
  const f=platform();await fixture.restoreTrust(f.candidate,f.dependencies);
  assert.deepEqual(f.stages,['guided-preview-restored-public-trust']);
  assert(f.calls.some(call=>call.call?.at(-1)===fixture.TRUST));
  assert(!f.calls.some(call=>call.issue||call.rails||call.inner?.includes('record-source-installation.js')));
});
test('supplementary hashed trust preserves the exact public CA gate and supports verified native Node TLS',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'guided-trust-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const certificate=path.join(directory,'ca.pem'),key=path.join(directory,'ca.key');
  const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=Owned fixture root',
    '-addext','basicConstraints=critical,CA:TRUE','-addext','subjectAltName=DNS:fixture.local','-keyout',key,'-out',certificate],{stdio:'ignore'});
  assert.equal(result.status,0);
  const root=fs.readFileSync(certificate,'utf8'),bundle=fs.readFileSync(path.join(__dirname,'../../bootstrapper/ca/cacert-2026-10-20.crt'),'utf8');
  const hash=spawnSync('openssl',['x509','-subject_hash','-noout'],{input:root,encoding:'utf8'});
  assert.equal(hash.status,0);const subjectHash=hash.stdout.trim();
  const publicBundleSha256=require('../../gitlab/security-release.json').jobCaBundleSha256;
  const anchors=path.join(directory,'anchors'),empty=path.join(directory,'empty');fs.mkdirSync(anchors);fs.mkdirSync(empty);
  const canonical=path.join(anchors,'ca-certificates.crt');fs.writeFileSync(canonical,bundle);
  fs.symlinkSync('existing-unrelated-anchor.pem',path.join(anchors,subjectHash+'.0'));
  fixture.installAnchor({root,subjectHash,publicBundleSha256,directory:anchors});
  assert.equal(fs.readFileSync(canonical,'utf8'),bundle);
  const link=fs.readlinkSync(path.join(anchors,subjectHash+'.1'));assert(link.startsWith('guided-preview-'));
  fixture.installAnchor({root,subjectHash,publicBundleSha256,directory:anchors});
  assert(!fs.existsSync(path.join(anchors,subjectHash+'.2')),'repeat installation retains the exact anchor');
  const server=require('node:https').createServer({cert:root,key:fs.readFileSync(key)},(_request,response)=>response.end('verified'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const check=path.resolve(__dirname,'../../bootstrapper/ca/check.js');
  const program="const proof=require(process.argv[1]).system();require('https').get({hostname:'fixture.local',port:Number(process.argv[2]),lookup:(_host,options,done)=>options.all?done(null,[{address:'127.0.0.1',family:4}]):done(null,'127.0.0.1',4)},response=>{response.resume();response.on('end',()=>process.stdout.write(JSON.stringify({...proof,status:response.statusCode})));}).on('error',error=>{process.stderr.write(error.code||'tls-failed');process.exitCode=1;});";
  const run=certDirectory=>new Promise(resolve=>{
    const env={...process.env,NODE_OPTIONS:'--use-openssl-ca',SSL_CERT_FILE:canonical,SSL_CERT_DIR:certDirectory};delete env.NODE_EXTRA_CA_CERTS;
    const child=spawn(process.execPath,['-e',program,check,String(server.address().port)],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);child.on('close',code=>resolve({code,stdout,stderr}));
  });
  const trusted=await run(anchors);assert.equal(trusted.code,0,trusted.stderr);
  const proof=JSON.parse(trusted.stdout);assert.equal(proof.status,200);assert.equal(proof.bundleSha256,publicBundleSha256);
  assert(proof.systemCertificates>50&&proof.nodeCertificates>50);
  const untrusted=await run(empty);assert.equal(untrusted.code,1,'removing supplementary trust must reject the fixture TLS issuer');
  fs.appendFileSync(canonical,'altered');assert.throws(()=>fixture.installAnchor({root,subjectHash,publicBundleSha256,directory:anchors}));
});
test('invalid fixture ownership/settings fail before mutations and bootstrap private temporaries are removed on failure',async()=>{
  for(const change of [
    f=>{f.candidate.spec.fullAcceptance=false;},
    f=>{f.candidate.spec.sourceTree='invalid';},
    f=>{f.candidate.spec.guidedPreviewSettings.review.host='live.example.com';},
    f=>{f.authority.original={};},
    f=>{f.authority.ready=false;},
  ]){
    const f=platform();change(f);await assert.rejects(()=>fixture.prepare(f.candidate,f.authority,f.dependencies));assert.equal(f.calls.length,0);
  }
  const f=platform(),original=f.candidate.inner;
  f.candidate.inner=async(args,options)=>{
    if(args.some(value=>value.endsWith('/openssl')))throw Error('issuance-bootstrap-failed');return original(args,options);
  };
  await assert.rejects(()=>fixture.prepare(f.candidate,f.authority,f.dependencies),/issuance-bootstrap-failed/);
  assert(f.calls.some(call=>call.inner?.includes('rm')&&call.inner.includes('/tmp/.guided-bootstrap-key')));
  assert(!f.calls.some(call=>call.issue));
});
test('additional ACME SANs stay within the disposable DNS namespace',()=>{
  assert(acme.issuanceDomains(['gitlab.candidate.test','wizard.candidate.test']).includes('gitlab.candidate.test'));
  for(const domains of [['live.example.com'],['*.candidate.test'],['127.0.0.1'],['https://gitlab.candidate.test']])assert.throws(()=>acme.issuanceDomains(domains),/owned-certificate-domains/);
});
test('binding proof validates actual source-primary receipts and both stopped generations without returning configuration',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'guided-binding-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const binding=require('../../project-bootstrap/wizard-source-primary/binding');
  const source=require('../../project-bootstrap/wizard-environments/source-primary');
  const state=require('../../project-bootstrap/wizard-environments/state');
  const sha=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
  const operation='a'.repeat(48),settings={review:{enabled:true,host:fixture.HOSTS.review},beta:{enabled:true,host:fixture.HOSTS.beta}};
  const ciFiles=[{path:'.gitlab/primary.yml',sha256:'b'.repeat(64)},{path:'.gitlab/delivery/environment.sh',sha256:'c'.repeat(64)}];
  const environment={version:1,managementMode:'source-primary',phase:'ready',operation,settings,settingsHash:sha(JSON.stringify(settings)),
    helperImage:'sha256:'+'d'.repeat(64),controller:'system_bootstrapper_1',activationCommit:'e'.repeat(40),ciFiles,deployments:{}};
  environment.recipeHash=source.reservation(environment).recipeHash;
  for(const [index,kind]of ['review','beta'].entries()){
    const stopped={...state.record({action:'deploy',kind,projectId:7,pipelineId:20+index,jobId:40+index,
      sourceCommit:'f'.repeat(40),mrIid:kind==='review'?3:0,operation},settings[kind].host,'registry.candidate.test/root/wizard@sha256:'+'1'.repeat(64)),state:'stopped'};
    environment.deployments[kind]={tombstone:stopped,lastPipelineId:stopped.pipelineId,stoppedThroughPipelineId:stopped.pipelineId};
  }
  const receipt={defaultProject:true,template:'wizard',state:'complete',namespaceId:4,
    repository:{id:7,namespaceId:4,path:'root/wizard',defaultBranch:'master',systemProject:true,managementMode:'source-primary',ciPath:'.gitlab/primary.yml'},
    sourcePrimary:{version:1,operation,adoptionCommit:'e'.repeat(40),ciFiles},wizardWorkflow:{environments:environment}};
  const filename=path.join(directory,'.wizard.env'),cube=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8').slice(0,1184);
  let text;
  const save=value=>{text=cube+'\n'+binding.PREFIX+Buffer.from(JSON.stringify(value)).toString('base64')+'\n';fs.writeFileSync(filename,text);};
  save(receipt);
  const execute=async(_candidate,action,input)=>vm.runInNewContext('('+action.toString()+')',{require(name){
    if(name==='/system/project-bootstrap/wizard-source-primary/binding')return {...binding,read:()=>binding.read(filename)};
    if(name==='/system/project-bootstrap/wizard-environments/source-primary')return source;
    if(name==='/system/project-bootstrap/wizard-environments/state')return state;
    if(name==='fs')return {readFileSync:()=>fs.readFileSync(filename,'utf8')};return require(name);
  }})(input);
  const result=await fixture.bindingProof({}, {node:execute});
  assert.equal(result.projectId,7);assert.equal(result.operation,operation);assert.equal(result.receiptSha256,sha(JSON.stringify(receipt)));
  fs.writeFileSync(filename,text+'\n# Retained configuration formatting\n');
  assert.equal((await fixture.bindingProof({}, {node:execute})).receiptSha256,result.receiptSha256);
  assert.equal(result.settingsSha256,sha(JSON.stringify(settings)));
  assert.equal(Object.keys(result).sort().join(','),'operation,projectId,receiptSha256,settingsSha256');
  for(const change of [
    value=>{value.repository.managementMode='managed';},
    value=>{value.sourcePrimary.adoptionCommit='invalid';},
    value=>{value.wizardWorkflow.environments.deployments.review.active={};},
    value=>{value.wizardWorkflow.environments.deployments.beta.pending={};},
    value=>{delete value.wizardWorkflow.environments.deployments.beta.tombstone;},
    value=>{value.wizardWorkflow.environments.deployments.review.stoppedThroughPipelineId=0;},
    value=>{value.wizardWorkflow.environments.deployments.beta.lastPipelineId=0;},
    value=>{value.wizardWorkflow.environments.deployments.review.tombstone.projectId=8;},
    value=>{value.wizardWorkflow.environments.deployments.beta.tombstone.operation='2'.repeat(48);},
  ]){
    const changed=JSON.parse(JSON.stringify(receipt));change(changed);save(changed);
    await assert.rejects(()=>fixture.bindingProof({}, {node:execute}));
  }
});
