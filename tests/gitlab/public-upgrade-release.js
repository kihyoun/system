'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const path = require('node:path');
const {publicUpgrade} = require('../../gitlab/public-upgrade-release');
const root = path.resolve(__dirname, '../..');
function fixture() {
  const {PublicUpgradePublicationService}=require('../../operations/dist/testing/public-upgrade-publication.service');
  const generated=new PublicUpgradePublicationService({verify(){throw Error('unexpected checkpoint');}}).prepare(root,require('../shared/public-upgrade-fixture').publicationFixture());
  const metadata=generated.metadata,proof=JSON.parse(generated.proof),security=require('../../gitlab/security-release.json');
  const jobs = proof.publication.jobs.map(row => ({...row, pipeline: {id: row.pipelineId}, commit: {id: row.sourceRevision}}));
  return {metadata, proof, security, jobs};
}
test('sanitized public proof round-trips through shared native authority without private artifact access', () => {
  const {metadata, proof, security, jobs} = fixture();
  proof.evidence.privateAddress = 'must-never-publish.internal';
  proof.evidence.evidence.privateConfiguration = 'private-fixture-password';
  proof.evidence.results[0].rawLog = 'private-fixture-password';
  const assets = publicUpgrade(metadata, proof.release, proof.evidence, proof.graph, jobs);
  const payload = Object.values(assets)[0];
  assert(!payload.toString().includes('must-never-publish'));
  assert(!payload.toString().includes('private-fixture-password'));
  assert(!payload.toString().includes('registry.example.invalid'));
  const {HostReleaseAuthorityService}=require('../../operations/dist/host/release-authority.service');
  const accepted=new HostReleaseAuthorityService({}).publicInputs(metadata,payload,security);
  assert.equal(accepted.release.imageId,proof.release.imageId);
});
test('publisher refuses an untested transition, failed runtime check or false preservation claim', () => {
  for (const change of [proof => { proof.results=proof.results.filter(row=>row.name!=='public-release-upgrade-1-1-3-to-1-2-0'); }, proof => { proof.results.find(row=>row.name==='public-release-upgrade-1-1-3-to-1-2-0').status = 'failed'; },
    proof => { proof.evidence.publicUpgrade.rollbackVerified = false; },
    proof => { proof.evidence.publicUpgrade.fromVersion = 'unknown'; }]) {
    const {metadata, proof, jobs} = fixture(); change(proof.evidence);
    assert.throws(() => publicUpgrade(metadata, proof.release, proof.evidence, proof.graph, jobs), /matching candidate proof/);
  }
});

