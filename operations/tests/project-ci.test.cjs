const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {EnvironmentLauncherService}=require('../dist/project-ci/environment-launcher.service');
const {BrowserCheckService}=require('../dist/project-ci/browser-check.service');
const image='sha256:'+'a'.repeat(64),operation='b'.repeat(48),id='c'.repeat(64);
const env={SYSTEM_WIZARD_ENVIRONMENT_IMAGE:image,SYSTEM_WIZARD_ENVIRONMENT_OPERATION:operation,CI_PROJECT_ID:'1',CI_PIPELINE_ID:'2',CI_JOB_ID:'3',CI_COMMIT_SHA:'d'.repeat(40),CI_MERGE_REQUEST_IID:'4'};
function fixture(mode){const calls=[];const port={run:async(binary,args,options)=>{calls.push({binary,args,options});if(args[0]==='create'){if(mode==='occupied')throw Error('name occupied');return id;}if(args[0]==='container')return `${id} ${mode==='foreign'?'foreign':image} ${operation}`;if(args[0]==='start'&&mode==='failed')throw Error('helper failed');return '';}};return{calls,service:new EnvironmentLauncherService(port)};}
test('project environment rejects invalid identity before Docker',async()=>{const f=fixture();await assert.rejects(f.service.run('stop','review',{...env,SYSTEM_WIZARD_ENVIRONMENT_IMAGE:'latest'}),/Immutable/);assert.equal(f.calls.length,0);});
test('occupied helper name never authorizes cleanup',async()=>{const f=fixture('occupied');await assert.rejects(f.service.run('stop','review',env),/occupied/);assert(!f.calls.some(c=>['stop','rm','container'].includes(c.args[0])));});
test('helper cleanup requires exact immutable image and ownership',async()=>{const f=fixture('foreign');await assert.rejects(f.service.run('stop','review',env),/ownership/);assert(!f.calls.some(c=>['stop','rm'].includes(c.args[0])));});
test('failed helper still drains owned ID using independent cleanup budget',async()=>{const f=fixture('failed');await assert.rejects(f.service.run('stop','review',env),/helper failed/);const stop=f.calls.find(c=>c.args[0]==='stop');assert.deepEqual(stop.args,['stop','--time','120',id]);assert.equal(stop.options.signal,undefined);assert.equal(stop.options.timeout,130000);assert.deepEqual(f.calls.at(-1).args,['rm','-f',id]);});
for(const fail of [false,true])test(`browser ${fail?'failure':'success'} cancels preview and preserves diagnostic log`,async t=>{
const root=fs.mkdtempSync(path.join(os.tmpdir(),'browser-ci-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const name of ['build/index.html','build-tools/export-configuration.cjs']){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),'artifact');}
let cancelled=false;const port={run:(binary,args,options)=>{if(binary==='npm'){assert.equal(options.env.WIZARD_BASE_URL,'http://127.0.0.1:4173');return fail?Promise.reject(Error('browser failed')):Promise.resolve('');}options.output(Buffer.from('preview diagnostic'));return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{cancelled=true;reject(Error('stopped'));},{once:true}));}};
const service=new BrowserCheckService(port,{ready:async()=>true,sleep:async()=>{}});
if(fail)await assert.rejects(service.run(root,{}),/browser failed/);else await service.run(root,{});
assert(cancelled);assert.equal(fs.readFileSync(path.join(root,'test-results/preview.log'),'utf8'),'preview diagnostic');
});
test('native diagnostic callback preserves bounded stdout and stderr',async()=>{
 const {ManagedChildProcess}=require('../dist/runtime/managed-child');const chunks=[];
 await new ManagedChildProcess().run(process.execPath,['-e','process.stdout.write("out");process.stderr.write("err")'],{cwd:process.cwd(),env:process.env,timeout:5000,output:chunk=>chunks.push(chunk.toString())});
 assert.equal(chunks.join('').split('').sort().join(''),'eorrtu');
});

