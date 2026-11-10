'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {context, validateEvidence, candidates, publish} = require('../../gitlab/publish-successor');
const release = require('../../gitlab/security-release.json');
const guided = require('../shared/guided-preview-fixture');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'successor-publication-test-'));
const sha = 'a'.repeat(40), tree = 'b'.repeat(40), wizard = 'c'.repeat(40);
const id = 'sha256:' + 'd'.repeat(64), registryDigest = 'sha256:' + 'e'.repeat(64);
const wizardId = 'sha256:' + '8'.repeat(64), wizardDigest = 'sha256:' + '9'.repeat(64);
const env = {CI_COMMIT_SHA: sha, CI_PROJECT_ID: '4', CI_PIPELINE_ID: '10', CI_JOB_ID: '20',
  CI_REGISTRY: 'registry.example.test', CI_PROJECT_PATH: 'example/system',
  CI_REGISTRY_IMAGE: 'registry.example.test/example/system', CI_PIPELINE_SOURCE: 'merge_request_event',
  CI_REGISTRY_USER: 'fixture', CI_REGISTRY_PASSWORD: 'fixture-not-a-real-secret'};
const proof = {runId: 'f'.repeat(24), sourceRevision: sha, fullAcceptance: true, images: {candidate: id, runner: registryDigest, wizard: wizardId},
  results: ['gitlab-upgrade-migrated-data', 'gitlab-upgrade-registry-ci',
    'gitlab-upgrade-restored-checkpoint', 'gitlab-upgrade-security-trust',
    'storage-global-live-lease', 'storage-refuse-nonempty-and-corrupt-restore',
    'storage-detached-backup-normal-operation', 'cleanup',...guided.stages].map(name => ({name, status: 'passed'})),
  evidence: {guidedPreview:guided.proof(wizardId),gitlabUpgrade: {fromImage: release.fromImage, toImage: release.toImage,fromImageId:'sha256:'+'2'.repeat(64),toImageId:'sha256:'+'3'.repeat(64),
    migrationVerified: true, rollbackVerified: true, registryVerified: true, checkpointVerified: true,
    runnerImage: release.runner.toImage, runnerImageId: registryDigest, fromRunnerImageId: 'sha256:'+'6'.repeat(64), helperImageId: 'sha256:'+'7'.repeat(64), fromHelperImageId: 'sha256:'+'5'.repeat(64), runnerUpgradeVerified: true, runnerManagerIdentityPreserved: true, runnerVersion: release.runner.toVersion,
    helperImage: release.runner.helperImage, jobCaBundleSha256: release.jobCaBundleSha256, securityTrustVerified: true},
    storage: {localLiveVerified: true, externalSeedRestored: true, backupDetached: true,
      missingBackupGuardVerified: true, globalLeaseVerified: true, invalidRestoreGuardVerified: true}}};
const ci = context(env);
for(const change of [value=>delete value.evidence.guidedPreview,
  value=>value.evidence.guidedPreview.credentialCleanupUncertain=true,
  ...['source','review','merge','beta'].map(context=>value=>delete value.evidence.guidedPreview[context]),
  ...guided.stages.map(name=>value=>value.results=value.results.filter(row=>row.name!==name)),
  value=>delete value.evidence.guidedPreview.beta.stoppedThroughPipelineId,
  value=>delete value.evidence.guidedPreview.review.mergeRequestIid,value=>delete value.evidence.guidedPreview.beta,
  value=>value.evidence.guidedPreview.productionRetained.runningImage=id,
  value=>value.evidence.guidedPreview.merge.normalGate=false,
  value=>value.evidence.guidedPreview.merge.jobs[0].status='failed',
  value=>value.evidence.guidedPreview.review.stopped.generation='p99-j99',
  value=>value.evidence.guidedPreview.beta.deploy.status='failed',
  value=>value.results=value.results.filter(row=>row.name!=='guided-preview-native-merge-and-build'),
  value=>value.results.find(row=>row.name==='guided-preview-native-beta-stop').status='failed']) {
  const value=structuredClone(proof);change(value);assert.throws(()=>validateEvidence(value,ci));
}

