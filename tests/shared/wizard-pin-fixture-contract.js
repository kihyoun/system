'use strict';
const assert=require('assert/strict');
const {publish,pipelineContent,immutableImage,markerPath}=require('../e2e/wizard-pin-fixture');
const {privateWizardAcceptance}=require('../e2e/prepare-images');
const binding=require('../../project-bootstrap/wizard-source-primary/binding');
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
function nativeFixture() {
  const calls=[],imageRef='registry.candidate.test:5050/team/native-source@'+digest;
  const receipt={namespaceId:9,repository:{id:7,namespaceId:9,path:'team/native-source',defaultBranch:'main',managementMode:'source-primary',ciPath:'.gitlab/primary.yml'},
    sourcePrimary:{version:1,operation:'1'.repeat(48),adoptionCommit:'2'.repeat(40),ciFiles:[{path:'.gitlab/primary.yml',sha256:binding.hash('# native producer\n')}]}};
  const jobs=['build:source','test:browser','build:wizard','test:wizard'].map((name,index)=>({id:40+index,name,status:'success',allow_failure:false,
    commit:{id:commit},pipeline:{id:31},runner:{id:3}}));
  const merge={projectId:7,merged:true,normalGate:true,source:'push',sourceCommit:commit,pipelineId:31,artifactsVerified:true,imageDigest:digest,
    jobs:jobs.map(job=>({id:job.id,name:job.name,status:job.status,runnerId:job.runner.id}))};
  const rows={
    '/projects/7':{id:7,namespace:{id:9},path_with_namespace:'team/native-source',default_branch:'main',visibility:'private',ci_config_path:'.gitlab/primary.yml',
      only_allow_merge_if_pipeline_succeeds:true,only_allow_merge_if_all_discussions_are_resolved:true},
    '/projects/7/pipelines/31':{id:31,sha:commit,ref:'main',source:'push',status:'success'}
  };
  rows['/projects/7/repository/files/.gitlab%2Fprimary.yml?ref='+commit]={content:Buffer.from('# native producer\n').toString('base64')};
  rows['/projects/7/pipelines/31/jobs?per_page=100&include_retried=false']=jobs;
  rows['/projects/7/repository/branches/main']={commit:{id:commit}};
  rows['/projects/7/jobs/42/artifacts/build-evidence.json']={version:1,sourceCommit:commit,pipelineId:31,imageRef,unitTests:true,testRunner:'vitest',lint:true,typecheck:true,productionBuild:true};
  rows['/projects/7/jobs/43/artifacts/wizard-evidence.json']={version:1,sourceCommit:commit,pipelineId:31,imageRef,http:true,renderedUI:true,projects:true,spa:true,configurationBackup:true,cubeSignature:true};
  const image={Id:derived,Config:{Labels:{'org.opencontainers.image.revision':commit}},RepoDigests:[imageRef]};
  const owned={receipt,registryHost:'registry.candidate.test:5050'};
  const candidate={id:owner,url:'https://sync.candidate.test',spec:{guidedPreviewAcceptance:true,images:{wizard:{id:base}}},evidence:{guidedPreview:{merge}},
    inner:async args=>{calls.push({docker:args});return JSON.stringify(args[0]==='image'?[image]:owned);},
    rails:async()=>({token:'private-only-test-token'}),request:async()=>({status:401}),
    api:async(route,token,method='GET')=>{
      assert.equal(token,'private-only-test-token');calls.push({route,method});
      if(route==='/personal_access_tokens/self'&&method==='DELETE')return null;
      assert.equal(method,'GET','Native recovery reuse must never build or mutate source');
      assert(Object.hasOwn(rows,route),'Unexpected native evidence route: '+route);
      return JSON.parse(JSON.stringify(rows[route]));
    }};
  return {candidate,calls,rows,jobs,merge,receipt,image,owned,imageRef};
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
  const native=nativeFixture(),reused=await publish(native.candidate);
  assert.deepEqual(reused,{kind:'source-primary-native-v1',projectId:7,projectPath:'team/native-source',registryHost:'registry.candidate.test:5050',
    sourceCommit:commit,pipelineId:31,jobId:42,runnerId:3,imageRef:native.imageRef,imageDigest:digest,imageId:derived});
  assert(native.calls.filter(call=>call.method).every(call=>call.method==='GET'||call.route==='/personal_access_tokens/self'&&call.method==='DELETE'));
  assert(!native.calls.some(call=>call.docker?.includes('build')||call.docker?.includes('pull')));
  assert.equal(native.calls.at(-1).route,'/personal_access_tokens/self');
  for(const change of [
    f=>{delete f.candidate.evidence.guidedPreview.merge;},
    f=>{f.merge.normalGate=false;},
    f=>{f.merge.jobs[2].runnerId=4;},
    f=>{f.merge.jobs.pop();},
    f=>{f.rows['/projects/7'].only_allow_merge_if_pipeline_succeeds=false;},
    f=>{f.rows['/projects/7/pipelines/31'].source='api';},
    f=>{f.jobs[0].status='failed';},
    f=>{f.rows['/projects/7/jobs/42/artifacts/build-evidence.json'].pipelineId=32;},
    f=>{f.rows['/projects/7/jobs/43/artifacts/wizard-evidence.json'].cubeSignature=false;},
    f=>{f.rows['/projects/7/jobs/42/artifacts/build-evidence.json'].imageRef='foreign.invalid/team/native-source@'+digest;},
    f=>{f.rows['/projects/7/repository/branches/main'].commit.id='f'.repeat(40);},
    f=>{f.rows['/projects/7/repository/files/.gitlab%2Fprimary.yml?ref='+commit].content=Buffer.from('changed producer').toString('base64');},
    f=>{f.image.Config.Labels['org.opencontainers.image.revision']='f'.repeat(40);},
    f=>{f.image.RepoDigests=[];},
    f=>{f.image.Id=base;},
    f=>{f.candidate.spec.supportImages={helper:{id:derived}};}
  ]) {
    const bad=nativeFixture();change(bad);
    await assert.rejects(publish(bad.candidate));
    assert.equal(bad.calls.at(-1).route,'/personal_access_tokens/self','Rejected native reuse left its temporary credential active');
    assert(!bad.calls.some(call=>call.method==='POST'||call.method==='PUT'),'Rejected native evidence fell back to a marker build');
  }
  const wrongRegistry=nativeFixture();wrongRegistry.owned.registryHost='foreign.invalid';
  await assert.rejects(publish(wrongRegistry.candidate),/registry-identity-invalid/);
  assert(!wrongRegistry.calls.some(call=>call.method));
  console.log('PASS private Wizard fixture: owned receipt, branch CI, exact commit, uncached identity, registry pin, failure cleanup and credential revocation');
})().catch(error=>{console.error(error);process.exitCode=1;});
