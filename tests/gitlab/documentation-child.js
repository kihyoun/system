'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {DocumentationCheckService}=require('../../operations/dist/ci/documentation.service');
const {ManagedChildProcess}=require('../../operations/dist/runtime/managed-child');
function fixture(t,directory=os.tmpdir()){
 const root=fs.mkdtempSync(path.join(directory,'documentation-native-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 fs.mkdirSync(path.join(root,'gitlab'));fs.copyFileSync(path.join(__dirname,'../../gitlab/check-documentation.js'),path.join(root,'gitlab/check-documentation.js'));
 git('init','-q','-b','master');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 const commit=()=>{git('add','-A');git('commit','-qm','Fixture');return git('rev-parse','HEAD');};
 fs.writeFileSync(path.join(root,'old'),'historical-only');commit();const old=git('rev-parse','HEAD:old');git('rm','old');
 fs.writeFileSync(path.join(root,'README.md'),'# Guide\n');const base=commit();
 fs.appendFileSync(path.join(root,'README.md'),'\nInstructions.\n');const head=commit();
 git('remote','add','origin','https://private-marker@example.invalid/repository');git('config','http.extraHeader','private-header');
 const env={...process.env,CI_PROJECT_ID:'21',CI_JOB_ID:'90001',CI_COMMIT_SHA:head,CI_PIPELINE_SOURCE:'merge_request_event',CI_MERGE_REQUEST_DIFF_BASE_SHA:base,CI_JOB_TOKEN:'sensitive-marker'};
 const calls=[],native=new ManagedChildProcess(),received=path.join(root,'received');let exists=false,status='0',create=[];
 const mode={};
 const adapter={async run(binary,args,options){
  if(binary!=='docker')return native.run(binary,args,options);
  calls.push([...args]);
  const a=args[0]==='--config'?args.slice(2):args;
  if(a[0]==='container'&&a[1]==='ls'){if(mode.offline)throw Error('daemon-offline');return exists?'system-documentation-21-90001':'';}
  if(a[0]==='container'&&a[1]==='inspect')return JSON.stringify([{Id:'a'.repeat(64),Config:{Labels:{'org.system-bootstrapper.documentation-job':mode.foreign?'foreign':'21:90001'}}}]);
  if(a[0]==='container'&&a[1]==='rm'){if(mode.removeFail)throw Error('remove-failed');exists=false;return '';}
  if(a[0]==='create'){assert.equal(fs.readdirSync(args[1]).length,0);create=a;exists=true;return '';}
  if(a[0]==='cp'){
   if(a[1].startsWith('system-documentation-'))fs.cpSync(path.join(received,'test-results/documentation'),a[2],{recursive:true});
   else {fs.rmSync(received,{recursive:true,force:true});fs.cpSync(a[1],received,{recursive:true});}
   return '';
  }
  if(a[0]==='start'){
   const selected={};for(let i=0;i<create.length;i++)if(create[i]==='--env'){const [key,...value]=create[++i].split('=');selected[key]=value.join('=');}
   assert.equal(JSON.stringify(selected).includes('sensitive-marker'),false);
   assert.equal(Object.keys(selected).length,7);
   const program=`const fs=require('fs');fs.mkdirSync('test-results/documentation',{recursive:true});try{const r=require('./checker').check();fs.writeFileSync('test-results/documentation/report.json',JSON.stringify({status:'passed',...r}));}catch(e){fs.writeFileSync('test-results/documentation/report.json',JSON.stringify({status:'failed',reason:e.message}));process.exitCode=1;}`;
   try{await native.run(process.execPath,['-e',program],{cwd:received,env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',...selected},timeout:10000});status='0';}catch{status='1';}
   return '';
  }
  if(a[0]==='wait')return mode.status||status;
  if(['pull','logs'].includes(a[0]))return '';
  throw Error('unexpected-docker-call');
 }};
 return {root,env,git,commit,old,received,calls,mode,service:new DocumentationCheckService(adapter)};
}
test('real Git snapshots reach isolated documentation child without private worktree or history',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'README.md'),'dirty private data');
 await f.service.execute(f.root,f.env);
 assert.equal(fs.existsSync(path.join(f.received,'README.md')),false);
 assert.doesNotMatch(fs.readFileSync(path.join(f.received,'.git/config'),'utf8'),/private|remote/);
 assert.equal(fs.existsSync(path.join(f.received,'.git/hooks')),false);
 assert.throws(()=>execFileSync('git',['-C',f.received,'cat-file','-e',f.old],{stdio:'pipe'}));
 const create=f.calls.find(a=>a.includes('create'));
 for(const [key,value]of [['--network','none'],['--memory','256m'],['--user','1000:1000'],['--cap-drop','ALL']])assert.equal(create[create.indexOf(key)+1],value);
 assert.equal(create.some(x=>['--volume','--mount','--privileged'].includes(x)),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'test-results/documentation/report.json'))).revision,f.env.CI_COMMIT_SHA);
 for(const extra of [{CI_PIPELINE_SOURCE:'push',CI_COMMIT_BEFORE_SHA:'0'.repeat(40)},{CI_PIPELINE_SOURCE:'web'}])await f.service.execute(f.root,{...f.env,...extra});
});
test('actual whitespace failure exports diagnostics; cleanup never masks failure',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'README.md'),'# Broken whitespace \n');f.env.CI_COMMIT_SHA=f.commit();
 f.mode.foreign=true;f.mode.status='7';
 await assert.rejects(f.service.execute(f.root,f.env),error=>error.status===7);
 assert.match(JSON.parse(fs.readFileSync(path.join(f.root,'test-results/documentation/report.json'))).reason,/diff --check failed/);
 assert.equal(f.calls.some(a=>a[1]==='rm'),false);
});
test('Git snapshot export handles common objects on another filesystem',async t=>{
 const directory='/dev/shm';
 try{
  fs.accessSync(directory,fs.constants.W_OK);
  if(fs.statSync(directory).dev===fs.statSync(os.tmpdir()).dev)return t.skip('distinct writable filesystem unavailable');
 }catch{return t.skip('distinct writable filesystem unavailable');}
 const f=fixture(t,directory),worktree=fs.mkdtempSync(path.join(os.tmpdir(),'documentation-worktree-'));
 t.after(()=>fs.rmSync(worktree,{recursive:true,force:true}));
 f.git('worktree','add','--quiet','--detach',worktree,f.env.CI_COMMIT_SHA);
 assert.notEqual(fs.statSync(f.root).dev,fs.statSync(worktree).dev);
 await f.service.execute(worktree,f.env);
 assert.equal(JSON.parse(fs.readFileSync(path.join(worktree,'test-results/documentation/report.json'))).status,'passed');
 assert.equal(fs.readdirSync(path.join(f.root,'.git/objects')).some(name=>name.startsWith('documentation-check-')),false);
});
test('invalid identities or diff bases refuse child; cleanup distinguishes absence from failure',async t=>{
 const f=fixture(t);
 for(const extra of [{CI_COMMIT_SHA:'b'.repeat(40)},{CI_MERGE_REQUEST_DIFF_BASE_SHA:''},{CI_PROJECT_ID:'21:22'},{CI_JOB_ID:'../foreign'}])
  await assert.rejects(f.service.execute(f.root,{...f.env,...extra}));
 assert.equal(f.calls.some(a=>a.includes('create')||a[0]==='pull'),false);
 await f.service.execute(f.root,f.env,true);
 f.mode.offline=true;await assert.rejects(f.service.execute(f.root,f.env,true),/daemon-offline/);
 f.mode.offline=false;f.mode.removeFail=true;await assert.rejects(f.service.execute(f.root,f.env),/remove-failed/);
});