const {spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'../../wizard/.gitlab/runtime/project-ci.cjs');
function isolated(t,args,env={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'portable-project-ci-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const script=path.join(directory,'project-ci.cjs');
  fs.copyFileSync(source,script);
  return spawnSync(process.execPath,[script,...args],{cwd:directory,env:{PATH:path.dirname(process.execPath),...env},encoding:'utf8',timeout:15000});
}
test('portable shared Nest runtime starts without source checkout or installed dependencies',t=>{
 const result=isolated(t,['mirror']);
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/skip/i);
});
test('portable environment boundary rejects mutable helper identity before native execution',t=>{
 const result=isolated(t,['environment','deploy','review'],{SYSTEM_WIZARD_ENVIRONMENT_IMAGE:'latest'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/Immutable/);
 assert.doesNotMatch(result.stderr,/Cannot find module|ENOENT/);
});
test('portable browser boundary requires prepared source artifacts',t=>{
 const result=isolated(t,['browser']);
 assert.equal(result.status,1);
 assert.doesNotMatch(result.stderr,/Cannot find module/);
});
test('portable artifact carries reproducible package notices without checkout paths',()=>{
 const content=fs.readFileSync(source,'utf8');
 assert.doesNotMatch(content,/\/home\/codex\//);
 const licenses=fs.readFileSync(path.join(path.dirname(source),'LICENSES.txt'),'utf8');
 for(const pkg of ['@nestjs/core@12.5.1','@nestjs/common@12.5.1','reflect-metadata@0.2.2','rxjs@7.8.2']) assert(licenses.includes(pkg),pkg);
});
const {DeliveryService}=require('../dist/project-ci/delivery.service');
const {DeliverySessionService}=require('../dist/project-ci/delivery-session.service');
const deliveryEnv={CI_PROJECT_ID:'1',CI_PIPELINE_ID:'2',CI_JOB_ID:'3',CI_COMMIT_SHA:'d'.repeat(40),CI_REGISTRY_IMAGE:'registry.example/group/project',CI_REGISTRY:'registry.example',CI_REGISTRY_USER:'job',CI_REGISTRY_PASSWORD:'private'};
function deliveryFixture(t,mode='success'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-ci-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[];let builder='';
 const port={run:async(binary,raw,options)=>{const args=raw.slice(2);calls.push({args,options});
  if(args[0]==='login'){assert.equal(options.input,'private\n');assert.equal(fs.statSync(raw[1]).mode&0o777,0o700);return '';}
  if(args[0]==='buildx'&&args[1]==='create'){builder=args[3];if(mode==='uncertain')throw Error('create uncertain');return builder;}
  if(args[0]==='buildx'&&args[1]==='inspect')return builder;
  if(args[0]==='image'&&args[1]==='inspect'){if(args[3].includes('RepoDigests'))return deliveryEnv.CI_REGISTRY_IMAGE+'@sha256:'+'f'.repeat(64);return 'sha256:'+(mode==='replaced'&&calls.filter(call=>call.args[0]==='image'&&call.args[1]==='inspect').length>2?'e':'a').repeat(64);}
  if(args[0]==='push'&&mode==='push-failed')throw Error('push failed');
  return '';
 }};
 return{root,calls,service:new DeliveryService(new DeliverySessionService(port))};
}
test('delivery preserves immutable evidence and exact owned cleanup',async t=>{
 const f=deliveryFixture(t);await f.service.build(f.root,deliveryEnv);
 const evidence=JSON.parse(fs.readFileSync(path.join(f.root,'build-evidence.json')));assert.equal(evidence.sourceCommit,deliveryEnv.CI_COMMIT_SHA);assert.equal(evidence.imageRef,deliveryEnv.CI_REGISTRY_IMAGE+'@sha256:'+'f'.repeat(64));assert.equal(evidence.testRunner,'vitest');
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'cleanup.json'))).status,'passed');assert(f.calls.some(call=>call.args[0]==='image'&&call.args[1]==='rm'));assert(f.calls.some(call=>call.args[0]==='buildx'&&call.args[1]==='rm'&&call.options.signal===undefined));
});
test('delivery source mismatch rejects before native mutation',async t=>{
 const f=deliveryFixture(t);await assert.rejects(f.service.build(f.root,{...deliveryEnv,SYSTEM_WIZARD_EXPECTED_SHA:'e'.repeat(40)}),/binding/);assert.equal(f.calls.length,0);
});
test('uncertain builder creation retains resource and fails cleanup evidence',async t=>{
 const f=deliveryFixture(t,'uncertain');await assert.rejects(f.service.build(f.root,deliveryEnv),/create uncertain/);assert(!f.calls.some(call=>call.args.includes('rm')));const report=JSON.parse(fs.readFileSync(path.join(f.root,'cleanup.json')));assert.equal(report.status,'failed');assert.match(report.errors[0],/Uncertain/);
});
test('failed registry push still cleans owned resources without publishing evidence',async t=>{
 const f=deliveryFixture(t,'push-failed');await assert.rejects(f.service.build(f.root,deliveryEnv),/push failed/);assert(f.calls.some(call=>call.args[0]==='image'&&call.args[1]==='rm'));assert(!fs.existsSync(path.join(f.root,'image.env')));
});
test('delivery cleanup refuses replaced image tag and fails the job',async t=>{
 const f=deliveryFixture(t,'replaced');await assert.rejects(f.service.build(f.root,deliveryEnv),/identity changed/);assert(!f.calls.some(call=>call.args[0]==='image'&&call.args[1]==='rm'));
});
test('candidate verification keeps diagnostics and drains exact resources on browser success or failure',async t=>{
 for(const failBrowser of [false,true]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-verify-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const calls=[],identities=new Map();let builder='',owner='',browser='';
  const port={run:async(binary,raw,options)=>{const args=raw.slice(2);calls.push({args,options});
   if(args[0]==='buildx'&&args[1]==='create'){builder=args[3];return builder;}
   if(args[0]==='buildx'&&args[1]==='inspect')return builder;
   if(args[0]==='network'&&args[1]==='create'){owner=args[4].split('=')[1];identities.set(args.at(-1),'b'.repeat(64));return 'b'.repeat(64);}
   if(args[0]==='create'){const name=args[args.indexOf('--name')+1];const id=(name.endsWith('-app')?'c':'d').repeat(64);identities.set(name,id);if(name.endsWith('-browser'))browser=id;return id;}
   if(args[1]==='inspect'){if(args[3].includes('Labels'))return owner;return args[0]==='image'?'sha256:'+'a'.repeat(64):identities.get(args.at(-1));}
   if(args[0]==='start'&&args[1]==='-a'&&failBrowser)throw Error('browser assertion failed');
   if(args[0]==='cp')fs.writeFileSync(path.join(root,'browser-evidence/browser.json'),'{}');
   return '';
  }};
  const service=new DeliveryService(new DeliverySessionService(port));
  const input={...deliveryEnv,WIZARD_IMAGE_REF:deliveryEnv.CI_REGISTRY_IMAGE+'@sha256:'+'f'.repeat(64)};
  if(failBrowser)await assert.rejects(service.verify(root,input),/browser assertion failed/);else await service.verify(root,input);
  assert(fs.existsSync(path.join(root,'browser-evidence/browser.json')));
  assert.equal(fs.existsSync(path.join(root,'wizard-evidence.json')),!failBrowser);
  assert(calls.some(c=>c.args[0]==='cp'&&c.options.signal===undefined));
  assert(calls.some(c=>c.args[0]==='rm'&&c.args[1]===browser));
  assert(calls.some(c=>c.args[0]==='network'&&c.args[1]==='rm'&&c.args[2]==='b'.repeat(64)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'cleanup.json'))).status,'passed');
 }
});
