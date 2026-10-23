'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {context, validateEvidence, candidates, publish} = require('../../gitlab/publish-successor');
const release = require('../../gitlab/security-release.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'successor-publication-test-'));
const sha = 'a'.repeat(40), tree = 'b'.repeat(40), wizard = 'c'.repeat(40);
const id = 'sha256:' + 'd'.repeat(64), registryDigest = 'sha256:' + 'e'.repeat(64);
const env = {CI_COMMIT_SHA: sha, CI_PROJECT_ID: '4', CI_PIPELINE_ID: '10', CI_JOB_ID: '20',
  CI_REGISTRY: 'registry.example.test', CI_PROJECT_PATH: 'example/system',
  CI_REGISTRY_IMAGE: 'registry.example.test/example/system', CI_PIPELINE_SOURCE: 'merge_request_event',
  CI_REGISTRY_USER: 'fixture', CI_REGISTRY_PASSWORD: 'fixture-not-a-real-secret'};
const proof = {runId: 'f'.repeat(24), sourceRevision: sha, fullAcceptance: true, images: {candidate: id},
  results: ['gitlab-upgrade-migrated-data', 'gitlab-upgrade-registry-ci',
    'gitlab-upgrade-restored-checkpoint', 'cleanup'].map(name => ({name, status: 'passed'})),
  evidence: {gitlabUpgrade: {fromImage: release.fromImage, toImage: release.toImage,
    migrationVerified: true, rollbackVerified: true, registryVerified: true, checkpointVerified: true}}};
const ci = context(env);
assert.throws(() => context({...env, CI_REGISTRY_IMAGE: 'other.example.test/foreign/project'}));
assert.throws(() => validateEvidence({...proof, sourceRevision: tree}, ci));
assert.throws(() => validateEvidence({...proof, results: proof.results.slice(1)}, ci));
assert.throws(() => validateEvidence({...proof, results: [{name: 'cleanup', status: 'failed'}]}, ci));
assert.throws(() => validateEvidence({...proof, evidence: {gitlabUpgrade: {...proof.evidence.gitlabUpgrade, rollbackVerified: false}}}, ci));

try {
  const dir = path.join(root, 'test-results/e2e', proof.runId);
  fs.mkdirSync(dir, {recursive: true});
  const original = Buffer.from(JSON.stringify(proof));
  fs.writeFileSync(path.join(dir, 'results.json'), original);
  const summary = {...proof, runId: '1'.repeat(24),
    results: ['recovery-original-host-removed', 'cleanup'].map(name => ({name, status: 'passed'})),
    evidence: {...proof.evidence, recovery: {runId: proof.runId, backupOnly: true, originalHostRemoved: true}}};
  const summaryDir = path.join(root, 'test-results/e2e', summary.runId);
  fs.mkdirSync(summaryDir);
  const writeSummary = value => fs.writeFileSync(path.join(summaryDir, 'results.json'), JSON.stringify(value));
  writeSummary(summary);
  assert.deepEqual(candidates(path.join(root, 'test-results/e2e'), ci).map(item => item.proof.runId), [proof.runId],
    'the original host summary resolves to the complete restored migration receipt');
  writeSummary({...summary, evidence: {...summary.evidence, recovery: {...summary.evidence.recovery, runId: '2'.repeat(24)}}});
  assert.throws(() => candidates(path.join(root, 'test-results/e2e'), ci), /matching complete successor receipt/);
  writeSummary({...summary, images: {candidate: registryDigest}});
  assert.throws(() => candidates(path.join(root, 'test-results/e2e'), ci), /matching complete successor receipt/);
  writeSummary({...summary, results: [{name: 'cleanup', status: 'failed'}]});
  assert.throws(() => candidates(path.join(root, 'test-results/e2e'), ci), /complete passing/);
  writeSummary({...summary, evidence: {...summary.evidence,
    gitlabUpgrade: {...summary.evidence.gitlabUpgrade, toImageId: registryDigest}}});
  assert.throws(() => candidates(path.join(root, 'test-results/e2e'), ci), /matching complete successor receipt/);
  writeSummary(summary);
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({...proof, results: proof.results.slice(1)}));
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
    if (args[0] === 'image' && args[1] === 'inspect') return JSON.stringify([{Id: wrongImage ? registryDigest : id,
      RepoDigests: [ci.registryRepository + '@' + registryDigest], Config: {Labels: {
        'org.system-bootstrapper.test-job': env.CI_JOB_ID, 'org.opencontainers.image.revision': sha}}}]);
    return '';
  };
  const result = publish(env, root, execute);
  assert.equal(result.registryReference, ci.registryRepository + '@' + registryDigest);
  assert.equal(fs.existsSync(privateAuth), false, 'private registry config is cleaned after success');
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({...proof,
    results: [...proof.results, {name: 'cleanup', status: 'passed'}]}));
  const frozen = fs.readFileSync(path.join(root, result.candidateEvidencePath));
  assert.deepEqual(frozen, original, 'later cleanup cannot mutate the released evidence');
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
