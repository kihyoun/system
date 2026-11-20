const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {CodeqlParentService}=require('../../operations/dist/ci/codeql-parent.service');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codeql-parent-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const context=path.join(root,'.codeql-context');fs.mkdirSync(context);
 const bytes=Buffer.from('source archive');
 fs.writeFileSync(path.join(context,'context.tar'),bytes);
 fs.writeFileSync(path.join(context,'sha256'),crypto.createHash('sha256').update(bytes).digest('hex'));
 fs.writeFileSync(path.join(context,'revision'),'a'.repeat(40));
 fs.writeFileSync(path.join(context,'manifest.json'),'{}');
 return {root,env:{CI_PROJECT_ID:'1',CI_JOB_ID:'2',CI_COMMIT_SHA:'a'.repeat(40)}};
}
test('static scanner keeps isolated child, file stdin and owned cleanup',async t=>{
 const {root,env}=fixture(t),calls=[];
 const adapter={async run(binary,args,options){calls.push({binary,args,options});
  if(args[0]==='wait')return '0\n';
  if(args[1]==='ls')return args[0]==='container'?'system-codeql-1-2':'system-codeql:ci-1-2';
  if(args[1]==='inspect')return JSON.stringify([{Id:'b'.repeat(64),Config:{Labels:{'org.system-bootstrapper.codeql-job':'1:2'}}}]);
  return '';
 }};
 await new CodeqlParentService(adapter).execute(root,env);
 const build=calls.find(c=>c.args.includes('build'));
 assert.equal(build.options.inputFile,path.join(root,'.codeql-context/context.tar'));
 const create=calls.find(c=>c.args.includes('create')).args;
 assert.equal(create[create.indexOf('--network')+1],'none');
 assert.equal(create.includes('/var/run/docker.sock'),false);
 assert.equal(calls.filter(c=>c.args[1]==='rm').length,2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'test-results/codeql/cleanup-on-exit.json'))).status,'passed');
});
test('archive mismatch refuses Docker execution',async t=>{
 const {root,env}=fixture(t);fs.appendFileSync(path.join(root,'.codeql-context/context.tar'),'changed');
 let calls=0;
 await assert.rejects(new CodeqlParentService({async run(){calls++;return '';}}).execute(root,env),/checksum-mismatch/);
 assert.equal(calls,0);
});
test('wait failure preserves original error and still collects evidence and cleans',async t=>{
 const {root,env}=fixture(t),calls=[],failure=Error('daemon-disconnected');
 const adapter={async run(binary,args,options){calls.push({args,options});if(args[0]==='wait')throw failure;return '';}};
 await assert.rejects(new CodeqlParentService(adapter).execute(root,env),e=>e===failure);
 assert.equal(calls.filter(c=>c.args[0]==='cp').length,3);
 assert.equal(calls.filter(c=>c.args[1]==='ls').length,2);
 assert.ok(calls.filter(c=>c.args[0]==='cp').every(c=>c.options.signal===undefined));
});
test('cleanup refuses resources with a foreign ownership label',async t=>{
 const {root,env}=fixture(t),calls=[];
 const adapter={async run(binary,args){calls.push(args);
  if(args[1]==='ls')return args[0]==='container'?'system-codeql-1-2':'';
  if(args[1]==='inspect')return JSON.stringify([{Id:'b'.repeat(64),Config:{Labels:{'org.system-bootstrapper.codeql-job':'different'}}}]);return '';
 }};
 await assert.rejects(new CodeqlParentService(adapter).execute(root,env,true),/owner-mismatch/);
 assert.equal(calls.some(args=>args[1]==='rm'),false);
});
test('successful scan cannot hide missing evidence or cleanup failure',async t=>{
 for(const failedCommand of ['cp','cleanup']) {
  const {root,env}=fixture(t);let started=false;
  const adapter={async run(binary,args){
   if(args[0]==='start')started=true;
   if(args[0]==='wait')return '0';
   if(args[0]==='cp'&&failedCommand==='cp')throw Error('missing-evidence');
   if(args[1]==='ls'&&started&&failedCommand==='cleanup')throw Error('cleanup-unavailable');
   return '';
  }};
  await assert.rejects(new CodeqlParentService(adapter).execute(root,env),/missing-evidence|cleanup-unavailable/);
 }
});
