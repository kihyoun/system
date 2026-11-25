'use strict';
const assert=require('node:assert/strict');
const {ManagedEnvironmentService}=require('../../dist/modules/gitlab-provision/managedEnvironment.service');
const {advisoryKey}=require('../../dist/modules/gitlab-provision/managedRecipe');
const row=(content,commit)=>({content:Buffer.from(content).toString('base64'),last_commit_id:commit});
const legacy={version:1,recipeHash:'build-recipe',ci:'legacy managed CI',files:[{path:'.system-bootstrapper/build-v1/build.sh',content:'legacy checks'}]};
const recipe={version:1,recipeHash:'environment-recipe',settingsHash:'1'.repeat(64),helperImage:'sha256:'+'2'.repeat(64),ci:'environment managed CI',files:[{path:'.system-bootstrapper/environments-v1/run.sh',content:'immutable environment helper invocation'}]};
const environment={version:1,operation:'3'.repeat(48),recipeHash:recipe.recipeHash,settingsHash:recipe.settingsHash,helperImage:recipe.helperImage,controller:'system_bootstrapper_1',phase:'pending',settings:{review:{enabled:true}}};
const initial={action:'wizard-environments',operation:'registration',controller:'system_bootstrapper_1',repository:{id:1,path:'root/wizard',defaultBranch:'main'},workflow:{sourceRevision:'c'.repeat(40),manifestHash:'d'.repeat(64),importCommit:'a'.repeat(40)},build:{version:1,operation:'5'.repeat(48),activationCommit:'b'.repeat(40),recipeHash:legacy.recipeHash,phase:'candidate-verified',artifact:{imageRef:'registry.example.test/root/wizard@sha256:'+'6'.repeat(64)}},environments:environment,recipe,legacyRecipe:legacy,registryPrefix:'registry.example.test/root/wizard'};
const project={id:1,path_with_namespace:'root/wizard',default_branch:'main',visibility:'private',description:'System Bootstrapper operation registration',ci_config_path:'.system-bootstrapper/ci.yml'};
class Fixture {
  constructor(input) {
    this.posts=[];this.parents={};this.head='b'.repeat(40);this.locked=false;
    const {build,workflow,legacyRecipe:old}=input;
    this.files={'.system-bootstrapper/wizard-source.json':row(JSON.stringify({version:1,operation:input.operation,sourceRevision:workflow.sourceRevision,manifestHash:workflow.manifestHash}),'a'.repeat(40)),'.system-bootstrapper/wizard-build.json':row(JSON.stringify({version:1,operation:build.operation,recipeHash:old.recipeHash,sourceRevision:workflow.sourceRevision,importCommit:workflow.importCommit}),this.head),'.system-bootstrapper/ci.yml':row(old.ci,this.head),'.gitlab-ci.yml':row('upstream CI','a'.repeat(40)),'README.md':row('upstream README','a'.repeat(40))};
    for(const source of old.files)this.files[source.path]=row(source.content,this.head);
  }
  async withAdvisoryLock(key,run){assert.equal(key,advisoryKey('system-wizard-environments:1'));if(this.busy)throw Error('busy');assert(!this.locked);this.locked=true;try{return await run();}finally{this.locked=false;}}
  async request(method,route,body){
    assert(this.locked,'repository work must stay under the shared lock');
    if(method==='GET') {
      if(route.includes('/repository/files/')){const name=decodeURIComponent(route.split('/files/')[1].split('?')[0]);return {status:this.files[name]?200:404,value:this.files[name]||{}};}
      if(route.includes('/repository/branches/'))return {status:200,value:{commit:{id:this.head}}};
      if(route.includes('/repository/commits/'))return {status:200,value:{parent_ids:this.parents[route.split('/').at(-1)]}};
    }else if(method==='POST'&&route.endsWith('/repository/commits')){
      this.posts.push(body);assert.match(body.commit_message,/\[skip ci\]/);const commit=String.fromCharCode(98+this.posts.length).repeat(40),copy=structuredClone(this.files);
      for(const action of body.actions){const name=action.file_path;if(action.action==='create'){if(copy[name])return {status:400,value:{}};}else if(copy[name]?.last_commit_id!==action.last_commit_id)return {status:400,value:{}};copy[name]=row(action.content,commit);}
      this.parents[commit]=[this.race?'f'.repeat(40):this.head];this.files=copy;this.head=commit;if(this.interrupted)throw Error('interrupted response');return {status:201,value:{id:commit}};
    }
    throw Error('Unexpected fixture API request '+route);
  }
}
async function main(){
  const service=new ManagedEnvironmentService();let input=structuredClone(initial),fixture=new Fixture(input);const run=()=>service.execute(input,project,fixture);
  let result=(await run()).environments;assert.equal(result.phase,'recipe-installed');assert.equal(result.activationCommit,'c'.repeat(40));assert.equal(fixture.posts.length,1);
  assert.equal((await run()).environments.activationCommit,'c'.repeat(40));assert.equal(fixture.posts.length,1);
  assert.equal(Buffer.from(fixture.files['.gitlab-ci.yml'].content,'base64').toString(),'upstream CI');assert.equal(Buffer.from(fixture.files['.system-bootstrapper/build-v1/build.sh'].content,'base64').toString(),'legacy checks');
  input.action='wizard-environments-status';assert.equal((await run()).environments.phase,'recipe-installed');assert.equal(fixture.posts.length,1);input.action='wizard-environments';
  fixture=new Fixture(input);fixture.interrupted=true;assert.equal((await run()).environments.phase,'requires-reconciliation');fixture.interrupted=false;assert.equal((await run()).environments.activationCommit,'c'.repeat(40));assert.equal(fixture.posts.length,1);
  fixture=new Fixture(input);fixture.race=true;await assert.rejects(run,/branch raced/);await assert.rejects(run,/branch raced/);assert.equal(fixture.posts.length,1);
  fixture=new Fixture(input);fixture.files['.system-bootstrapper/ci.yml']=row('human edit','e'.repeat(40));await assert.rejects(run,/content changed/);assert.equal(fixture.posts.length,0);
  fixture=new Fixture(input);fixture.files['.system-bootstrapper/environments-v1/run.sh']=row('occupied','e'.repeat(40));await assert.rejects(run,/occupied/);
  fixture=new Fixture(input);fixture.busy=true;await assert.rejects(run,/busy/);assert.equal(fixture.posts.length,0);
  fixture=new Fixture(input);const prior=structuredClone((await run()).environments);input.previousEnvironments=prior;input.previousRecipe=structuredClone(recipe);input.environments={...environment,operation:'7'.repeat(48),recipeHash:'new-recipe',settingsHash:'8'.repeat(64)};input.recipe={...recipe,recipeHash:'new-recipe',settingsHash:'8'.repeat(64),ci:'updated managed CI',files:[{path:'.system-bootstrapper/environments-v1/run.sh',content:'new helper invocation'}]};
  prior.deployments={review:{active:{pipelineId:10}}};await assert.rejects(run,/Stop active/);prior.deployments={review:{pending:{pipelineId:10}}};await assert.rejects(run,/Stop active/);prior.deployments={};
  result=(await run()).environments;assert.equal(result.activationCommit,'d'.repeat(40));assert.equal(fixture.posts.length,2);assert.equal((await run()).environments.activationCommit,'d'.repeat(40));assert.equal(fixture.posts.length,2);
  assert.equal(Buffer.from(fixture.files['README.md'].content,'base64').toString(),'upstream README');assert(fixture.posts.every(body=>body.actions.every(action=>action.file_path!=='.gitlab-ci.yml'&&!action.file_path.includes('/build-v1/'))));
  for(const key of ['id','path_with_namespace','default_branch','visibility','description','ci_config_path'])await assert.rejects(()=>service.execute(input,{...project,[key]:'foreign'},fixture),/ownership changed/);
  input=structuredClone(initial);input.action='wizard-environments-status';fixture=new Fixture(input);assert.equal((await run()).environments.phase,'pending');assert.equal(fixture.posts.length,0);
  console.log('Native environment activation: exact ownership, legacy advisory key, atomic settings updates, occupied paths, active leases, interrupted/raced commit recovery and read-only status passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