assert.throws(() => context({...env, CI_REGISTRY_IMAGE: 'other.example.test/foreign/project'}));
assert.throws(() => validateEvidence({...proof, sourceRevision: tree}, ci));
assert.throws(() => validateEvidence({...proof, results: proof.results.slice(1)}, ci));
assert.throws(() => validateEvidence({...proof, results: [{name: 'cleanup', status: 'failed'}]}, ci));
assert.throws(() => validateEvidence({...proof, evidence: {gitlabUpgrade: {...proof.evidence.gitlabUpgrade, rollbackVerified: false}}}, ci));
for(const patch of [{runnerVersion:'19.4.0'},{runnerImageId:id},{jobCaBundleSha256:'0'.repeat(64)},{securityTrustVerified:false}])assert.throws(()=>validateEvidence({...proof,evidence:{gitlabUpgrade:{...proof.evidence.gitlabUpgrade,...patch}}},ci),/Runner and effective CA/);
for(const key of Object.keys(proof.evidence.storage))assert.throws(()=>validateEvidence({...proof,
  evidence:{...proof.evidence,storage:{...proof.evidence.storage,[key]:false}}},ci),/local storage and external Seed/);

try {
  const {recover}=require('../shared/disposable-candidate');
  const recovered=recover({...proof,resources:[]});assert.equal(recovered.cleanup(),true);
  const roundtrip=path.join(root,'cleanup-roundtrip');fs.mkdirSync(roundtrip);recovered.report(roundtrip);
  const again=recover(JSON.parse(fs.readFileSync(path.join(roundtrip,'results.json'))));assert.equal(again.cleanup(),true);again.report(roundtrip);
  assert.equal(validateEvidence(JSON.parse(fs.readFileSync(path.join(roundtrip,'results.json'))),ci),id,
    'publication still validates the same guided source/MR/merge/Beta identities after repeated cleanup reports');
  const dir = path.join(root, 'test-results/e2e', proof.runId);
  fs.mkdirSync(dir, {recursive: true});
  const ciIdentity={projectId:ci.projectId,pipelineId:ci.pipelineId,candidateJobId:ci.candidateJobId};
  const restored={...proof,ciIdentity,results:proof.results.filter(row=>!guided.stages.includes(row.name)),
    evidence:{...proof.evidence,recovery:{guidedBindingRestored:true}}};
  delete restored.evidence.guidedPreview;
  assert.throws(()=>validateEvidence(restored,ci),/guided preview/,'the actual restored working receipt alone has no original-host lifecycle proof');
  const original = Buffer.from(JSON.stringify(restored));
  fs.writeFileSync(path.join(dir, 'results.json'), original);
  const summary = {...proof,ciIdentity, runId: '1'.repeat(24),
    results: [...guided.stages,'recovery-original-host-removed', 'cleanup'].map(name => ({name, status: 'passed'})),
    evidence: {...proof.evidence, recovery: {runId: proof.runId, backupOnly: true, originalHostRemoved: true,guidedBindingRestored:true}}};
  delete summary.evidence.storage;
  const summaryDir = path.join(root, 'test-results/e2e', summary.runId);
  fs.mkdirSync(summaryDir);
  const writeSummary = value => fs.writeFileSync(path.join(summaryDir, 'results.json'), JSON.stringify(value));
  writeSummary(summary);
  const accepted=candidates(path.join(root,'test-results/e2e'),ci)[0];
  assert.equal(accepted.proof.guidedPreviewReceipt.runId,summary.runId);
  assert.equal(accepted.proof.guidedPreviewReceipt.evidence.recovery.runId,restored.runId);
  assert.ok(!accepted.proof.results.some(row=>guided.stages.includes(row.name)),'guided stages remain attributed to the original host only');
  assert.equal(accepted.proof.evidence.guidedPreview,undefined);
  assert.equal(validateEvidence(accepted.proof,ci),id);
  const contaminated=structuredClone(accepted.proof),marker='secret-fixture-token';
  contaminated.guidedPreviewReceipt.ciIdentity.token=marker;
  contaminated.guidedPreviewReceipt.evidence.guidedPreview.review.deploy.trace=marker;
  contaminated.guidedPreviewReceipt.evidence.guidedPreview.url='https://'+marker+'@example.test';
  contaminated.guidedPreviewReceipt.results[0].url=marker;
  const compositeRoundtrip=path.join(root,'composite-roundtrip');fs.mkdirSync(compositeRoundtrip);
  const recoveredComposite=recover({...contaminated,resources:[]});assert.equal(recoveredComposite.cleanup(),true);recoveredComposite.report(compositeRoundtrip);
  const compositeAgain=recover(JSON.parse(fs.readFileSync(path.join(compositeRoundtrip,'results.json'))));assert.equal(compositeAgain.cleanup(),true);compositeAgain.report(compositeRoundtrip);
  const compositeReport=JSON.parse(fs.readFileSync(path.join(compositeRoundtrip,'results.json')));
  assert.ok(!JSON.stringify(compositeReport).includes(marker));assert.equal(validateEvidence(compositeReport,ci),id);

  for(const change of [value=>value.sourceRevision=tree,
    ...['projectId','pipelineId','candidateJobId'].map(key=>value=>value.ciIdentity={...value.ciIdentity,[key]:value.ciIdentity[key]+1}),
    value=>delete value.evidence.guidedPreview,
    value=>{value.evidence.guidedPreview.productionImageId=id;value.evidence.guidedPreview.productionRetained.runningImage=id;},
    value=>value.results=value.results.filter(row=>row.name!=='guided-preview-native-merge-and-build'),
    value=>value.evidence.recovery.guidedBindingRestored=false]) {
    const invalid=structuredClone(summary);change(invalid);writeSummary(invalid);
    assert.throws(()=>candidates(path.join(root,'test-results/e2e'),ci));
  }
  fs.unlinkSync(path.join(summaryDir,'results.json'));fs.rmdirSync(summaryDir);
  assert.throws(()=>candidates(path.join(root,'test-results/e2e'),ci),/guided preview/,'a restored receipt cannot omit its original guided source');
  fs.mkdirSync(summaryDir);writeSummary(summary);
  const recoveredOriginal=recover({...summary,resources:[]});assert.equal(recoveredOriginal.cleanup(),true);recoveredOriginal.report(summaryDir);
  const recoveredRestored=recover({...restored,resources:[]});assert.equal(recoveredRestored.cleanup(),true);recoveredRestored.report(dir);
  const linkedAfterCleanup=candidates(path.join(root,'test-results/e2e'),ci)[0];
  assert.deepEqual(linkedAfterCleanup.proof.ciIdentity,ciIdentity);assert.equal(validateEvidence(linkedAfterCleanup.proof,ci),id);
  writeSummary(summary);fs.writeFileSync(path.join(dir,'results.json'),original);
  assert.deepEqual(candidates(path.join(root, 'test-results/e2e'), ci).map(item => item.proof.runId), [proof.runId],
    'the original host summary resolves to the complete restored migration receipt');
  writeSummary({...summary, evidence: {...summary.evidence, recovery: {...summary.evidence.recovery, runId: '2'.repeat(24)}}});
  assert.throws(() => candidates(path.join(root, 'test-results/e2e'), ci), /matching complete successor receipt/);
  writeSummary({...summary, images: {...summary.images, candidate: registryDigest}});
  assert.throws(() => candidates(path.join(root, 'test-results/e2e'), ci), /matching complete successor receipt/);
  writeSummary({...summary, results: [{name: 'cleanup', status: 'failed'}]});
  assert.throws(() => candidates(path.join(root, 'test-results/e2e'), ci), /complete passing/);
  writeSummary({...summary, evidence: {...summary.evidence,
    gitlabUpgrade: {...summary.evidence.gitlabUpgrade, toImageId: registryDigest}}});
  assert.throws(() => candidates(path.join(root, 'test-results/e2e'), ci), /matching complete successor receipt/);
  writeSummary(summary);
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({...restored, results: restored.results.slice(1)}));
  assert.throws(() => candidates(path.join(root, 'test-results/e2e'), ci), /required successor acceptance stage/);
  fs.writeFileSync(path.join(dir, 'results.json'), original);
  let privateAuth, wrongImage = false, pushFails = false;
  const calls = [];
  const execute = (binary, args, options = {}) => {
    calls.push([binary, ...args]);
    if (binary === 'git') {
      if (args.join(' ') === 'rev-parse HEAD^{tree}') return tree;
      if (args.join(' ') === 'rev-parse HEAD') return sha;
      return '160000 commit ' + wizard + '\twizard';
    }
    if (args[0] === 'login') {
      privateAuth = options.env.DOCKER_CONFIG;
      assert.equal(path.relative(path.join(root, 'test-results'), privateAuth).startsWith('..'), true);
      assert.equal(options.input, env.CI_REGISTRY_PASSWORD);
      fs.writeFileSync(path.join(privateAuth, 'config.json'), 'fixture-private-auth');
    }
    if (args[0] === 'push' && pushFails) throw Error('fixture-push-failure');
    if (args[0] === 'image' && args[1] === 'inspect') {
      const isWizard = args[2].includes('wizard');
      return JSON.stringify([{Id: wrongImage ? registryDigest : isWizard ? wizardId : id,
        RepoDigests: [(isWizard ? ci.registryRepository + '-wizard' : ci.registryRepository) + '@' + (isWizard ? wizardDigest : registryDigest)], Config: {Labels: {
          'org.system-bootstrapper.test-job': env.CI_JOB_ID, 'org.opencontainers.image.revision': isWizard ? wizard : sha,
          'org.system-bootstrapper.source-revision': sha}}}]);
    }
    return '';
  };
  const result = publish(env, root, execute);
  assert.equal(result.registryReference, ci.registryRepository + '@' + registryDigest);
  assert.equal(result.wizardImageId, wizardId);
  assert.equal(result.wizardRegistryReference, ci.registryRepository + '-wizard@' + wizardDigest);
  assert.equal(fs.existsSync(privateAuth), false, 'private registry config is cleaned after success');
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({...restored,
    results: [...restored.results, {name: 'cleanup', status: 'passed'}]}));
  const frozen = fs.readFileSync(path.join(root, result.candidateEvidencePath));
  assert.deepEqual(frozen, accepted.bytes, 'later cleanup cannot mutate the frozen restored proof and original guided lineage');
  const frozenProof=JSON.parse(frozen);assert.equal(validateEvidence(frozenProof,ci),id);
  for(const change of [value=>value.guidedPreviewReceipt.runId=value.runId,
    value=>value.guidedPreviewReceipt.evidence.recovery.runId='9'.repeat(24),
    value=>value.guidedPreviewReceipt.ciIdentity.candidateJobId=99,
    value=>value.guidedPreviewReceipt.sourceRevision=tree,
    value=>delete value.guidedPreviewReceipt,
    value=>value.evidence.recovery.guidedBindingRestored=false]) {
    const invalid=structuredClone(frozenProof);change(invalid);assert.throws(()=>validateEvidence(invalid,ci));
  }
  assert.equal(result.candidateEvidenceSha256, crypto.createHash('sha256').update(frozen).digest('hex'));
  assert.equal(calls.some(call => call.includes(env.CI_REGISTRY_PASSWORD)), false);
  assert.equal(calls.some(call => call[1] === 'build'), false, 'publication never rebuilds the accepted image');
  const duplicateDir = path.join(root, 'test-results/e2e', '3'.repeat(24));
  fs.mkdirSync(duplicateDir);
  fs.writeFileSync(path.join(duplicateDir, 'results.json'), JSON.stringify({...proof, runId: '3'.repeat(24)}));
  assert.throws(() => publish(env, root, execute), /Exactly one full successor acceptance receipt/,
    'two complete migration receipts still refuse ambiguous publication');
  fs.rmSync(duplicateDir, {recursive: true});
  pushFails = true;
  assert.throws(() => publish(env, root, execute));
  assert.equal(fs.existsSync(privateAuth), false, 'private registry config is cleaned after push failure');
  wrongImage = true;
  assert.throws(() => publish(env, root, execute));
  console.log('Successor publication checks passed: exact source/image, required evidence, frozen receipt, no rebuild and credential cleanup.');
} finally { fs.rmSync(root, {recursive: true, force: true}); }
