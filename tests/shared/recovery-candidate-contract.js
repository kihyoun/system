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
