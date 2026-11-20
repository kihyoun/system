const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {PlatformCheckService}=require('../dist/ci/platform.service');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ci-platform-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'tests/e2e'),{recursive:true});
 fs.writeFileSync(path.join(root,'tests/e2e/prepare-images.js'),"exports.identifiers=()=>({candidate:'owned-image'});");
 return root;
}
test('platform failure still cleans up owned images and preserves primary failure',async t=>{
 const root=fixture(t), calls=[], primary=Error('candidate-failed');
 const service=new PlatformCheckService({async run(binary,args,options){
  calls.push({binary,args,options});
  if(args.includes('.candidate-images/spec.json'))throw primary;
  if(args[0]==='image'&&args[1]==='ls')return 'image-id';
  if(args[0]==='image'&&args[1]==='inspect')return JSON.stringify([{Config:{Labels:{'org.system-bootstrapper.test-job':'7'}}}]);
  return '';
 }});
 await assert.rejects(service.execute(root,{CI_JOB_ID:'7'}),error=>error===primary);
 assert(calls.some(c=>c.args.includes('cleanup-all')));
 assert(calls.some(c=>c.args.join(' ')==='image rm owned-image'));
 assert(!calls.some(c=>c.args.includes('gitlab/publish-successor.js')));
});
test('cleanup refuses foreign images and runs despite an aborted main signal',async t=>{
 const root=fixture(t),calls=[],abort=new AbortController();abort.abort();
 const service=new PlatformCheckService({async run(binary,args,options){
  calls.push({args,options});
  if(args[0]==='image'&&args[1]==='ls')return 'image-id';
  if(args[0]==='image'&&args[1]==='inspect')return JSON.stringify([{Config:{Labels:{'org.system-bootstrapper.test-job':'8'}}}]);
  return '';
 }});
 await assert.rejects(service.execute(root,{CI_JOB_ID:'7'},true,abort.signal),/owner-mismatch/);
 assert(calls.every(c=>c.options.signal===undefined));
 assert(!calls.some(c=>c.args[1]==='rm'));
});
