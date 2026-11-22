const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {ContainerCheckService}=require('../../dist/modules/ci/containerCheck.service');
const {ManagedChildProcess}=require('../../dist/common/runtime/managedChild');
function fixture(t, browser=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'container-check-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const context=path.join(root,browser?'.wizard-browser-context':'.test-context');fs.mkdirSync(context);
 fs.writeFileSync(path.join(context,'context.tar'),'archive');
 fs.writeFileSync(path.join(context,'sha256'),createHash('sha256').update('archive').digest('hex'));
 fs.writeFileSync(path.join(context,'revision'),'a'.repeat(40));
 return {root,env:{CI_PROJECT_ID:'1',CI_JOB_ID:'2',CI_COMMIT_SHA:'a'.repeat(40)}};
}
test('isolated checks pass only component selection into a socket-free child',async t=>{
 const {root,env}=fixture(t),calls=[];
 const adapter={async run(binary,args,options){calls.push({args,options});return args[0]==='wait'?'0':'';}};
 await new ContainerCheckService(adapter).execute('isolated',root,env,'sync');
 const create=calls.find(c=>c.args.includes('create')).args;
 assert.equal(create.at(-1),'sync');assert.equal(create[create.indexOf('--network')+1],'none');
 assert.equal(create.includes('--volume'),false);assert.equal(create.includes('--privileged'),false);
 assert.ok(calls.find(c=>c.args[0]==='build').options.inputFile.endsWith('/context.tar'));
 assert.equal(calls.filter(c=>c.args[1]==='ls').length,4);
});
test('collision refuses build and does not clean existing resources',async t=>{
 const {root,env}=fixture(t),calls=[];
 await assert.rejects(new ContainerCheckService({async run(binary,args){calls.push(args);return 'system-tests-1-2';}})
  .execute('isolated',root,env,'sync'),/already-exists/);
 assert.equal(calls.length,1);
});
test('build failure retains redacted stderr and the original status while cleaning',async t=>{
 const {root,env}=fixture(t),calls=[],failure=Error('build-exit-two');
 env.CI_JOB_TOKEN='private-job-token';
 const printed=[],previous=console.error;console.error=value=>printed.push(value);t.after(()=>{console.error=previous;});
 const adapter={async run(binary,args,options){calls.push(args);
  if(args[0]==='build'){
   const bytes=Buffer.from('Compiler 한국어: missing module\nprivate-job-token https://user:password@example.invalid/\n');
   options.output(bytes.subarray(0,14));options.output(bytes.subarray(14));throw failure;
  }return '';
 }};
 await assert.rejects(new ContainerCheckService(adapter).execute('isolated',root,env,'sync'),e=>e===failure);
 const log=fs.readFileSync(path.join(root,'test-results/cleanup/build.log'),'utf8');
 assert.match(log,/Compiler 한국어: missing module/);assert.match(log,/\[REDACTED\]/);
 assert.equal(log.includes('private-job-token'),false);assert.equal(log.includes('user:password'),false);
 assert.equal(printed.join('').includes('private-job-token'),false);
 assert.equal(calls.some(args=>args.includes('create')),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'test-results/cleanup/on-exit.json'))).status,'passed');
 // Exercise the real process adapter stopping mid-credential at its byte bound.
 const native=new ManagedChildProcess(),limit=1024*1024;
 const bounded={async run(binary,args,options){if(args[0]==='build')return native.run(process.execPath,['-e',
  'process.stdout.write("x".repeat('+String(limit-env.CI_JOB_TOKEN.length+1)+')+process.env.CI_JOB_TOKEN.slice(0,-1));setTimeout(()=>process.stdout.write(process.env.CI_JOB_TOKEN.slice(-1)),100);'
 ],options);return '';}};
 await assert.rejects(new ContainerCheckService(bounded).execute('isolated',root,env,'sync'));
 const boundedLog=fs.readFileSync(path.join(root,'test-results/cleanup/build.log'),'utf8');
 assert.equal(boundedLog.includes(env.CI_JOB_TOKEN.slice(0,-1)),false);
 assert.ok(Buffer.byteLength(boundedLog)<=limit);
 assert.equal(printed.join('').includes(env.CI_JOB_TOKEN.slice(0,-1)),false);
});
test('failed browser wait still exports reports and retains original failure',async t=>{
 const {root,env}=fixture(t,true),calls=[],failure=Error('wait-lost');
 const adapter={async run(binary,args,options){calls.push({args,options});if(args[0]==='wait')throw failure;return '';}};
 await assert.rejects(new ContainerCheckService(adapter).execute('wizard-browser',root,env,'run'),e=>e===failure);
 const copy=calls.find(c=>c.args[0]==='cp');assert.ok(copy);assert.equal(copy.options.signal,undefined);
 assert.match(fs.readFileSync(path.join(root,'test-results/wizard-browser/junit.xml'),'utf8'),/failures="1"/);
});
test('successful browser process without report is a failure',async t=>{
 const {root,env}=fixture(t,true);
 await assert.rejects(new ContainerCheckService({async run(binary,args){return args[0]==='wait'?'0':'';}})
  .execute('wizard-browser',root,env,'run'),/missing-junit/);
});
test('cleanup verifies all ownership labels before removal',async t=>{
 const {root,env}=fixture(t),calls=[];
 const adapter={async run(binary,args){calls.push(args);
  if(args[1]==='ls')return args[0]==='container'?'system-tests-1-2':'';
  if(args[1]==='inspect')return JSON.stringify([{Id:'b'.repeat(64),Config:{Labels:{'org.system-bootstrapper.test-job':'2'}}}]);return '';
 }};
 await assert.rejects(new ContainerCheckService(adapter).execute('isolated',root,env,'cleanup'),/owner-mismatch/);
 assert.equal(calls.some(args=>args[1]==='rm'),false);
});
test('invalid identities and stale, damaged or missing archives fail before Docker',async t=>{
 const {root,env}=fixture(t);let calls=0;
 const service=new ContainerCheckService({async run(){calls++;return '';}});
 for(const override of [{CI_JOB_ID:'../foreign'},{CI_COMMIT_SHA:'b'.repeat(40)}])
  await assert.rejects(service.execute('isolated',root,{...env,...override},'sync'));
 fs.writeFileSync(path.join(root,'.test-context/sha256'),'0'.repeat(64));
 await assert.rejects(service.execute('isolated',root,env,'sync'),/checksum/);
 fs.rmSync(path.join(root,'.test-context/context.tar'));
 await assert.rejects(service.execute('isolated',root,env,'sync'));
 assert.equal(calls,0);
});
test('daemon errors and cleanup failures remain failures; primary error wins',async t=>{
 const {root,env}=fixture(t);
 await assert.rejects(new ContainerCheckService({async run(){throw Error('daemon-offline');}})
  .execute('isolated',root,env,'cleanup'),/daemon-offline/);
 for(const waitFails of [false,true]){
  let started=false;
  const primary=Error('original-wait-failure');
  const adapter={async run(binary,args){
   if(args[0]==='start')started=true;
   if(args[0]==='wait'){if(waitFails)throw primary;return '0';}
   if(args[1]==='ls'&&started)throw Error('cleanup-unavailable');
   return '';
  }};
  await assert.rejects(new ContainerCheckService(adapter).execute('isolated',root,env,'sync'),
   error=>waitFails ? error===primary : error.message==='cleanup-unavailable');
 }
});
test('browser image retains reviewed trust and the full native browser suite',()=>{
 const dockerfile=fs.readFileSync(path.join(__dirname,'../wizard-browser.Dockerfile'),'utf8');
 assert.ok(dockerfile.includes('playwright install-deps chromium')&&dockerfile.includes('playwright install chromium'));
 assert.ok(dockerfile.includes('ENV NODE_OPTIONS=--use-openssl-ca'));
 const bundle=dockerfile.indexOf('sha256sum -c -'),install=dockerfile.indexOf('RUN npm ci');
 assert.ok(bundle>=0&&install>bundle,'reviewed CA validation must precede dependency installation');
 const dependencies=dockerfile.indexOf('playwright install-deps chromium');
 const refresh=dockerfile.indexOf('system-bootstrapper host-bootstrap refresh-ca --checkout /candidate',dependencies);
 const checked=dockerfile.indexOf('system-bootstrapper host-bootstrap ca-check --checkout /candidate',refresh);
 const browser=dockerfile.indexOf('playwright install chromium',dependencies);
 assert.ok(dependencies>=0&&refresh>dependencies&&checked>refresh&&browser>checked,'dependency trust changes must be replaced and verified before browser installation');
 assert.ok(dockerfile.includes('"browser-suite"')&&dockerfile.includes('--reporter=list,html,junit'));
 assert.equal(dockerfile.includes('--grep'),false);
});
test('candidate image uses the same lifecycle and invokes typed runtime validation',async t=>{
 const {root,env}=fixture(t);fs.renameSync(path.join(root,'.test-context'),path.join(root,'.candidate-context'));
 const calls=[];
 const adapter={async run(binary,args,options){calls.push({args,options});
  if(args[0]==='wait')return '0';
  if(args[0]==='image'&&args[1]==='inspect')return 'sha256:'+'c'.repeat(64);
  return '';
 }};
 await new ContainerCheckService(adapter).execute('candidate-image',root,env,'run');
 const create=calls.find(c=>c.args.includes('create')).args;
 assert.equal(create[create.indexOf('--entrypoint')+1],'node');
 assert.equal(create[create.indexOf('--memory')+1],'1g');
 assert.equal(create.at(-2),'candidate-runtime');
 assert.equal(calls.some(c=>c.args[0]==='cp'),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'test-results/candidate-image/image.json'))).revision,env.CI_COMMIT_SHA);
 assert.match(fs.readFileSync(path.join(root,'test-results/candidate-image/junit.xml'),'utf8'),/failures="0"/);
});
