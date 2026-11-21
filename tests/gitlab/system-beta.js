'use strict';
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fixtures = require('../shared/deployment-evidence-fixtures.json');
const {verifyDeploymentEvidence, DeploymentEvidenceService} = require('../../operations/dist/project-lifecycle/deployment-evidence.service');
const common = require('../../operations/dist/project-lifecycle/evidence-common');
const {systemEvidenceJobs, systemEvidenceStages, systemStorageProofs} = require('../../operations/dist/project-lifecycle/system-evidence');
const hash = value => createHash('sha256').update(value).digest('hex');
function fixture(kind) {
  const value = structuredClone(fixtures[kind]), calls = [];
  const reader = {async get(route) {calls.push(route);assert(Object.hasOwn(value.baseline,route),'unexpected route '+route);return structuredClone(value.baseline[route]);},
    async raw(route) {const value=await reader.get(route);assert.equal(typeof value,'string');return Buffer.from(value);}};
  return {...value,calls,reader};
}
async function runChecks() {
  let checks=0;
  const execute=async(kind, mutate, binding) => {
    const f=fixture(kind);if(mutate)mutate(f);
    const result=await verifyDeploymentEvidence(f.reader,kind,f.input,binding);checks++;return {result,...f};
  };
  const reject=async(kind,mutate,binding) => {await assert.rejects(execute(kind,mutate,binding),/^Error: canonical-deployment-evidence-invalid$/);checks++;};
  const jobsRoute='projects/4/pipelines/10/jobs?per_page=100&include_retried=false', artifact='projects/4/jobs/24/artifacts/', evidenceRoute=artifact+'test-results/successor/candidate-results.json', releaseRoute=artifact+'test-results/successor/release.json';
  assert.equal((await execute('beta')).result.ok,true);
  for(const change of [
    f=>{f.input.environments.deployments.beta={active:{generation:'retained'}};f.input.environments.historicalDeployments=[{retained:true}];},
    f=>{f.baseline['projects/4'].ci_config_path='.gitlab-ci.yml';},
    f=>{f.baseline['projects/4/jobs/90'].trace=true;},
  ])await execute('beta',change);
  for(const change of [
    f=>{f.input.request.kind='review';},f=>{f.input.request.projectId=7;},f=>{f.input.request.operation='0'.repeat(48);},
    f=>{f.input.binding.version=1;},f=>{f.input.binding.helperImage='mutable:tag';},f=>{f.input.environments.settings.beta.host='foreign.example.test';},f=>{f.input.repository.id=99;},
    ...['visibility','path_with_namespace','default_branch','ci_config_path'].map(key=>f=>{f.baseline['projects/4'][key]='foreign';}),
    ...['only_allow_merge_if_pipeline_succeeds','only_allow_merge_if_all_discussions_are_resolved'].map(key=>f=>{f.baseline['projects/4'][key]=false;}),
    f=>{f.baseline['projects/4'].namespace.id=99;},f=>{f.baseline['projects/4/repository/branches/main'].protected=false;},
    ...['sha','status','source'].map(key=>f=>{f.baseline['projects/4/pipelines/10'][key]='invalid';}),
    ...['name','status','allow_failure'].map(key=>f=>{f.baseline['projects/4/jobs/90'][key]=key==='allow_failure'?false:'invalid';}),
    f=>{f.baseline['projects/4/jobs/90'].pipeline.id=11;},
    f=>{f.baseline[jobsRoute].push({...f.baseline[jobsRoute][0],id:500});},
    f=>{f.baseline[jobsRoute].push({...f.baseline['projects/4/jobs/90'],id:500,name:'new-required-check',status:'failed',allow_failure:false});},
    ...['format','candidateJobId','imageId','wizardImageId','wizardSourceTree','registryReference','wizardRegistryReference','candidateEvidencePath'].map(key=>f=>{f.baseline[releaseRoute][key]=key==='candidateJobId'?25:'invalid';}),
    f=>{f.baseline[evidenceRoute]+='\n';},
    ...['mode','id'].map(key=>f=>{f.baseline['projects/4/repository/tree?ref='+f.input.binding.sourceCommit+'&per_page=100'][0][key]='invalid';}),
    f=>{f.baseline['projects/4/jobs/23/artifacts/test-results/wizard-browser/cleanup-after-script.json'].status='failed';},
    f=>{f.baseline['projects/4/jobs/23/artifacts/test-results/wizard-browser/cleanup-on-exit.json'].container='foreign';},
  ])await reject('beta',change);
  for(const name of systemEvidenceJobs)for(const [key,value]of Object.entries({status:'failed',allow_failure:true,commit:{id:'0'.repeat(40)},pipeline:{id:11}}))await reject('beta',f=>{f.baseline[jobsRoute].find(job=>job.name===name)[key]=value;});
  await reject('beta',f=>{const values=f.baseline[jobsRoute];while(values.length<100)values.push({...f.baseline['projects/4/jobs/90'],id:1000+values.length,name:'optional-'+values.length});f.baseline[jobsRoute+'&page=2']=[{...values[0],id:2000,name:'later-failed',status:'failed'}];});
  for(const mutate of [
    p=>{p.fullAcceptance=false;},p=>{p.results[0].status='failed';},p=>{p.images.wizard='sha256:'+'0'.repeat(64);},
    p=>{p.evidence.gitlabUpgrade.runnerVersion='old';},p=>{p.evidence.gitlabUpgrade.jobCaBundleSha256='0'.repeat(64);},p=>{p.evidence.gitlabUpgrade.securityTrustVerified=false;},p=>{p.evidence.gitlabUpgrade.fromRunnerImageId=p.images.runner;},
    ...systemEvidenceStages.map(name=>p=>{p.results=p.results.filter(value=>value.name!==name);}),
    ...systemStorageProofs.map(key=>p=>{p.evidence.storage[key]=false;}),
  ])await reject('beta',f=>{const proof=JSON.parse(f.baseline[evidenceRoute]);mutate(proof);f.baseline[evidenceRoute]=JSON.stringify(proof);f.baseline[releaseRoute].candidateEvidenceSha256=hash(f.baseline[evidenceRoute]);});
  const stopped=await execute('beta',f=>{f.input.request.action='stop';f.baseline['projects/4/jobs/90'].name='stop:wizard-beta';f.baseline['projects/4/pipelines/10'].status='failed';for(const key of Object.keys(f.baseline))if(key.includes('/artifacts/')||key.includes('/tree?')||key===jobsRoute)delete f.baseline[key];});
  assert.equal(stopped.result.ok,true);assert(!stopped.calls.some(route=>route.includes('/artifacts/')||route.includes('/jobs?')||route.includes('/tree?')));
  await reject('review');
  const stopReview=f=>{f.input.request.action='stop';f.baseline['projects/4/jobs/90'].name='stop:wizard-review';f.baseline['projects/4/merge_requests/2'].state='closed';for(const key of Object.keys(f.baseline))if(key.includes('/artifacts/'))delete f.baseline[key];};
  assert.equal((await execute('review',stopReview)).result.ok,true);
  for(const key of ['projectId','pipelineId','sourceCommit','mrIid','operation'])await reject('review',f=>{stopReview(f);f.input.request[key]=typeof f.input.request[key]==='string'?'0'.repeat(40):999;});
  await execute('production');
  for(const change of [f=>{f.baseline['projects/3'].visibility='public';},f=>{f.baseline['projects/3/pipelines/21'].status='failed';},f=>{f.baseline['projects/3/pipelines/21'].sha='e'.repeat(40);},f=>{f.baseline['projects/3/pipelines/21/jobs?per_page=100&include_retried=false'][0].allow_failure=true;},f=>{f.baseline['projects/3/jobs/41/artifacts/build-evidence.json'].lint=false;},...['configurationBackup','cubeSignature'].map(key=>f=>{f.baseline['projects/3/jobs/42/artifacts/wizard-evidence.json'][key]=false;})])await reject('production',change);
  const binding={namespaceId:8,repository:{id:3,namespaceId:8,path:'root/wizard',defaultBranch:'master',managementMode:'source-primary',ciPath:'.gitlab/primary.yml'},sourcePrimary:{version:1,ciFiles:[{path:'.gitlab/primary.yml',sha256:hash('# reviewed native CI\n')}]}};
  const makeNative=f=>{
    Object.assign(f.baseline['projects/3'],{id:3,namespace:{id:8},default_branch:'master',ci_config_path:'.gitlab/primary.yml',only_allow_merge_if_pipeline_succeeds:true,only_allow_merge_if_all_discussions_are_resolved:true});
    Object.assign(f.baseline['projects/3/pipelines/21'],{source:'push',ref:'master'});
    f.baseline['projects/3/repository/branches/master']={commit:{id:f.input.sourceCommit}};
    f.baseline['projects/3/repository/files/.gitlab%2Fprimary.yml?ref='+f.input.sourceCommit]={content:Buffer.from('# reviewed native CI\n').toString('base64')};
    const jobs=f.baseline['projects/3/pipelines/21/jobs?per_page=100&include_retried=false'];jobs.forEach(job=>{job.pipeline={id:21};});
    for(const [index,name]of ['build:source','test:browser'].entries())jobs.push({id:50+index,name,status:'success',allow_failure:false,commit:{id:f.input.sourceCommit},pipeline:{id:21}});
  };
  await execute('production',makeNative,binding);await reject('production',makeNative);
  for(const change of [f=>{f.baseline['projects/3'].namespace.id=9;},...['only_allow_merge_if_pipeline_succeeds','only_allow_merge_if_all_discussions_are_resolved'].map(key=>f=>{f.baseline['projects/3'][key]=false;}),f=>{f.baseline['projects/3/pipelines/21'].source='api';},f=>{f.baseline['projects/3/repository/branches/master'].commit.id='e'.repeat(40);},f=>{f.baseline['projects/3/repository/files/.gitlab%2Fprimary.yml?ref='+f.input.sourceCommit].content=Buffer.from('edited').toString('base64');}])await reject('production',f=>{makeNative(f);change(f);},binding);
  for(const state of ['failed','pending','running','canceled'])await execute('production',f=>{makeNative(f);f.baseline['projects/3/pipelines/21'].status=state;f.baseline['projects/3/pipelines/21/jobs?per_page=100&include_retried=false'].push({id:60,name:'deploy:github',status:state,allow_failure:false,commit:{id:f.input.sourceCommit},pipeline:{id:21}});},binding);
  const environmentFixture=primary=>{
    const f=fixture('production');makeNative(f);
    const sha=f.input.sourceCommit,activation='a'.repeat(40),prefix='projects/3/',ci=[...binding.sourcePrimary.ciFiles,{path:'.gitlab/delivery/environment.sh',sha256:hash('reviewed invocation')}];
    f.baseline[prefix+'repository/files/.gitlab%2Fdelivery%2Fenvironment.sh?ref='+sha]={content:Buffer.from('reviewed invocation').toString('base64')};
    const environment={version:1,managementMode:'source-primary',activationCommit:activation,ciFiles:ci};
    const input={repository:{...binding.repository},request:{action:'deploy',kind:'review',projectId:3,pipelineId:21,jobId:70,sourceCommit:sha,mrIid:2},environments:environment,sourcePrimary:{version:1,adoptionCommit:activation,ciFiles:ci},registryPrefix:'registry.example.test/root/wizard'};
    const pipeline=f.baseline[prefix+'pipelines/21'];Object.assign(pipeline,{source:'merge_request_event',status:'running'});
    const job={id:70,name:'deploy:review',status:'running',allow_failure:true,pipeline:{id:21},commit:{id:sha}};
    f.baseline[prefix+'jobs/70']=job;f.baseline[prefix+'pipelines/21/jobs?per_page=100&include_retried=false'].push(job);
    f.baseline[prefix+'merge_requests/2']={iid:2,state:'opened',source_project_id:3,target_project_id:3,sha};
    f.baseline[prefix+'merge_requests/2/pipelines?per_page=100']=[pipeline];
    for(const [id,builder]of [[41,'wizard-build-3-41'],[42,'wizard-check-3-42-builder']])f.baseline[prefix+`jobs/${id}/artifacts/cleanup.json`]={status:'passed',builder};
    f.baseline[prefix+'jobs/42/artifacts/browser-evidence/browser.json']=Object.fromEntries(['http','renderedUI','projects','spa','configurationBackup','cubeSignature','overviewNavigation'].map(key=>[key,true]));
    if(!primary){
      delete input.sourcePrimary;delete input.repository.managementMode;delete input.repository.ciPath;
      Object.assign(f.baseline['projects/3'],{description:'System Bootstrapper operation registration',ci_config_path:'.system-bootstrapper/ci.yml'});
      input.registrationOperation='registration';delete environment.managementMode;
      input.recipe={files:[{path:'.system-bootstrapper/environment.js',content:'reviewed environment'}],ci:'reviewed legacy CI'};
      input.legacyFiles=[{path:'.system-bootstrapper/build-v1/build.sh',content:'immutable build'}];input.legacyMarker={path:'.system-bootstrapper/wizard-build.json',content:'immutable build marker'};input.buildActivationCommit='b'.repeat(40);
      Object.assign(environment,{operation:'c'.repeat(48),recipeHash:'d'.repeat(64),settingsHash:'e'.repeat(64),helperImage:'sha256:'+'f'.repeat(64),controller:'system_bootstrapper_1'});
      const file=(path,content,last_commit_id)=>{f.baseline[prefix+'repository/files/'+encodeURIComponent(path)+'?ref='+sha]={content:Buffer.from(content).toString('base64'),last_commit_id};};
      for(const entry of [...input.recipe.files,{path:'.system-bootstrapper/ci.yml',content:input.recipe.ci}])file(entry.path,entry.content,activation);
      for(const entry of [...input.legacyFiles,input.legacyMarker])file(entry.path,entry.content,input.buildActivationCommit);
      const marker={version:1,operation:environment.operation,recipeHash:environment.recipeHash,settingsHash:environment.settingsHash,helperImage:environment.helperImage,controller:environment.controller,parentCommit:'c'.repeat(40)};
      file('.system-bootstrapper/wizard-environments.json',JSON.stringify(marker),activation);f.baseline[prefix+'repository/commits/'+activation]={parent_ids:[marker.parentCommit]};
    }
    f.input=input;return f;
  };
  for(const primary of [true,false]){
    let f=environmentFixture(primary);assert.equal((await require('../../operations/dist/project-lifecycle/wizard-evidence').verifyWizardEnvironment(f.reader,f.input)).imageRef,fixtures.production.input.imageRef);checks++;
    for(const mutate of [f=>{f.input.request.jobId=71;},f=>{f.baseline['projects/3/merge_requests/2'].sha='f'.repeat(40);},f=>{f.baseline['projects/3/pipelines/21/jobs?per_page=100&include_retried=false'][0].status='failed';},...(primary?[f=>{f.baseline['projects/3/jobs/41/artifacts/cleanup.json'].status='failed';},f=>{f.baseline['projects/3/jobs/42/artifacts/browser-evidence/browser.json'].cubeSignature=false;}]:[f=>{f.baseline['projects/3/repository/files/.system-bootstrapper%2Fbuild-v1%2Fbuild.sh?ref='+f.input.request.sourceCommit].last_commit_id=f.input.request.sourceCommit;}])]){f=environmentFixture(primary);mutate(f);await assert.rejects(verifyDeploymentEvidence(f.reader,'environment',f.input));checks++;}
    f=environmentFixture(primary);f.input.request.action='stop';f.baseline['projects/3/jobs/70'].name='stop:review';f.baseline['projects/3/merge_requests/2'].state='closed';for(const key of Object.keys(f.baseline))if(key.includes('/artifacts/'))delete f.baseline[key];assert.equal((await verifyDeploymentEvidence(f.reader,'environment',f.input)).ok,true);checks++;
  }
  const pipeline={id:99,sha:'a'.repeat(40),status:'running'},jobs=['build:source','test:browser','build:wizard','test:wizard'].map((name,index)=>({id:101+index,project_id:5,name,status:'success',allow_failure:false,commit:{id:pipeline.sha},pipeline:{id:pipeline.id}}));
  common.nativeJobs(jobs,pipeline,5);checks++;
  const publisher={id:105,project_id:5,name:'deploy:github',status:'failed',allow_failure:false,commit:{id:pipeline.sha},pipeline:{id:pipeline.id}};jobs.push(publisher);pipeline.status='failed';common.nativeJobs(jobs,pipeline,5);checks++;
  for(const status of ['failed','canceled','skipped','pending']){jobs[0].status=status;assert.throws(()=>common.nativeJobs(jobs,pipeline,5));checks++;}jobs[0].status='success';
  for(const mutate of [()=>{publisher.allow_failure=true;},()=>{publisher.commit.id='0'.repeat(40);},()=>jobs.push({...publisher}),()=>{publisher.name='unrelated';}]){const before=structuredClone(jobs);mutate();assert.throws(()=>common.nativeJobs(jobs,pipeline,5));jobs.splice(0,jobs.length,...before);Object.assign(publisher,jobs.at(-1));jobs[jobs.length-1]=publisher;checks++;}
  const managed=[{path:'.system-bootstrapper/build-v1/build.sh',content:'immutable build'},{path:'.system-bootstrapper/build-v1/verify.sh',content:'immutable verification'},{path:'.system-bootstrapper/build-v1/Dockerfile',content:'FROM reviewed'}],sha='e'.repeat(40),activation='a'.repeat(40),files=Object.fromEntries(managed.map(file=>[file.path,{content:Buffer.from(file.content).toString('base64'),last_commit_id:activation}]));
  const fileReader={async get(route){assert(route.endsWith('?ref='+sha));return files[decodeURIComponent(route.split('/repository/files/')[1].split('?')[0])];}};
  await common.managedFiles(fileReader,'projects/1/',sha,managed,activation);checks++;
  for(const file of managed){const before={...files[file.path]};for(const mutate of [()=>{files[file.path].content=Buffer.from('forged success').toString('base64');},()=>{files[file.path].last_commit_id=sha;}]){mutate();await assert.rejects(common.managedFiles(fileReader,'projects/1/',sha,managed,activation));files[file.path]={...before};checks++;}}
  // The service owns credentials in the original controller. Read adapters issue
  // GET only, retain exact artifact bytes, and never return a credential.
  const nativeApiCalls=[],session={context:{checkout:'/system',containerId:'f'.repeat(64)},credential:{token:'private-fixture-token'}};
  const f=fixture('beta'),service=new DeploymentEvidenceService({async ensure(){return session;}},{async readBytes(context,token,route){assert.strictEqual(context,session.context);assert.equal(token,session.credential.token);nativeApiCalls.push(route);const value=f.baseline[route];assert.notEqual(value,undefined);return {status:200,bytes:Buffer.from(typeof value==='string'?value:JSON.stringify(value))};}});
  const result=await service.verify('/system','beta',f.input);assert.equal(result.ok,true);assert(!JSON.stringify(result).includes(session.credential.token));checks++;
  const {GitlabNativeApiService}=require('../../operations/dist/gitlab-provision/native-api.service');
  const raw=' {"unicode":"한글", "padding":true}\n';let nativeCall;
  const api=new GitlabNativeApiService({async run(binary,args,options){nativeCall={binary,args,options};return raw+'\nBOOTSTRAPPER_HTTP_STATUS:200';}});
  const response=await api.readBytes(session.context,session.credential.token,'projects/4/jobs/24/artifacts/proof.json');assert(response.bytes.equals(Buffer.from(raw)));assert.equal(response.status,200);assert(!nativeCall.args.join(' ').includes(session.credential.token));assert(nativeCall.options.input.includes(session.credential.token));assert(nativeCall.options.maxBuffer<=8*1024**2+128);checks++;
  const encodedDocumentation='a'.repeat(3*1024**2);
  const filesApi=new GitlabNativeApiService({async run(binary,args,options){
    const output=JSON.stringify({content:encodedDocumentation})+'\nBOOTSTRAPPER_HTTP_STATUS:200';
    assert(Buffer.byteLength(output)<=options.maxBuffer,'Generated documentation must fit the bounded repository-file read.');
    return output;
  }});
  assert.equal((await filesApi.request(session.context,session.credential.token,'GET','projects/4/repository/files/src%2Fdocs%2Fcontent.json?ref=master')).value.content,encodedDocumentation);checks++;
  await api.request(session.context,session.credential.token,'GET','projects/4');assert.equal(nativeCall.options.maxBuffer,2*1024**2+128);checks++;
  return {mode:'contract-fixture',passed:true,negativeGatesPassed:true,checks};
}
module.exports=runChecks;
if(require.main===module)runChecks().then(result=>console.log(process.argv.includes('--json')?JSON.stringify(result):`Native deployment evidence: ${result.checks} ownership, CI, immutable source, artifact, stale Stop and private transport checks passed.`)).catch(error=>{console.error(error);process.exitCode=1;});