test('public monorepo authority retains only validated v2 fixture boundary and refuses substituted source or attempt',()=>{
  const {metadata,proof,jobs}=fixture(),released=proof.release,value=proof.evidence;
  const lifecycle=require('../../gitlab/guided-preview-evidence'),beta=require('../shared/system-beta-evidence-fixture').proof();
  released.sourceLayout='system-monorepo-v1';released.wizardSourceTree='f'.repeat(40);delete released.wizardRevision;
  Object.assign(value,{sourceLayout:released.sourceLayout,sourceTree:released.sourceTree,wizardSourceTree:released.wizardSourceTree,
    ciIdentity:{projectId:released.projectId,pipelineId:released.pipelineId,candidateJobId:released.candidateJobId}});
  Object.assign(beta.candidate,{sourceCommit:released.sourceRevision,sourceTree:released.sourceTree,wizardSourceTree:released.wizardSourceTree,
    helperImage:value.images.candidate,wizardImageId:value.images.wizard,fixturePipelineId:released.pipelineId,fixtureCandidateJobId:released.candidateJobId});
  beta.productionImageId=value.images.wizard;beta.productionRetained.runningImage=value.images.wizard;
  beta.setup.sourceCommit=released.sourceRevision;beta.beta.stoppedThroughPipelineId=released.pipelineId;
  for(const row of [beta.beta.deployment,beta.beta.stopped])Object.assign(row,{sourceCommit:released.sourceRevision,pipelineId:released.pipelineId,generation:'p'+released.pipelineId+'-j201'});
  value.images.runner='sha256:'+'4'.repeat(64);
  const security=require('../../gitlab/security-release.json'),upgrade=value.evidence.gitlabUpgrade;
  Object.assign(upgrade,{fromImage:security.fromImage,toImage:security.toImage,runnerImage:security.runner.toImage,
    runnerImageId:value.images.runner,fromRunnerImageId:'sha256:'+'1'.repeat(64),runnerVersion:security.runner.toVersion,
    helperImage:security.runner.helperImage,helperImageId:'sha256:'+'2'.repeat(64),fromHelperImageId:'sha256:'+'3'.repeat(64),
    jobCaBundleSha256:security.jobCaBundleSha256,securityTrustVerified:true,runnerUpgradeVerified:true,runnerManagerIdentityPreserved:true});
  value.results.push({name:'gitlab-upgrade-security-trust',status:'passed'});
  value.evidence.guidedPreview=beta;value.results.push(...lifecycle.stagesV2.map(name=>({name,status:'passed'})));
  beta.secret='never-publish';beta.candidate.jobs=[{id:999,status:'success'}];
  const bytes=Object.values(publicUpgrade(metadata,released,value,proof.graph,jobs))[0],published=JSON.parse(bytes);
  assert.equal(published.evidence.evidence.guidedPreview.verifier.mode,'contract-fixture');
  assert(!bytes.toString().includes('never-publish'));assert(!published.evidence.evidence.guidedPreview.candidate.jobs);
  assert.equal(published.evidence.ciIdentity.candidateJobId,released.candidateJobId);
  for(const mutate of [p=>p.ciIdentity.candidateJobId++,p=>delete p.evidence.guidedPreview,p=>p.sourceTree='0'.repeat(40),
    p=>p.evidence.guidedPreview.verifier.mode='native']){
    const changed=structuredClone(value);mutate(changed);assert.throws(()=>publicUpgrade(metadata,released,changed,proof.graph,jobs));
  }
});

test('future public-upgrade fixture carries real original Beta observations without moving them to restored host',()=>{
  const value=require('../shared/public-upgrade-fixture').publicationFixture(),spec=value.spec,beta=require('../shared/system-beta-evidence-fixture').proof();
  spec.sourceLayout='system-monorepo-v1';spec.wizardSourceTree='f'.repeat(40);delete spec.wizardSourceRevision;
  beta.productionImageId=spec.images.wizard.id;beta.productionRetained.runningImage=spec.images.wizard.id;
  Object.assign(beta.candidate,{sourceCommit:spec.sourceRevision,sourceTree:spec.sourceTree,wizardSourceTree:spec.wizardSourceTree,
    helperImage:spec.images.candidate.id,wizardImageId:spec.images.wizard.id,fixturePipelineId:spec.ciIdentity.pipelineId,fixtureCandidateJobId:spec.ciIdentity.candidateJobId});
  beta.setup.sourceCommit=spec.sourceRevision;beta.beta.stoppedThroughPipelineId=spec.ciIdentity.pipelineId;
  for(const row of [beta.beta.deployment,beta.beta.stopped])Object.assign(row,{sourceCommit:spec.sourceRevision,pipelineId:spec.ciIdentity.pipelineId,generation:'p'+spec.ciIdentity.pipelineId+'-j201'});
  value.guidedOrigin={runId:'e'.repeat(24),guidedPreview:beta,results:[...require('../../gitlab/guided-preview-evidence').stagesV2,'recovery-original-host-removed','cleanup'].map(name=>({name,status:'passed'}))};
  const {PublicUpgradePublicationService}=require('../../operations/dist/testing/public-upgrade-publication.service');
  const service=new PublicUpgradePublicationService({verify(){throw Error('unexpected checkpoint');}});
  const published=JSON.parse(service.prepare(root,value).proof);
  assert.equal(require('../../gitlab/publish-successor').validateEvidence(published.evidence,published.release),spec.images.candidate.id);
  assert.equal(published.evidence.guidedPreviewReceipt.runId,value.guidedOrigin.runId);
  assert.equal(published.evidence.evidence.guidedPreview,undefined);
  assert.equal(published.evidence.guidedPreviewReceipt.evidence.guidedPreview.verifier.mode,'contract-fixture');
  assert(!published.evidence.results.some(row=>row.name==='system-beta-native-deploy'));
});
