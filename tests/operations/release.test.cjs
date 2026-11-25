'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const api=require('../../dist/modules/release');
const profile=require('../../config/gitlab/security-release.json');
const lifecycle=require('../../dist/modules/release/guidedPreviewEvidence');
const fixture=require('../../tests/shared/guided-preview-fixture');
const revision='a'.repeat(40),sourceTree='b'.repeat(40),wizardTree='c'.repeat(40);
const id=n=>'sha256:'+n.repeat(64);
const legacy={sourceRevision:revision,sourceTree,wizardRevision:wizardTree};
const monorepo={sourceLayout:'system-monorepo-v1',sourceRevision:revision,sourceTree,wizardSourceTree:wizardTree};
const env={CI_COMMIT_SHA:revision,CI_PROJECT_ID:'4',CI_PIPELINE_ID:'10',CI_JOB_ID:'20',CI_REGISTRY:'registry.example.test',CI_PROJECT_PATH:'example/system',CI_REGISTRY_IMAGE:'registry.example.test/example/system',CI_PIPELINE_SOURCE:'merge_request_event',CI_REGISTRY_USER:'fixture',CI_REGISTRY_PASSWORD:'fixture-password'};
const evidence=api.createEvidence(profile,lifecycle);
function proof(){return {runId:'f'.repeat(24),sourceRevision:revision,fullAcceptance:true,images:{candidate:id('1'),wizard:id('2'),runner:id('3')},results:[
 'gitlab-upgrade-migrated-data','gitlab-upgrade-registry-ci','gitlab-upgrade-restored-checkpoint','gitlab-upgrade-security-trust','storage-global-live-lease','storage-refuse-nonempty-and-corrupt-restore','storage-detached-backup-normal-operation','cleanup',...fixture.stages
].map(name=>({name,status:'passed'})),evidence:{guidedPreview:fixture.proof(id('2')),gitlabUpgrade:{fromImage:profile.fromImage,toImage:profile.toImage,fromImageId:id('a'),toImageId:id('b'),migrationVerified:true,rollbackVerified:true,registryVerified:true,checkpointVerified:true,runnerImage:profile.runner.toImage,runnerImageId:id('3'),fromRunnerImageId:id('4'),runnerVersion:profile.runner.toVersion,helperImage:profile.runner.helperImage,helperImageId:id('5'),fromHelperImageId:id('6'),jobCaBundleSha256:profile.jobCaBundleSha256,securityTrustVerified:true,runnerUpgradeVerified:true,runnerManagerIdentityPreserved:true},storage:{localLiveVerified:true,externalSeedRestored:true,backupDetached:true,missingBackupGuardVerified:true,globalLeaseVerified:true,invalidRestoreGuardVerified:true}}};}
function sharedProof(){
 const value=proof(),beta=require('../../tests/shared/system-beta-evidence-fixture').proof();
 Object.assign(value,monorepo,{ciIdentity:{projectId:4,pipelineId:10,candidateJobId:20}});
 beta.productionImageId=id('2');beta.productionRetained.runningImage=id('2');
 Object.assign(beta.candidate,{sourceCommit:revision,sourceTree,wizardSourceTree:wizardTree,helperImage:id('1'),wizardImageId:id('2'),fixturePipelineId:10,fixtureCandidateJobId:20});
 beta.setup.sourceCommit=revision;
 for(const row of [beta.beta.deployment,beta.beta.stopped])Object.assign(row,{sourceCommit:revision,pipelineId:10,generation:'p10-j201'});
 beta.beta.stoppedThroughPipelineId=10;
 value.evidence.guidedPreview=beta;value.results=value.results.filter(row=>!fixture.stages.includes(row.name)).concat(lifecycle.stagesV2.map(name=>({name,status:'passed'})));
 return value;
}
test('historical source remains a separate Wizard commit and cannot be silently relabelled',()=>{
 assert.deepEqual(api.readSourceIdentity(legacy),legacy);
 assert.deepEqual(api.readSourceIdentity(monorepo),monorepo);
 for(const invalid of [{...legacy,sourceLayout:'system-monorepo-v1'},{...monorepo,sourceLayout:undefined},{...monorepo,wizardRevision:wizardTree},{...monorepo,sourceLayout:'future-layout'},{...monorepo,wizardSourceTree:'HEAD'}])assert.throws(()=>api.readSourceIdentity(invalid));
 assert.equal(api.wizardImageRevision(legacy),wizardTree);assert.equal(api.wizardImageRevision(monorepo),revision);
});
test('monorepo publication binds both accepted images to one source and retains private cleanup',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'release-module-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const value=sharedProof(),directory=path.join(root,'test-results/e2e',value.runId);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(value));
 let auth;let wizardRevision=revision;const calls=[];
 const execute=(binary,args,options={})=>{
  calls.push([binary,...args]);
  if(binary==='git')return args[0]==='ls-tree'?'040000 tree '+wizardTree+'\twizard':args[1]==='HEAD'?revision:sourceTree;
  if(args[0]==='login'){auth=options.env.DOCKER_CONFIG;assert.equal(options.input,env.CI_REGISTRY_PASSWORD);return '';}
  if(args[0]==='image'&&args[1]==='inspect'){
   const wizard=args[2].includes('wizard');return JSON.stringify([{Id:id(wizard?'2':'1'),RepoDigests:[env.CI_REGISTRY_IMAGE+(wizard?'/successor-wizard':'/successor')+'@'+id(wizard?'8':'7')],Config:{Labels:{'org.system-bootstrapper.test-job':'20','org.opencontainers.image.revision':wizard?wizardRevision:revision,'org.system-bootstrapper.source-revision':revision}}}]);
  }
  return '';
 };
 const result=api.publishSuccessor(evidence,execute,env,root);
 assert.equal(result.sourceLayout,'system-monorepo-v1');assert.equal(result.wizardSourceTree,wizardTree);assert.equal(result.wizardRevision,undefined);
 assert.equal(fs.existsSync(auth),false);assert(!calls.some(c=>c.includes('build')||c.includes(env.CI_REGISTRY_PASSWORD)));
 const bytes=fs.readFileSync(path.join(root,result.candidateEvidencePath));
 assert.deepEqual(api.readSuccessorRelease(result,bytes,evidence.context(env),env.CI_REGISTRY_IMAGE,evidence),result);
 for(const invalid of [{...result,wizardSourceTree:'HEAD'},{...result,candidateEvidenceSha256:'0'.repeat(64)},{...result,wizardImageId:id('f')},{...result,registryReference:'foreign/image@'+id('7')}])assert.throws(()=>api.readSuccessorRelease(invalid,bytes,evidence.context(env),env.CI_REGISTRY_IMAGE,evidence));
 assert.throws(()=>api.readSuccessorRelease(result,Buffer.concat([bytes,Buffer.from(' ')]),evidence.context(env),env.CI_REGISTRY_IMAGE,evidence));
 wizardRevision=wizardTree;const count=calls.filter(c=>c.includes('login')).length;
 assert.throws(()=>api.publishSuccessor(evidence,execute,env,root),/Wizard image/);assert.equal(calls.filter(c=>c.includes('login')).length,count);
});
test('unsafe CI integer identities and unknown evidence fail before publication',()=>{
 assert.throws(()=>evidence.context({...env,CI_JOB_ID:'9007199254740993'}));
 for(const input of [null,{},[],{results:[],evidence:{},images:{}}])assert.throws(()=>evidence.validateEvidence(input,evidence.context(env)));
});
test('Docker Hub monorepo publication preserves source tree and verifies both labels before public login',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'release-hub-module-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const hubEnv={...env,CI_PIPELINE_SOURCE:'push',CI_COMMIT_REF_PROTECTED:'true',CI_DEFAULT_BRANCH:'main',CI_COMMIT_BRANCH:'main',DOCKERHUB_PUBLISH_ENABLED:'true',DOCKERHUB_REPOSITORY:'fixture/system',DOCKERHUB_WIZARD_REPOSITORY:'fixture/wizard',DOCKERHUB_USER:'fixture',DOCKERHUB_TOKEN:'fixture-token'};
 const bytes=Buffer.from(JSON.stringify(sharedProof())),dir=path.join(root,'test-results/successor');fs.mkdirSync(dir,{recursive:true});
 const released={format:'system-successor-release-v1',...monorepo,projectId:4,pipelineId:10,candidateJobId:20,imageId:id('1'),wizardImageId:id('2'),registryReference:env.CI_REGISTRY_IMAGE+'/successor@'+id('7'),wizardRegistryReference:env.CI_REGISTRY_IMAGE+'/successor-wizard@'+id('8'),candidateEvidencePath:'test-results/successor/candidate-results.json',candidateEvidenceSha256:api.sha256(bytes)};
 fs.writeFileSync(path.join(dir,'candidate-results.json'),bytes);fs.writeFileSync(path.join(dir,'release.json'),JSON.stringify(released));
 const logins=[],auth=[];let wizardRevision=revision;
 const execute=(binary,args,options={})=>{
  if(binary==='git')return args[0]==='ls-tree'?'040000 tree '+wizardTree+'\twizard':args[1]==='HEAD'?revision:sourceTree;
  if(args[0]==='login'){logins.push(args.at(-1));auth.push(options.env.DOCKER_CONFIG);return '';}
  if(args[0]==='image'&&args[1]==='inspect'){
   const wizard=args[2].includes('wizard');return JSON.stringify([{Id:id(wizard?'2':'1'),Os:'linux',Architecture:'amd64',Config:{Labels:{'org.system-bootstrapper.test-job':'20','org.opencontainers.image.revision':wizard?wizardRevision:revision,'org.system-bootstrapper.source-revision':revision}}}]);
  }
  return '';
 };
 const inspect=async repository=>({digest:id(repository.endsWith('wizard')?'8':'7'),configDigest:id(repository.endsWith('wizard')?'2':'1')});
 const service=new api.ReleaseService(profile,lifecycle,execute);
 const published=await service.publishDockerHub(hubEnv,root,inspect);
 assert.equal(published.sourceLayout,monorepo.sourceLayout);assert.equal(published.wizardSourceTree,wizardTree);assert.equal(published.wizard.sourceRevision,revision);assert.equal(published.wizardRevision,undefined);
 assert.deepEqual(logins,[env.CI_REGISTRY,'docker.io']);assert(auth.every(dir=>!fs.existsSync(dir)));
 wizardRevision=wizardTree;logins.length=0;
 await assert.rejects(service.publishDockerHub(hubEnv,root,inspect),/platform\/source\/job/);
 assert.deepEqual(logins,[env.CI_REGISTRY]);assert(auth.every(dir=>!fs.existsSync(dir)));
});
test('missing lifecycle policy cannot silently accept candidate evidence',()=>{
 assert.throws(()=>api.createEvidence(profile,undefined).validateEvidence(proof(),evidence.context(env)));
});

