'use strict';
const assert=require('assert/strict');
const {publish,pipelineContent,immutableImage,markerPath}=require('../e2e/wizard-pin-fixture');
const {privateWizardAcceptance}=require('../e2e/prepare-images');
const owner='a'.repeat(24),commit='b'.repeat(40),base='sha256:'+'c'.repeat(64),derived='sha256:'+'d'.repeat(64),digest='sha256:'+'e'.repeat(64);
function fixture(overrides={}) {
  const calls=[];let polls=0;
  const project={id:2,path:'wizard',path_with_namespace:'root/wizard',visibility:'private',default_branch:'main',ci_config_path:'.system-bootstrapper/ci.yml'};
  const candidate={id:owner,url:'http://private.invalid',spec:{images:{wizard:{id:base}}},
    inner:async()=>JSON.stringify({id:2,path:'root/wizard',ciPath:'.system-bootstrapper/ci.yml'}),
    rails:async()=>({token:'private-only-test-token'}),request:async()=>({status:401}),
    wait:async check=>{for(let i=0;i<3;i++)if(await check())return;throw Error('test-wait-failed');},
    api:async(route,token,method='GET',payload)=>{
      assert.equal(token,'private-only-test-token');calls.push({route,method,payload});
      if(route==='/personal_access_tokens/self')return null;
      if(route==='/projects/2')return project;
      if(route==='/projects/2/repository/branches')return {name:payload.branch};
      if(route==='/projects/2/repository/files/.system-bootstrapper%2Fci.yml')return {};
      if(route.startsWith('/projects/2/repository/files/.system-bootstrapper%2Fci.yml?'))return {last_commit_id:commit};
      if(route.startsWith('/projects/2/pipelines?'))return [{id:99,sha:'f'.repeat(40),status:'success'},{id:11,sha:commit,status:++polls>1?'success':'running'}];
      if(route==='/projects/2/pipelines/11/jobs')return [{id:12,name:'private-wizard-publish',status:'success',runner:{id:3},duration:4,queued_duration:1}];
      if(route.endsWith('/artifacts/private-image.txt'))return derived+'\n';
      if(route.endsWith('/artifacts/source-image.txt'))return base+'\n';
      if(route==='/projects/2/registry/repositories')return [{id:5,path:'root/wizard/recovery-wizard',location:'registry.candidate.test:5050/root/wizard/recovery-wizard'}];
      if(route==='/projects/2/registry/repositories/5/tags/'+commit)return {name:commit,digest};
      throw Error('unexpected-fixture-route');
    },...overrides};
  return {candidate,calls,project};
}
(async()=>{
  const helpers=['system/ensure-wizard-image.sh','system/wizard-image-recovery.js','system/wizard-registry-token.rb'];
  assert.equal(privateWizardAcceptance([],()=>true),false);
  assert.equal(privateWizardAcceptance(helpers,()=>true),true);
  assert.throws(()=>privateWizardAcceptance(helpers.slice(0,2),()=>true),/complete private-registry recovery/);
  assert.throws(()=>privateWizardAcceptance(helpers,name=>!name.endsWith('wizard-pin-fixture.js')),/complete private-registry recovery/);
  const content=pipelineContent(owner);
  assert(content.includes('private-wizard-publish:'));
  assert(content.includes('COPY proof '+markerPath));
  assert(content.includes('pull_policy: never'));
  assert.throws(()=>pipelineContent("a'; malicious"),/marker-invalid/);
  const {candidate,calls}=fixture();
  const result=await publish(candidate);
  assert.equal(result.imageRef,'registry.candidate.test:5050/root/wizard/recovery-wizard@'+digest);
  assert.equal(result.imageId,derived);assert.equal(result.sourceImageId,base);
  assert.equal(result.projectPath,'root/wizard');assert.equal(result.pipelineId,11);assert.equal(result.markerPath,markerPath);
  const update=calls.find(call=>call.method==='PUT');assert.equal(update.payload.branch,'candidate-private-pin-'+owner);
  assert(!calls.some(call=>call.method==='PUT'&&call.payload.branch==='main'));
  assert.equal(calls.at(-1).route,'/personal_access_tokens/self');
  const invalid=fixture({inner:async()=>JSON.stringify({id:2,path:'other/wizard',ciPath:'../../secret'})});
  await assert.rejects(publish(invalid.candidate),/owned-project-required/);assert.equal(invalid.calls.length,0);
  const foreign=fixture();foreign.project.path_with_namespace='foreign/wizard';
  await assert.rejects(publish(foreign.candidate),/owned-project-mismatch/);assert.equal(foreign.calls.at(-1).route,'/personal_access_tokens/self');
  const cached=fixture({spec:{images:{wizard:{id:base},candidate:{id:derived}}}});
  await assert.rejects(publish(cached.candidate),/uncached-layer-required/);assert.equal(cached.calls.at(-1).route,'/personal_access_tokens/self');
  const failure=fixture();const api=failure.candidate.api;
  failure.candidate.api=(route,...args)=>route.startsWith('/projects/2/pipelines?')?Promise.resolve([{id:11,sha:commit,status:'failed'}]):api(route,...args);
  await assert.rejects(publish(failure.candidate),/pipeline-failed/);assert.equal(failure.calls.at(-1).route,'/personal_access_tokens/self');
  await assert.rejects(publish(fixture({request:async()=>({status:200})}).candidate),/credential-not-revoked/);
  const rails=[];
  const malformed=fixture({rails:async script=>{rails.push(script);return {token:null};}});
  await assert.rejects(publish(malformed.candidate),/credential-failed/);
  assert.equal(rails.length,2);assert(rails[1].includes('find_each(&:revoke!)'));
  assert.equal(malformed.calls.length,0);
  assert.throws(()=>immutableImage({id:1,path:'root/other/recovery-wizard',location:'registry.invalid/a'},{digest}),/registry-identity-invalid/);
  assert.throws(()=>immutableImage({id:1,path:'root/wizard/recovery-wizard',location:'registry.invalid/a'},{digest:'latest'}),/registry-identity-invalid/);
  console.log('PASS private Wizard fixture: owned receipt, branch CI, exact commit, uncached identity, registry pin, failure cleanup and credential revocation');
})().catch(error=>{console.error(error);process.exitCode=1;});
