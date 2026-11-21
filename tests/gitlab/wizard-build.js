'use strict';
const assert=require('node:assert/strict');
const {ManagedBuildService}=require('../../operations/dist/gitlab-provision/managed-build.service');
const {advisoryKey}=require('../../operations/dist/gitlab-provision/managed-recipe');
const row=(content,commit)=>({content:Buffer.from(content).toString('base64'),last_commit_id:commit});
const initial={action:'wizard-build',operation:'registration',repository:{id:1,path:'root/wizard',defaultBranch:'main'},workflow:{importCommit:'a'.repeat(40),sourceRevision:'c'.repeat(40),manifestHash:'f'.repeat(64)},build:{version:1,operation:'d'.repeat(48),recipeHash:'recipe'},expectedCi:'disabled',recipe:{version:1,recipeHash:'recipe',ci:'managed no-deploy CI',files:[{path:'.system-bootstrapper/build-v1/check.sh',content:'checks'}]},registryPrefix:'registry.localhost:5050/root/wizard'};
const project={id:1,description:'System Bootstrapper operation registration',visibility:'private',path_with_namespace:'root/wizard',default_branch:'main',ci_config_path:'.system-bootstrapper/ci.yml'};
class Fixture {
  constructor(input){this.input=input;this.head='a'.repeat(40);this.commits=0;this.posts=0;this.status='running';this.pipelines=[];this.files={'.system-bootstrapper/ci.yml':row('disabled',this.head),'.gitlab-ci.yml':row('upstream publishing unchanged',this.head),'README.md':row('existing README',this.head),'.system-bootstrapper/wizard-source.json':row(JSON.stringify({version:1,operation:'registration',sourceRevision:'c'.repeat(40),manifestHash:'f'.repeat(64)}),this.head)};}
  async withAdvisoryLock(key,callback){assert.equal(key,advisoryKey('system-wizard-build:1:'+this.input.build.operation));if(this.busy)throw Error('still running');assert(!this.locked);this.locked=true;try{return await callback();}finally{this.locked=false;}}
  async request(method,route,body){
    assert(this.locked);
    if(method==='GET'){
      if(route.includes('/repository/files/')){const name=decodeURIComponent(route.split('/files/')[1].split('?')[0]);return {status:this.files[name]?200:404,value:this.files[name]||{}};}
      if(route.includes('/repository/branches/'))return {status:200,value:{commit:{id:this.head}}};
      if(route.includes('/repository/commits/'))return {status:200,value:{parent_ids:[(this.sourceRace?'e':'a').repeat(40)]}};
      if(route.includes('/pipelines?')){assert(route.includes('&sha='+'b'.repeat(40)));return {status:200,value:this.hidePipelines?[]:this.pipelines.map(value=>({...value,status:this.status}))};}
      if(route.includes('/variables/'))return {status:this.intent?200:404,value:this.intent||{}};
      if(route.endsWith('/variables'))return {status:200,value:[{key:'SYSTEM_WIZARD_OPERATION',value:this.input.build.operation}]};
      if(route.includes('/jobs?'))return {status:200,value:this.jobOverride||[{id:10,name:'build:wizard',status:'success',allow_failure:false},{id:20,name:'test:wizard',status:'success',allow_failure:false}]};
      if(route.includes('/artifacts/'))return {status:200,value:{version:1,sourceCommit:'b'.repeat(40),pipelineId:11,imageRef:initial.registryPrefix+'@sha256:'+'d'.repeat(64),jest:true,productionBuild:true,http:true,renderedUI:this.status!=='bad-artifact',projects:true,spa:true,...this.artifactOverride}};
      if(/\/pipelines\/\d+$/.test(route))return {status:200,value:{...this.pipelines[0],status:this.status==='bad-artifact'?'success':this.status}};
    }else if(method==='POST'&&route.endsWith('/repository/commits')){
      const copy=structuredClone(this.files);for(const action of body.actions){const name=action.file_path;if(action.action==='create'){if(copy[name])return {status:400,value:{}};}else if(copy[name]?.last_commit_id!==action.last_commit_id)return {status:400,value:{}};copy[name]=row(action.content,'b'.repeat(40));}
      assert.match(body.commit_message,/\[skip ci\]/);this.files=copy;this.commits++;this.head='b'.repeat(40);if(this.failAfterCommit)throw Error('interrupted commit');return {status:201,value:{id:this.head}};
    }else if(method==='POST'&&route.endsWith('/variables')){if(this.intent)return {status:400,value:{}};this.intent=structuredClone(body);if(this.failAfterIntent)throw Error('interrupted intent');return {status:201,value:this.intent};}
    else if(method==='POST'&&route.endsWith('/pipeline')){this.posts++;const value={id:11,sha:this.pipelineRace?'e'.repeat(40):this.head,source:'api',ref:'main',status:this.status,web_url:'http://gitlab.localhost/pipeline/11'};this.pipelines.push(value);if(this.failAfterPipeline)throw Error('interrupted pipeline');return {status:201,value};}
    throw Error('Unexpected fixture request '+route);
  }
}
async function main(){
  const service=new ManagedBuildService();let input=structuredClone(initial),fixture=new Fixture(input);const run=()=>service.execute(input,project,fixture);
  assert.equal((await run()).build.phase,'pipeline-running');assert.equal(fixture.commits,1);assert.equal(fixture.posts,1);assert.equal((await run()).build.pipeline.id,11);assert.equal(fixture.posts,1);
  fixture.status='success';let result=(await run()).build;assert.equal(result.phase,'candidate-verified');assert.equal(result.artifact.sourceCommit,'b'.repeat(40));assert.equal(Buffer.from(fixture.files['.gitlab-ci.yml'].content,'base64').toString(),'upstream publishing unchanged');assert.equal(Buffer.from(fixture.files['README.md'].content,'base64').toString(),'existing README');
  input.build=structuredClone(result);fixture.status='bad-artifact';await assert.rejects(run,/incomplete/);fixture.status='success';
  for(const changed of [{sourceCommit:'e'.repeat(40)},{pipelineId:999},{imageRef:'other-registry/root/wizard@sha256:'+'d'.repeat(64)},{imageRef:initial.registryPrefix+'@sha256:short'}]){fixture.artifactOverride=changed;await assert.rejects(run,/identity or digest/);}
  fixture.artifactOverride={jest:false};await assert.rejects(run,/incomplete/);fixture.artifactOverride={jest:false,unitTests:true,testRunner:'vitest',lint:true,typecheck:true,configurationBackup:true,cubeSignature:true};assert.equal((await run()).build.phase,'candidate-verified');
  for(const key of ['lint','typecheck','configurationBackup','cubeSignature']){fixture.artifactOverride[key]=false;await assert.rejects(run,/incomplete/);fixture.artifactOverride[key]=true;}
  fixture.artifactOverride=undefined;fixture.jobOverride=[{id:10,name:'build:wizard',status:'success',allow_failure:true}];await assert.rejects(run,/required checks/);fixture.jobOverride=undefined;
  input.build=structuredClone(initial.build);fixture=new Fixture(input);fixture.failAfterCommit=true;await assert.rejects(run,/interrupted commit/);fixture.failAfterCommit=false;input.action='wizard-build-status';assert.equal((await run()).build.phase,'recipe-installed');assert.equal(fixture.posts,0);input.action='wizard-build';assert.equal((await run()).build.pipeline.id,11);assert.equal(fixture.commits,1);assert.equal(fixture.posts,1);
  fixture=new Fixture(input);fixture.failAfterIntent=true;await assert.rejects(run,/interrupted intent/);fixture.failAfterIntent=false;assert.equal((await run()).build.phase,'requires-reconciliation');assert.equal((await run()).build.phase,'requires-reconciliation');assert.equal(fixture.posts,0);
  fixture=new Fixture(input);fixture.failAfterPipeline=true;fixture.hidePipelines=true;assert.equal((await run()).build.phase,'requires-reconciliation');fixture.failAfterPipeline=false;assert.equal((await run()).build.phase,'requires-reconciliation');assert.equal(fixture.posts,1);fixture.hidePipelines=false;assert.equal((await run()).build.pipeline.id,11);assert.equal(fixture.posts,1);fixture.intent.value='changed';await assert.rejects(run,/checkpoint changed/);
  fixture=new Fixture(input);await run();fixture.files['.system-bootstrapper/ci.yml']=row('maintainer edit','edited');await assert.rejects(run,/Managed Wizard CI changed/);assert.equal(fixture.commits,1);assert.equal(fixture.posts,1);
  fixture=new Fixture(input);fixture.sourceRace=true;await assert.rejects(run,/branch raced/);assert.equal(fixture.posts,0);
  fixture=new Fixture(input);fixture.pipelineRace=true;await assert.rejects(run,/raced pipeline/);fixture.pipelineRace=false;await assert.rejects(run,/identity changed/);assert.equal(fixture.posts,1);
  fixture=new Fixture(input);fixture.files['.system-bootstrapper/ci.yml']=row('maintainer edit','edited');await assert.rejects(run,/scaffold changed/);assert.equal(fixture.commits,0);
  fixture=new Fixture(input);fixture.busy=true;await assert.rejects(run,/still running/);assert.equal(fixture.posts,0);
  for(const key of ['id','visibility','description','path_with_namespace','default_branch','ci_config_path'])await assert.rejects(()=>service.execute(input,{...project,[key]:'different'},fixture),/ownership changed/);
  input.action='wizard-build-status';fixture=new Fixture(input);assert.equal((await run()).build.phase,undefined);assert.equal(fixture.commits,0);assert.equal(fixture.posts,0);
  console.log('Native Wizard build: legacy lock key, content/race guards, interrupted commit/checkpoint/pipeline recovery, read-only status and legacy/modern artifact gates passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
