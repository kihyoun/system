'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {context, readEvidence, manifest, publish} = require('../../gitlab/publish-dockerhub');
const security = require('../../gitlab/security-release.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sha = 'a'.repeat(40), tree = 'b'.repeat(40), wizard = 'c'.repeat(40);
const id = n => 'sha256:' + n.repeat(64);
const env = {CI_COMMIT_SHA: sha, CI_PROJECT_ID: '4', CI_PIPELINE_ID: '10', CI_JOB_ID: '30',
  CI_DEFAULT_BRANCH: 'master', CI_COMMIT_BRANCH: 'master', CI_PIPELINE_SOURCE: 'push', CI_COMMIT_REF_PROTECTED: 'true',
  CI_REGISTRY: 'registry.example.test', CI_PROJECT_PATH: 'example/system',
  CI_REGISTRY_IMAGE: 'registry.example.test/example/system', CI_REGISTRY_USER: 'job', CI_REGISTRY_PASSWORD: 'scoped-fixture',
  DOCKERHUB_PUBLISH_ENABLED: 'true', DOCKERHUB_REPOSITORY: 'fixture/system', DOCKERHUB_WIZARD_REPOSITORY: 'fixture/wizard',
  DOCKERHUB_USER: 'fixture', DOCKERHUB_TOKEN: 'fixture-not-a-real-secret'};
const proof = {runId: 'f'.repeat(24), sourceRevision: sha, fullAcceptance: true,
  images: {candidate: id('1'), runner: id('2'), wizard: id('3')},
  results: ['gitlab-upgrade-migrated-data', 'gitlab-upgrade-registry-ci', 'gitlab-upgrade-restored-checkpoint',
    'gitlab-upgrade-security-trust', 'storage-global-live-lease', 'storage-refuse-nonempty-and-corrupt-restore',
    'storage-detached-backup-normal-operation', 'cleanup'].map(name => ({name, status: 'passed'})),
  evidence: {gitlabUpgrade: {fromImage: security.fromImage, toImage: security.toImage,
    migrationVerified: true, rollbackVerified: true, registryVerified: true, checkpointVerified: true,
    runnerImage: security.runner.toImage, runnerImageId: id('2'), fromRunnerImageId: id('4'),
    helperImageId: id('5'), fromHelperImageId: id('6'), runnerUpgradeVerified: true, runnerManagerIdentityPreserved: true,
    runnerVersion: security.runner.toVersion, helperImage: security.runner.helperImage,
    jobCaBundleSha256: security.jobCaBundleSha256, securityTrustVerified: true},
  storage: {localLiveVerified: true, externalSeedRestored: true, backupDetached: true,
    missingBackupGuardVerified: true, globalLeaseVerified: true, invalidRestoreGuardVerified: true}}};
const released = {format: 'system-successor-release-v1', sourceRevision: sha, sourceTree: tree, wizardRevision: wizard,
  projectId: 4, pipelineId: 10, candidateJobId: 20, imageId: id('1'), wizardImageId: id('3'),
  registryReference: env.CI_REGISTRY_IMAGE + '/successor@' + id('7'),
  wizardRegistryReference: env.CI_REGISTRY_IMAGE + '/successor-wizard@' + id('8'),
  candidateEvidencePath: 'test-results/successor/candidate-results.json', candidateEvidenceSha256: hash(JSON.stringify(proof))};

async function main() {
  for (const patch of [{CI_PIPELINE_SOURCE: 'merge_request_event'}, {CI_COMMIT_REF_PROTECTED: 'false'},
    {CI_COMMIT_BRANCH: 'feature'}, {DOCKERHUB_PUBLISH_ENABLED: 'false'}, {CI_COMMIT_TAG: 'latest'},
    {DOCKERHUB_REPOSITORY: 'https://attacker.invalid/repo'}, {DOCKERHUB_WIZARD_REPOSITORY: env.DOCKERHUB_REPOSITORY}])
    assert.throws(() => context({...env, ...patch}));
  assert.equal(context(env).versionTag, null);
  assert.equal(context({...env, CI_COMMIT_TAG: 'v1.2.3', CI_COMMIT_BRANCH: undefined}).versionTag, 'v1.2.3');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dockerhub-publication-test-'));
  const artifacts = path.join(root, 'test-results/successor');
  fs.mkdirSync(artifacts, {recursive: true});
  const writeRelease = value => fs.writeFileSync(path.join(artifacts, 'release.json'), JSON.stringify(value));
  fs.writeFileSync(path.join(artifacts, 'candidate-results.json'), JSON.stringify(proof));
  writeRelease(released);
  for (const patch of [{pipelineId: 11}, {projectId: 5}, {sourceRevision: tree},
    {candidateEvidenceSha256: '0'.repeat(64)}, {wizardImageId: id('9')},
    {registryReference: 'other.invalid/foreign/successor@' + id('7')}]) {
    writeRelease({...released, ...patch});
    assert.throws(() => readEvidence(root, context(env), env));
  }
  writeRelease(released);
  const published = new Map(), calls = [];
  let activeRelease = released;
  let privateAuth, pushFails = false, wrongWizard = false, wrongPlatform = false, conflictOnRecheck = false;
  const inspectManifest = async (repo, selector) => {
    if (conflictOnRecheck && selector.startsWith('sha-') && calls.some(call => call[1] === 'login'))
      return {digest: id('9'), imageId: id('9')};
    return published.get(repo + ':' + selector) || null;
  };
  const execute = (binary, args, options = {}) => {
    calls.push([binary, ...args]);
    if (binary === 'git') {
      if (args.join(' ') === 'rev-parse HEAD') return sha;
      if (args.join(' ') === 'rev-parse HEAD^{tree}') return tree;
      if (args[0] === 'ls-tree') return '160000 commit ' + wizard + '\twizard';
      return '';
    }
    if (args[0] === 'login') {
      privateAuth = options.env.DOCKER_CONFIG;
      assert(path.relative(path.join(root, 'test-results'), privateAuth).startsWith('..'));
      assert(options.input === env.CI_REGISTRY_PASSWORD || options.input === env.DOCKERHUB_TOKEN);
      fs.writeFileSync(path.join(privateAuth, 'config.json'), 'private fixture auth');
    }
    if (args[0] === 'push') {
      if (pushFails) throw Error('fixture-push-failure');
      const isWizard = args[1].startsWith(env.DOCKERHUB_WIZARD_REPOSITORY + ':');
      const value = {digest: (isWizard ? activeRelease.wizardRegistryReference : activeRelease.registryReference).split('@')[1],
        imageId: isWizard ? activeRelease.wizardImageId : activeRelease.imageId};
      published.set(args[1], value);
      published.set(args[1].split(':')[0] + ':' + value.digest, value);
    }
    if (args[0] === 'image' && args[1] === 'inspect') {
      const isWizard = args[2].includes('wizard');
      return JSON.stringify([{Id: isWizard ? (wrongWizard ? id('f') : activeRelease.wizardImageId) : activeRelease.imageId,
        Os: 'linux', Architecture: wrongPlatform ? 'arm64' : 'amd64', Config: {Labels: {
          'org.system-bootstrapper.test-job': String(activeRelease.candidateJobId), 'org.opencontainers.image.revision': isWizard ? wizard : sha,
          'org.system-bootstrapper.source-revision': sha}}}]);
    }
    return '';
  };
  try {
    wrongWizard = true;
    await assert.rejects(publish(env, root, execute, inspectManifest), /identity/);
    assert(!calls.some(call => call.includes('docker.io')), 'Hub login waits until both runtime identities pass');
    assert(!fs.existsSync(privateAuth));
    wrongWizard = false; wrongPlatform = true;
    await assert.rejects(publish(env, root, execute, inspectManifest), /platform/);
    wrongPlatform = false;
    calls.length = 0;
    const receipt = await publish(env, root, execute, inspectManifest);
    assert.equal(receipt.controller.reference, env.DOCKERHUB_REPOSITORY + '@' + id('7'));
    assert.equal(receipt.wizard.reference, env.DOCKERHUB_WIZARD_REPOSITORY + '@' + id('8'));
    assert.equal(receipt.wizard.sourceRevision, wizard);
    assert.deepEqual(receipt.tags, ['sha-' + sha + '-job-20']);
    assert(!fs.existsSync(privateAuth), 'private authentication is removed after success');
    assert(!calls.some(call => call.includes('build')), 'neither accepted image is rebuilt');
    assert(!calls.flat().includes(env.DOCKERHUB_TOKEN), 'token never occurs in process arguments');
    const bytes = fs.readFileSync(path.join(root, 'test-results/dockerhub/release.json'));
    assert.equal(fs.readFileSync(path.join(root, 'test-results/dockerhub/release.json.sha256'), 'utf8'), hash(bytes) + '  release.json\n');
    calls.length = 0;
    await publish(env, root, execute, inspectManifest);
    assert(!calls.some(call => call[1] === 'push'), 'identical immutable aliases are reused');
    // A later tag pipeline rebuilds the same source with another job label.
    // Distinct tested attempts necessarily have different image IDs/digests.
    const tagProof = {...proof, images: {...proof.images, candidate: id('9'), wizard: id('a')}};
    activeRelease = {...released, pipelineId: 11, candidateJobId: 21,
      imageId: id('9'), wizardImageId: id('a'),
      registryReference: env.CI_REGISTRY_IMAGE + '/successor@' + id('b'),
      wizardRegistryReference: env.CI_REGISTRY_IMAGE + '/successor-wizard@' + id('c'),
      candidateEvidenceSha256: hash(JSON.stringify(tagProof))};
    fs.writeFileSync(path.join(artifacts, 'candidate-results.json'), JSON.stringify(tagProof));
    writeRelease(activeRelease);
    const tagReceipt = await publish({...env, CI_PIPELINE_ID: '11', CI_COMMIT_TAG: 'v1.2.3', CI_COMMIT_BRANCH: undefined}, root, execute, inspectManifest);
    assert(calls.some(call => call.join(' ') === 'git merge-base --is-ancestor HEAD FETCH_HEAD'));
    assert.deepEqual(tagReceipt.tags, ['sha-' + sha + '-job-21', 'v1.2.3']);
    assert.equal(published.get(env.DOCKERHUB_REPOSITORY + ':v1.2.3').digest, id('b'));
    assert.equal(published.get(env.DOCKERHUB_REPOSITORY + ':sha-' + sha + '-job-20').digest, id('7'),
      'the original default-branch attempt remains unchanged');
    activeRelease = released;
    writeRelease(released);
    fs.writeFileSync(path.join(artifacts, 'candidate-results.json'), JSON.stringify(proof));
    await assert.rejects(publish({...env, CI_COMMIT_TAG: 'v1.2.3', CI_COMMIT_BRANCH: undefined}, root, execute, inspectManifest),
      /existing Docker Hub/, 'a released version cannot be retargeted to another accepted attempt');
    published.set(env.DOCKERHUB_REPOSITORY + ':sha-' + sha + '-job-20', {digest: id('9'), imageId: id('9')});
    calls.length = 0;
    await assert.rejects(publish(env, root, execute, inspectManifest), /existing Docker Hub/);
    assert.equal(calls.filter(call => call[0] === 'docker').length, 0, 'conflicting tags fail before registry login');
    published.clear(); pushFails = true;
    await assert.rejects(publish(env, root, execute, inspectManifest), /push-failure/);
    assert(!fs.existsSync(privateAuth), 'private authentication is removed after failed pushes');
    pushFails = false; conflictOnRecheck = true;
    calls.length = 0;
    await assert.rejects(publish(env, root, execute, inspectManifest), /changed during/);
    assert(!calls.some(call => call[1] === 'push'), 'a changed tag is not deliberately replaced');
    assert(!fs.existsSync(privateAuth));
  } finally { fs.rmSync(root, {recursive: true, force: true}); }

  const raw = Buffer.from(JSON.stringify({schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json', config: {digest: id('1')}, layers: []}));
  const requests = [];
  const request = async (url, options) => {
    requests.push([url, options]);
    if (url.startsWith('https://auth.docker.io/')) return {ok: true, json: async () => ({token: 'anonymous'})};
    return {ok: true, status: 200, arrayBuffer: async () => raw,
      headers: {get: () => 'sha256:' + hash(raw)}};
  };
  assert.deepEqual(await manifest('fixture/system', 'sha-' + sha, request), {digest: 'sha256:' + hash(raw), imageId: id('1')});
  assert(requests[1][1].headers.Authorization === 'Bearer anonymous');
  assert(!requests.flat().includes(env.DOCKERHUB_TOKEN));
  assert.equal(await manifest('fixture/system', 'missing', async (url, options) =>
    url.startsWith('https://auth.docker.io/') ? request(url, options) : {status: 404}), null);
  await assert.rejects(manifest('fixture/private', 'tag', async (url, options) =>
    url.startsWith('https://auth.docker.io/') ? request(url, options) : {status: 401}), /anonymous/);
  await assert.rejects(manifest('fixture/system', 'tag', async (url, options) =>
    url.startsWith('https://auth.docker.io/') ? request(url, options) :
      {ok: true, status: 200, arrayBuffer: async () => raw, headers: {get: () => id('9')}}), /verified single-platform/);
  console.log('Docker Hub publication: protected source, exact accepted controller/Wizard, immutable tags, no rebuild, public digest verification and credential cleanup passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
