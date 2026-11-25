'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {validateNpmPublication:validate}=require('../../dist/modules/release');
const bytes=Buffer.from('accepted package fixture');
const revision='a'.repeat(40),tree='b'.repeat(40);
const env={GITLAB_CI:'true',NPM_PUBLISH_ENABLED:'true',CI_COMMIT_REF_PROTECTED:'true',CI_PIPELINE_SOURCE:'push',CI_COMMIT_BRANCH:'master',CI_DEFAULT_BRANCH:'master',CI_COMMIT_SHA:revision,CI_PIPELINE_ID:'42'};
const receipt={format:'system-cli-source-v1',name:'@systembootstrapper/cli',version:'2.0.0',sourceRevision:revision,sourceTree:tree,pipelineId:42,packageJobId:17,filename:'systembootstrapper-cli-2.0.0.tgz',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),integrity:'sha512-'+crypto.createHash('sha512').update(bytes).digest('base64')};
const metadata={format:'system-accepted-release-v1',version:'2.0.0',source:{revision,tree}};
validate(receipt,metadata,env,bytes);
for(const changed of [{CI_PIPELINE_SOURCE:'merge_request_event'},{CI_COMMIT_REF_PROTECTED:'false'},{CI_COMMIT_TAG:'v2.0.0'},{CI_COMMIT_BRANCH:'feature'},{CI_COMMIT_SHA:'c'.repeat(40)}])assert.throws(()=>validate(receipt,metadata,{...env,...changed},bytes));
for(const changed of [{pipelineId:41},{sourceTree:'c'.repeat(40)},{name:'other'},{version:'1.2.0'},{filename:'../outside.tgz'},{packageJobId:0},{sha256:'0'.repeat(64)},{integrity:'sha512-invalid'}])assert.throws(()=>validate({...receipt,...changed},metadata,env,bytes));
assert.throws(()=>validate(receipt,metadata,env,Buffer.from('changed')));
console.log('PASS: npm release binds protected source, accepted version, exact pipeline and immutable package bytes.');

