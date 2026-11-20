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
