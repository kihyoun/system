'use strict';

// Publish the image that passed the full candidate job, without rebuilding it.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const release = require('./security-release.json');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value || '');
const revision = value => /^[a-f0-9]{40}$/.test(value || '');

function context(env) {
  if (!revision(env.CI_COMMIT_SHA) || !['CI_PROJECT_ID', 'CI_PIPELINE_ID', 'CI_JOB_ID']
    .every(key => /^[1-9][0-9]*$/.test(env[key] || '')) ||
    !/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(env.CI_REGISTRY || '') ||
    !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(env.CI_PROJECT_PATH || '') ||
    env.CI_REGISTRY_IMAGE !== env.CI_REGISTRY + '/' + env.CI_PROJECT_PATH ||
    !['merge_request_event', 'push', 'web', 'schedule'].includes(env.CI_PIPELINE_SOURCE))
    throw Error('Successor publication requires a valid same-project CI identity.');
  return {sourceRevision: env.CI_COMMIT_SHA, projectId: Number(env.CI_PROJECT_ID),
    pipelineId: Number(env.CI_PIPELINE_ID), candidateJobId: Number(env.CI_JOB_ID),
    registryRepository: env.CI_REGISTRY_IMAGE + '/successor'};
}

function validateEvidence(proof, ci) {
  const upgrade = proof.evidence?.gitlabUpgrade;
  if (!/^[a-f0-9]{24}$/.test(proof.runId || '') || proof.sourceRevision !== ci.sourceRevision ||
    proof.fullAcceptance !== true || !Array.isArray(proof.results) || !proof.results.length ||
    proof.results.some(stage => stage.status !== 'passed') || !imageId(proof.images?.candidate) ||
    upgrade?.fromImage !== release.fromImage || upgrade?.toImage !== release.toImage ||
    !['migrationVerified', 'rollbackVerified', 'registryVerified', 'checkpointVerified'].every(k => upgrade[k] === true))
    throw Error('A complete passing successor migration receipt is required.');
  for (const name of ['gitlab-upgrade-migrated-data', 'gitlab-upgrade-registry-ci',
    'gitlab-upgrade-restored-checkpoint', 'cleanup']) {
    if (!proof.results.some(stage => stage.name === name && stage.status === 'passed'))
      throw Error('A required successor acceptance stage is missing.');
  }
  return proof.images.candidate;
}

function candidates(directory, ci) {
  return fs.readdirSync(directory).filter(name => /^[a-f0-9]{24}$/.test(name)).flatMap(name => {
    const dir = path.join(directory, name), filename = path.join(dir, 'results.json');
    if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink() ||
      !fs.lstatSync(filename).isFile() || fs.lstatSync(filename).isSymbolicLink())
      throw Error('Candidate evidence must be regular job-owned files.');
    const bytes = fs.readFileSync(filename), proof = JSON.parse(bytes);
    if (proof.fullAcceptance !== true || !proof.evidence?.gitlabUpgrade) return [];
    validateEvidence(proof, ci);
    if (proof.runId !== name) throw Error('Candidate evidence directory mismatch.');
    return [{proof, bytes}];
  });
}

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {encoding: 'utf8', timeout: 600000,
    maxBuffer: 4 * 1024 ** 2, ...options});
  if (result.error || result.status !== 0) throw Error('Successor publication operation failed: ' + binary);
  return (result.stdout || '').trim();
}

function publish(env = process.env, root = process.cwd(), execute = command) {
  const ci = context(env);
  const receipts = candidates(path.join(root, 'test-results/e2e'), ci);
  if (receipts.length !== 1) throw Error('Exactly one full successor acceptance receipt is required.');
  const {proof, bytes} = receipts[0];
  const expectedId = validateEvidence(proof, ci);
  const tag = ci.registryRepository + ':pipeline-' + ci.pipelineId + '-job-' + ci.candidateJobId;
  const local = 'system-platform-candidate:ci-' + ci.projectId + '-' + ci.candidateJobId;
  const inspect = reference => JSON.parse(execute('docker', ['image', 'inspect', reference]))[0];
  const image = inspect(local);
  if (image.Id !== expectedId || image.Config?.Labels?.['org.system-bootstrapper.test-job'] !== String(ci.candidateJobId) ||
    image.Config?.Labels?.['org.opencontainers.image.revision'] !== ci.sourceRevision)
    throw Error('The accepted image/source/job identity does not match.');
  if (!env.CI_REGISTRY_USER || !env.CI_REGISTRY_PASSWORD) throw Error('Scoped CI registry credentials are required.');
  const output = path.join(root, 'test-results/successor');
  fs.mkdirSync(output, {recursive: true, mode: 0o700});
  // This directory MUST stay outside every artifact path. Finally cannot run
  // after SIGKILL; even then a job must never upload its registry credentials.
  const auth = fs.mkdtempSync(path.join(os.tmpdir(), 'system-successor-registry-'));
  fs.chmodSync(auth, 0o700);
  const dockerEnv = {...env, DOCKER_CONFIG: auth};
  let tagged = false;
  try {
    execute('docker', ['login', '--username', env.CI_REGISTRY_USER, '--password-stdin', env.CI_REGISTRY],
      {env: dockerEnv, input: env.CI_REGISTRY_PASSWORD});
    execute('docker', ['tag', local, tag]); tagged = true;
    execute('docker', ['push', tag], {env: dockerEnv});
    const published = inspect(tag);
    if (published.Id !== expectedId) throw Error('Published image identity changed.');
    const refs = (published.RepoDigests || []).filter(ref => ref.startsWith(ci.registryRepository + '@') &&
      imageId(ref.split('@')[1]));
    if (refs.length !== 1) throw Error('An immutable published successor reference is required.');
    const tree = execute('git', ['rev-parse', 'HEAD^{tree}'], {cwd: root});
    const gitlink = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(execute('git', ['ls-tree', 'HEAD', 'wizard'], {cwd: root}));
    if (execute('git', ['rev-parse', 'HEAD'], {cwd: root}) !== ci.sourceRevision || !revision(tree) || !gitlink)
      throw Error('Publication checkout/source mismatch.');
    const receipt = {format: 'system-successor-release-v1', ...ci,
      sourceTree: tree, wizardRevision: gitlink[1], imageId: expectedId,
      registryReference: refs[0], candidateEvidenceSha256: digest(bytes),
      candidateEvidencePath: 'test-results/successor/candidate-results.json'};
    // E2E after_script cleanup rewrites its working receipts. Freeze exactly
    // the accepted bytes used here so the uploaded release hash stays valid.
    fs.writeFileSync(path.join(output, 'candidate-results.json'), bytes, {mode: 0o600});
    fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(receipt, null, 2) + '\n', {mode: 0o600});
    return receipt;
  } finally {
    fs.rmSync(auth, {recursive: true, force: true});
    if (tagged) {
      if (inspect(tag).Id !== expectedId) throw Error('Cannot clean a changed successor publication alias.');
      execute('docker', ['image', 'rm', tag]);
    }
  }
}

module.exports = {context, validateEvidence, candidates, publish};
if (require.main === module) {
  try { const value = publish(); console.log('Published the accepted successor image: ' + value.registryReference); }
  catch (_) { console.error('Successor publication refused; inspect candidate, source and image identity checks.'); process.exitCode = 1; }
}