// Public adapter validation above and injected service/module behavior below use no network.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {NpmPublicationService,ReleaseModule}=require('../../dist/modules/release');
const {NestFactory}=require('../../node_modules/@nestjs/core');
const {publicPackagePayload}=require('../../dist/common/publicPayload');
for(const value of [null,[],{...receipt,pipelineId:NaN},{...receipt,pipelineId:9007199254740992},{...receipt,version:'02.0.0'},{...receipt,sourceRevision:'invalid'}])assert.throws(()=>validate(value,metadata,env,bytes));
assert.throws(()=>validate(receipt,metadata,{...env,CI_DEFAULT_BRANCH:undefined,CI_COMMIT_BRANCH:undefined},bytes));
async function scenario(change={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'npm-publication-test-'));
 const files={'test-results/npm-package/receipt.json':Buffer.from(JSON.stringify(receipt)),['test-results/npm-package/'+receipt.filename]:bytes,'test-results/public-release/system-release-v2.0.0.json':Buffer.from(JSON.stringify(metadata))};
 for(const [file,value] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),value);}
 const jobs=[{name:'test:npm-package',id:17},{name:'deploy:github-release',id:18}].map(job=>({...job,status:'success',allow_failure:false,commit:{id:revision},pipeline:{id:42}}));
 const requests=[],commands=[],temporaries=[],sleeps=[];let published=false;let pending=change.delayed??0;
 const ports={
  evidence:async()=>({projectId:1,pipelineId:42,sourceRevision:revision,jobs:change.jobs?change.jobs(jobs):jobs,artifact:async(id,file)=>change.corruptArtifact?Buffer.from('foreign'):files[file]}),
  token:()=>change.token??'npm_testCredential',
  sleep:async ms=>{assert.equal(ms,30000);sleeps.push(ms);for(const directory of temporaries)assert.equal(fs.existsSync(directory),false);},
  request:async(url,options)=>{
   requests.push(url);assert.equal(options.redirect,'error');assert.match(url,/^https:\/\/registry\.npmjs\.org\/%40systembootstrapper%2Fcli\/2\.0\.0$/);
   if(change.unavailable)return {ok:false,status:503};
   if(!published&&!change.exists)return {ok:false,status:404};
   if(published&&pending>0){pending--;return {ok:false,status:404};}
   return {ok:true,status:200,json:async()=>({name:receipt.name,version:receipt.version,dist:{integrity:change.different?'sha512-different':receipt.integrity}})};
  },
  processes:{run(binary,args,options){
   commands.push(args);temporaries.push(options.cwd);assert.equal(binary,'npm');assert.equal(args[0],'publish');
   assert.equal(fs.readFileSync(args[1]).toString(),bytes.toString());assert.equal(options.env.NPM_TOKEN,undefined);assert.equal(options.env.NPM_CONFIG_REGISTRY,undefined);assert.equal(options.env.NODE_OPTIONS,undefined);assert.equal(options.env.SYSTEM_RELEASE_GITLAB_TOKEN,undefined);
   assert.ok(args.includes('--registry=https://registry.npmjs.org/'));assert.ok(args.includes('--ignore-scripts'));assert.ok(args.includes('--provenance=false'));
   const npmrc=args.find(x=>x.startsWith('--userconfig=')).slice(13);assert.equal(fs.statSync(npmrc).mode&0o777,0o600);assert.equal(fs.statSync(options.cwd).mode&0o777,0o700);
   assert.match(fs.readFileSync(npmrc,'utf8'),/npm_testCredential/);assert.ok(!args.join(' ').includes('npm_testCredential'));
   published=!change.lost; if(change.throw)throw Error('secret command output');return {stdout:'',stderr:'',status:0};
  }},
 };
 try{
  const app=await NestFactory.createApplicationContext(ReleaseModule.registerNpm(ports),{logger:false,abortOnError:false});
  try{
   const result=app.get(NpmPublicationService).publish({...env,NPM_CONFIG_REGISTRY:'https://attacker.invalid',NODE_OPTIONS:'--require evil',SYSTEM_RELEASE_GITLAB_TOKEN:'private'},root);
   if(change.reject)await assert.rejects(result);else assert.deepEqual(await result,receipt);
  }finally{await app.close();}
  assert.equal(commands.length,change.commands??0);assert.equal(sleeps.length,change.sleeps??0);for(const directory of temporaries)assert.equal(fs.existsSync(directory),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
(async()=>{
 await scenario({commands:1});
 await scenario({commands:1,delayed:3,sleeps:3});
 await scenario({commands:1,throw:true,delayed:2,sleeps:2});
 await scenario({commands:1,delayed:2,sleeps:2,different:true,reject:true});
 await scenario({exists:true});
 await scenario({exists:true,different:true,reject:true});
 await scenario({unavailable:true,reject:true});
 await scenario({throw:true,commands:1});
 await scenario({throw:true,lost:true,commands:1,sleeps:39,reject:true});
 await scenario({lost:true,commands:1,sleeps:39,reject:true});
 await scenario({token:'bad\nregistry=https://attacker.invalid',reject:true});
 await scenario({corruptArtifact:true,reject:true});
 for(const jobs of [j=>j.slice(1),j=>[...j,j[0]],j=>j.map(x=>({...x,status:'failed'})),j=>j.map(x=>({...x,allow_failure:true})),j=>j.map(x=>({...x,pipeline:{id:41}})),j=>j.map(x=>({...x,commit:{id:'c'.repeat(40)}})),j=>j.map(x=>({...x,id:x.id+1}))])await scenario({jobs,reject:true});
 console.log('PASS: typed npm service/Nest wiring, same-attempt ownership, registry failures, frozen bytes, retries and credential cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});

// Package preparation records the native job/source and refuses dirty or foreign outputs.
for(const failure of [undefined,'dirty','filename','source','pipeline','version','multiple']){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'npm-prepare-test-'));
 try{
  fs.mkdirSync(path.join(root,'assets'),{recursive:true});
  for(const file of [...publicPackagePayload,'assets/public-runtime.json']){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(__dirname,'../..',file),path.join(root,file));}
  fs.writeFileSync(path.join(root,'VERSION'),'2.0.0\n');
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:receipt.name,version:failure==='version'?'1.0.0':'2.0.0'}));
  const calls=[];
  const processes={run(binary,args,options){calls.push([binary,args]);let stdout='';
   if(binary==='git'){
    if(args[0]==='diff'){assert.deepEqual(args,['diff','--quiet','HEAD','--','.']);if(failure==='dirty')throw Error('dirty checkout');}
    else stdout=args[1]==='HEAD'?revision:tree;
   }else{
    assert.equal(binary,'npm');assert.ok(args.includes('--ignore-scripts'));
    fs.writeFileSync(path.join(root,'test-results/npm-package',receipt.filename),bytes);
    stdout=JSON.stringify(failure==='multiple'?[{},{}]:[{filename:failure==='filename'?'../outside.tgz':receipt.filename}]);
   }
   return {stdout,stderr:'',status:0};
  }};
  const service=new NpmPublicationService({processes,request:()=>{throw Error('no network');},evidence:()=>{throw Error('no publication');},token:()=>{throw Error('no credentials');}});
  const prepare=()=>service.prepare(root,{...env,CI_JOB_ID:'17',CI_COMMIT_SHA:failure==='source'?'wrong':revision,CI_PIPELINE_ID:failure==='pipeline'?'9007199254740992':'42'});
  if(failure)assert.throws(prepare);else {assert.deepEqual(prepare(),receipt);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'assets/source.json'))).packageJobId,17);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
console.log('PASS: package preparation exact native source, dirty checkout, safe IDs and single immutable artifact.');
