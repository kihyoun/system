'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawnSync,spawn}=require('node:child_process');
const {test}=require('node:test');
const acme=require('../e2e/local-acme');
const {LABEL}=require('./disposable-candidate');
function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'local-acme-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const archive=path.join(directory,'client.tar');fs.writeFileSync(archive,Buffer.from([0,255,128,10]));
  const images=Object.fromEntries(['pebble','dns','certbot'].map((role,n)=>[role,{reference:acme.PINNED[role],id:'sha256:'+String(n+1).repeat(64)}]));
  Object.assign(images.certbot,{archive,sha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')});
  const spec={acmeImages:images,images:{wizard:{id:'sha256:'+'5'.repeat(64)}}};
  return {directory,archive,spec};
}
function owners(f,options={}){
  const calls=[],instances=[];
  const original={id:'a'.repeat(24),name:'system-candidate-'+'a'.repeat(24),daemon:'a'.repeat(64),spec:f.spec,deadline:12345,canceled:false,
    stage:async(name,action)=>{calls.push({stage:name});return action();},wait:async action=>{assert(await action());},
    inner:async(args,input)=>{calls.push({inner:args,input});return JSON.stringify({status:200,body:'{}'});}};
  class Owner{
    constructor(spec){this.spec=spec;this.id=String(instances.length+1).repeat(24);this.name='system-candidate-'+this.id;this.resources=[];instances.push(this);}
    report(){calls.push({report:this.id});}
    async create(kind,args){calls.push({create:kind,args});const id=kind==='volume'?this.name:this.id.repeat(2)+'0'.repeat(16);this.resources.push({kind,id,name:this.name});return id;}
    async start(){throw Error('heavy Candidate.start must never be used');}
    async call(args,input){calls.push({args,input});return this.exec(args);}
    exec(args){
      if(args[0]==='image'){const item=Object.values(f.spec.acmeImages).find(image=>image.reference===args.at(-1));return JSON.stringify({Id:item.id,RepoDigests:[item.reference],Config:{Volumes:options.imageVolumes}});}
      if(args[0]==='wait')return '0';
      if(args[0]==='inspect')return JSON.stringify({[instances[0].name]:{IPAddress:'172.29.0.'+(instances.indexOf(this)+2)}});
      if(args[0]==='container'&&args[1]==='ls')return original.daemon;
      if(args[0]==='container'&&args[1]==='inspect')return JSON.stringify([{Id:original.daemon,Name:'/'+original.name,Config:{Labels:{[LABEL]:options.foreign?'foreign':original.id}},NetworkSettings:{Networks:{[instances[0].name]:{}}}}]);
      return '';
    }
    cleanup(){calls.push({cleanup:this.id});return !options.cleanupFailure;}
  }
  const instance=new acme.LocalAcme(original,()=>f.directory,{Owner,scripts:{lease:'echo actual-lease-source',install:'echo actual-install-source'}});
  return {original,instance,calls,instances};
}
test('ACME inputs require exact public pins, a regular verified client archive and the exact fixture trust',t=>{
  const f=fixture(t);assert.equal(acme.validate(f.spec).images.certbot.archive,f.archive);
  for(const role of ['pebble','dns','certbot']){
    const images={...f.spec.acmeImages,[role]:{...f.spec.acmeImages[role],reference:'unreviewed:latest'}};
    assert.throws(()=>acme.validate({...f.spec,acmeImages:images}),/pinned-image/);
  }
  fs.appendFileSync(f.archive,'tampered');assert.throws(()=>acme.validate(f.spec),/archive-identity/);
});
test('ACME client archive symlinks and altered trust certificates are rejected',t=>{
  const f=fixture(t),link=path.join(f.directory,'link.tar');fs.symlinkSync(f.archive,link);
  const images={...f.spec.acmeImages,certbot:{...f.spec.acmeImages.certbot,archive:link}};
  assert.throws(()=>acme.validate({...f.spec,acmeImages:images}),/archive-identity/);
  const trust=path.join(f.directory,'untrusted.pem');fs.writeFileSync(trust,'foreign trust');
  assert.throws(()=>acme.validate(f.spec,trust),/trust-identity/);
});
test('image preparation pulls only declared pinned public inputs and hashes only the explicit client archive',t=>{
  const f=fixture(t),calls=[];
  const images=require('../e2e/prepare-acme-images').prepare(f.directory,{run(args){calls.push(args);if(args[0]==='image')fs.writeFileSync(args[3],Buffer.from([0,255,129]));},
    inspect(reference){return {Id:Object.values(f.spec.acmeImages).find(image=>image.reference===reference).id,RepoDigests:[reference]};}});
  assert.deepEqual(calls.filter(args=>args[0]==='pull').map(args=>args[1]),Object.values(acme.PINNED));
  assert.equal(calls.filter(args=>args[0]==='image').length,1);assert.equal(fs.statSync(images.certbot.archive).mode&0o777,0o600);
  assert.equal(images.certbot.sha256,acme.hashFile(images.certbot.archive));assert(!images.pebble.archive);assert(!images.dns.archive);
});
test('independent CA/DNS owners journal only bounded tiny resources with no public ports, socket or validation bypass',async t=>{
  const f=fixture(t),x=owners(f);await x.instance.start();
  const containers=x.calls.filter(call=>call.create==='container');assert.equal(containers.length,3);
  for(const {args}of containers){
    assert(!args.includes('--privileged'));assert(!args.includes('-p'));assert(!args.includes('--publish'));assert(!args.some(arg=>arg.includes('docker.sock')));
    assert(args.includes('--memory'));assert(args.includes('--pull')&&args.includes('never'));
    assert(!args.some(arg=>arg.includes('PEBBLE_VA_ALWAYS_VALID')));
  }
  const ca=containers.find(call=>call.args.includes(acme.PINNED.pebble)).args;
  const dns=containers.find(call=>call.args.includes(acme.PINNED.dns)).args;
  assert.equal(Number(ca[ca.indexOf('--memory')+1].slice(0,-1))+Number(dns[dns.indexOf('--memory')+1].slice(0,-1)),256);
  assert(ca.includes('PEBBLE_AUTHZREUSE=0'));assert(ca.includes('-dnsserver'));
  const init=containers.find(call=>call.args.includes('python')).args;
  assert(init.includes('/etc/letsencrypt')&&init.includes('/var/lib/letsencrypt'),'declared client VOLUMES cannot create anonymous outer volumes');
  assert(init.includes('none'));
  assert.equal(acme.pebbleConfiguration().pebble.httpPort,80);
  assert.equal(acme.pebbleConfiguration().pebble.tlsPort,443);
  assert(x.instances.every(owner=>owner.deadline===x.original.deadline&&owner.spec.fullAcceptance===false));
  x.original.canceled=true;assert(x.instances.every(owner=>owner.canceled));
});
test('bridge attachment proves exact candidate identity before mutation',async t=>{
  const f=fixture(t),x=owners(f,{foreign:true});await x.instance.start();
  await assert.rejects(()=>x.instance.attach(x.original),/foreign-candidate/);
  assert(!x.calls.some(call=>call.args?.[0]==='network'&&call.args?.[1]==='connect'));
});
test('unowned image-declared outer volumes fail before any resource creation',async t=>{
  const f=fixture(t),x=owners(f,{imageVolumes:{'/unexpected-anonymous-volume':{}}});
  await assert.rejects(()=>x.instance.start(),/unowned-image-volume/);
  assert(!x.calls.some(call=>call.create));
});
test('owned bridge attaches both sequential hosts to one retained authority',async t=>{
  const f=fixture(t),x=owners(f);await x.instance.start();
  await x.instance.attach(x.original);
  assert.equal(x.instance.attachments[0],x.original);
  const connection=x.calls.find(call=>call.args?.[0]==='network'&&call.args?.[1]==='connect');
  assert.equal(connection.args[2],x.instances[0].name);assert.equal(connection.args[3],x.original.daemon);
  assert(x.calls.filter(call=>call.create==='network').every(call=>call.args.includes('--internal')));
});
test('cleanup works after cancellation but refuses to detach a foreign daemon',async t=>{
  const f=fixture(t),x=owners(f,{foreign:true});x.instance.attachments.push(x.original);x.original.canceled=true;
  assert.equal(x.instance.cleanup(),false);assert(!x.calls.some(call=>call.cleanup));
  const clean=owners(f);clean.instance.attachments.push(clean.original);clean.original.canceled=true;
  assert.equal(clean.instance.cleanup(),true);
  assert.deepEqual(clean.calls.filter(call=>call.cleanup).map(call=>call.cleanup),clean.instances.map(owner=>owner.id).reverse());
});
test('fixture cleanup failure retains the authority dependencies for targeted recovery',t=>{
  const f=fixture(t),x=owners(f,{cleanupFailure:true});
  assert.equal(x.instance.cleanup(),false);
  assert.equal(x.calls.filter(call=>call.cleanup).length,1);
});
test('host integration uses real source scripts and a Docker-only Certbot transport with isolated trust',t=>{
  const f=fixture(t),x=owners(f);
  const script=acme.hostProgram(acme.basePaths('/recovered-data/platform'),'172.29.0.2',acme.PINNED.certbot,x.instance.scripts);
  assert.equal(spawnSync('bash',['-n'],{input:script}).status,0);
  assert(script.includes('actual-lease-source'));assert(script.includes('actual-install-source'));
  assert(script.includes('REQUESTS_CA_BUNDLE=/fixture-tools/pebble.minica.pem'));
  assert(script.includes('--deploy-hook'));assert(script.includes('/recovered-data/platform/ssl/acme-http01'));
  assert(!script.includes('--no-verify-ssl'));assert(!script.includes('--dry-run'));assert(!script.includes('acme-v02.api.letsencrypt.org'));
  assert.throws(()=>acme.basePaths('/srv/production'),/owned-data-root/);
});
test('negative HTTP validation must fail before real renewal can establish evidence',async t=>{
  const f=fixture(t),x=owners(f),events=[];
  const expected={account:'pebble/dir/account',keyHash:'private-key-fingerprint',serial:'AA',certificateHash:'before'};
  x.instance.attach=async()=> '172.29.0.4';x.instance.prepareClient=async()=>{};
  let identities=0;x.instance.identity=async()=>++identities===1?expected:{...expected,serial:'BB',certificateHash:'after'};
  x.instance.certbot=async()=>{events.push('renew');if(events.length===1)throw Object.assign(Error('actual HTTP validation failed'),{exitCode:1});};
  const candidate={stage:async(_name,action)=>action(),wait:async action=>{assert(await action());},evidence:{recovery:{acmeRenewalVerified:false}},inner:async(args,input)=>{
    if(args[0]==='inspect')return JSON.stringify({bridge:{Gateway:'127.0.0.1'}});
    return JSON.stringify({status:200,body:'<html>renewed</html>',serial:'BB'});
  }};
  await x.instance.renew(candidate,expected);assert.equal(events.length,2);assert(candidate.acmeRenewalVerified);assert(candidate.evidence.recovery.acmeRenewalVerified);
  x.instance.certbot=async()=>{};identities=0;candidate.acmeRenewalVerified=false;
  await assert.rejects(()=>x.instance.renew(candidate,expected),/validation-bypass/);assert.equal(candidate.acmeRenewalVerified,false);
  identities=0;let attempt=0;
  x.instance.certbot=async()=>{if(++attempt===1)throw Object.assign(Error('actual HTTP validation failed'),{exitCode:1});};
  const stale={...candidate,acmeRenewalVerified:false,wait:async action=>{if(!await action())throw Error('fresh-certificate-not-served');},inner:async(args,input)=>{
    if(args[0]==='inspect')return JSON.stringify({bridge:{Gateway:'127.0.0.1'}});
    return JSON.stringify({status:200,body:'<html>old certificate</html>',serial:'AA'});
  }};
  await assert.rejects(()=>x.instance.renew(stale,expected),/fresh-certificate-not-served/);assert.equal(stale.acmeRenewalVerified,false);
});
test('the independent authority HTTPS client validates its trust and SNI without a bypass',async t=>{
  const f=fixture(t),https=require('node:https'),cert=path.join(f.directory,'cert.pem'),key=path.join(f.directory,'key.pem');
  const wrong=path.join(f.directory,'wrong.pem'),wrongKey=path.join(f.directory,'wrong.key');
  for(const [certificate,privateKey]of [[cert,key],[wrong,wrongKey]]){
    const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=pebble','-addext','subjectAltName=DNS:pebble','-keyout',privateKey,'-out',certificate],{stdio:'ignore'});assert.equal(result.status,0);
  }
  const server=https.createServer({cert:fs.readFileSync(cert),key:fs.readFileSync(key)},(req,res)=>{assert.equal(req.socket.servername,'pebble');assert.equal(req.headers['user-agent'],'system-bootstrapper-local-acme-test');res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const candidate={inner:async(args,options)=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['-e',args.at(-1)],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',part=>output+=part);child.stderr.resume();
    child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(Error('authority-TLS-rejected')));child.stdin.end(options.input);
  })};
  const url='https://pebble:'+server.address().port+'/dir';
  assert.equal((await acme.request(candidate,url,{trust:fs.readFileSync(cert,'utf8'),address:'127.0.0.1'})).status,200);
  await assert.rejects(()=>acme.request(candidate,url,{trust:fs.readFileSync(wrong,'utf8'),address:'127.0.0.1'}),/TLS-rejected/);
});