test('System Beta authority binds source, images and CI attempt and retains v2 stages through lineage sanitization',()=>{
 const value=sharedProof(),ci={...evidence.context(env),...monorepo};
 assert.equal(evidence.validateEvidence(value,ci),id('1'));
 for(const mutate of [p=>delete p.sourceLayout,p=>delete p.sourceTree,p=>p.wizardSourceTree='f'.repeat(40),
   p=>p.ciIdentity.candidateJobId=21,p=>p.evidence.guidedPreview.candidate.helperImage=id('9'),
   p=>p.evidence.guidedPreview.candidate.sourceTree='f'.repeat(40),p=>p.evidence.guidedPreview.verifier.mode='native',
   p=>p.evidence.guidedPreview=fixture.proof(id('2'))]){
  const changed=structuredClone(value);mutate(changed);assert.throws(()=>evidence.validateEvidence(changed,ci));
 }
 const origin=structuredClone(value);origin.format='system-guided-preview-origin-v1';origin.runId='e'.repeat(24);
 origin.results.push({name:'recovery-original-host-removed',status:'passed'});
 origin.evidence.recovery={runId:value.runId,backupOnly:true,originalHostRemoved:true,guidedBindingRestored:true};
 const clean=evidence.sanitizeGuidedReceipt(origin);assert(clean);
 assert(lifecycle.stagesV2.every(name=>clean.results.some(row=>row.name===name)));
 value.results=value.results.filter(row=>!lifecycle.stagesV2.includes(row.name));delete value.evidence.guidedPreview;
 value.evidence.recovery={guidedBindingRestored:true};value.guidedPreviewReceipt=clean;
 assert.equal(evidence.validateEvidence(value,ci),id('1'));
 for(const mutate of [p=>p.guidedPreviewReceipt.sourceTree='f'.repeat(40),p=>p.guidedPreviewReceipt.ciIdentity.pipelineId=11,
   p=>p.guidedPreviewReceipt.results.pop(),p=>delete p.evidence.recovery.guidedBindingRestored]){
  const changed=structuredClone(value);mutate(changed);assert.throws(()=>evidence.validateEvidence(changed,ci));
 }
});
