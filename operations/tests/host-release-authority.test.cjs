const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {HostReleaseAuthorityService}=require('../dist/host/release-authority.service');
const profile=require('../../gitlab/security-release.json'),lifecycle=require('../../gitlab/guided-preview-evidence'),fixture=require('../../tests/shared/guided-preview-fixture');
const revision='a'.repeat(40),sourceTree='b'.repeat(40),wizardTree='c'.repeat(40),id=n=>'sha256:'+n.repeat(64);
const monorepo={sourceLayout:'system-monorepo-v1',sourceRevision:revision,sourceTree,wizardSourceTree:wizardTree};
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

test('host authority binds actual candidate CI and source to full System Beta proof',()=>{
 const service=new HostReleaseAuthorityService(lifecycle),value=sharedProof();value.images.gitlab=value.evidence.gitlabUpgrade.toImageId;
 const release={format:'system-successor-release-v1',...monorepo,projectId:4,pipelineId:10,candidateJobId:20,imageId:id('1'),wizardImageId:id('2'),registryRepository:'registry.example.test/system/successor',registryReference:'registry.example.test/system/successor@'+id('7'),candidateEvidencePath:'test-results/successor/candidate-results.json'};
 function verify(proof,changes={}){const bytes=Buffer.from(JSON.stringify(proof));return service.inputs(Buffer.from(JSON.stringify({...release,candidateEvidenceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),...changes})),bytes,profile);}
 assert.equal(verify(value).release.sourceLayout,'system-monorepo-v1');
 for(const mutate of [p=>delete p.evidence.guidedPreview,p=>p.evidence.guidedPreview=fixture.proof(id('2')),p=>p.ciIdentity.candidateJobId++,p=>p.wizardSourceTree='e'.repeat(40),p=>p.evidence.guidedPreview.candidate.fixtureCandidateJobId++]){const changed=structuredClone(value);mutate(changed);assert.throws(()=>verify(changed),/System-Beta-authority/);}
 assert.throws(()=>verify(value,{wizardRevision:wizardTree}),/invalid-successor-source/);
 assert.throws(()=>verify(value,{candidateEvidenceSha256:'f'.repeat(64)}),/evidence-hash/);
});
