'use strict';

// Copy accepted images. Publication must never rebuild either runtime.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const {validateEvidence} = require('./publish-successor');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const revision = value => /^[a-f0-9]{40}$/.test(value || '');
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value || '');
const number = value => Number.isSafeInteger(Number(value)) && /^[1-9][0-9]*$/.test(String(value));
const repository = value => /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value || '');
const version = value => /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(value || '');

function context(env) {
  const tag = env.CI_COMMIT_TAG || null;
  if (env.DOCKERHUB_PUBLISH_ENABLED !== 'true' || env.CI_PIPELINE_SOURCE !== 'push' ||
    env.CI_COMMIT_REF_PROTECTED !== 'true' || !revision(env.CI_COMMIT_SHA) ||
    !['CI_PROJECT_ID', 'CI_PIPELINE_ID', 'CI_JOB_ID'].every(key => number(env[key])) ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(env.CI_DEFAULT_BRANCH || '') ||
    (tag ? !version(tag) : env.CI_COMMIT_BRANCH !== env.CI_DEFAULT_BRANCH) ||
    !repository(env.DOCKERHUB_REPOSITORY) || !repository(env.DOCKERHUB_WIZARD_REPOSITORY) ||
    env.DOCKERHUB_REPOSITORY === env.DOCKERHUB_WIZARD_REPOSITORY ||
    !/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(env.CI_REGISTRY || '') ||
    !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(env.CI_PROJECT_PATH || '') ||
    env.CI_REGISTRY_IMAGE !== env.CI_REGISTRY + '/' + env.CI_PROJECT_PATH)
    throw Error('Docker Hub publication requires an enabled protected default-branch or version-tag push.');
  return {sourceRevision: env.CI_COMMIT_SHA, projectId: Number(env.CI_PROJECT_ID),
    pipelineId: Number(env.CI_PIPELINE_ID), publicationJobId: Number(env.CI_JOB_ID),
    versionTag: tag};
}

function readEvidence(root, ci, env) {
  const read = name => {
    const filename = path.join(root, 'test-results/successor', name);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 ** 2)
      throw Error('Regular bounded candidate artifacts are required.');
    return fs.readFileSync(filename);
  };
  const bytes = read('candidate-results.json'), released = JSON.parse(read('release.json'));
  const proof = JSON.parse(bytes);
  if (released.format !== 'system-successor-release-v1' ||
    released.sourceRevision !== ci.sourceRevision || released.projectId !== ci.projectId ||
    released.pipelineId !== ci.pipelineId || !number(released.candidateJobId) ||
    !revision(released.sourceTree) || !revision(released.wizardRevision) ||
    released.candidateEvidencePath !== 'test-results/successor/candidate-results.json' ||
    released.candidateEvidenceSha256 !== sha256(bytes) ||
    validateEvidence(proof, ci) !== released.imageId ||
    !imageId(released.wizardImageId) || proof.images.wizard !== released.wizardImageId ||
    released.registryReference !== env.CI_REGISTRY_IMAGE + '/successor@' + released.registryReference?.split('@')[1] ||
    released.wizardRegistryReference !== env.CI_REGISTRY_IMAGE + '/successor-wizard@' + released.wizardRegistryReference?.split('@')[1] ||
    !imageId(released.registryReference?.split('@')[1]) || !imageId(released.wizardRegistryReference?.split('@')[1]))
    throw Error('The exact same-pipeline passing controller and Wizard release is required.');
  return {released, proof};
}

function command(binary, args, options = {}) {
  const value = spawnSync(binary, args, {encoding: 'utf8', timeout: 600000,
    maxBuffer: 8 * 1024 ** 2, ...options});
  if (value.error || value.status !== 0) throw Error('Docker Hub publication operation failed: ' + binary);
  return (value.stdout || '').trim();
}

// A public release must be retrievable without the publisher's credentials.
// Only Docker Hub's fixed token and registry origins receive these requests.
async function manifest(repo, selector, request = fetch) {
  const tokenResponse = await request('https://auth.docker.io/token?service=registry.docker.io&scope=' +
    encodeURIComponent('repository:' + repo + ':pull'), {redirect: 'error', signal: AbortSignal.timeout(30000)});
  if (!tokenResponse.ok) throw Error('Anonymous Docker Hub access is required.');
  const {token} = await tokenResponse.json();
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw Error('Invalid Docker Hub pull token.');
  const result = await request('https://registry-1.docker.io/v2/' + repo + '/manifests/' + selector,
    {redirect: 'error', signal: AbortSignal.timeout(30000), headers: {Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'}});
  if (result.status === 404) return null;
  if (!result.ok) throw Error('The configured Docker Hub repositories must permit anonymous pulls.');
  const raw = Buffer.from(await result.arrayBuffer());
  if (raw.length > 1024 ** 2) throw Error('Docker Hub manifest is too large.');
  const digest = 'sha256:' + sha256(raw), document = JSON.parse(raw);
  if (document.schemaVersion !== 2 || !imageId(document.config?.digest) || !Array.isArray(document.layers) ||
    !['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].includes(document.mediaType) ||
    result.headers.get('docker-content-digest') !== digest)
    throw Error('A verified single-platform Docker Hub image manifest is required.');
  return {digest, configDigest: document.config.digest};
}

async function publish(env = process.env, root = process.cwd(), execute = command, inspectManifest = manifest) {
  const ci = context(env), {released} = readEvidence(root, ci, env);
  // Candidate job labels are part of each tested image's config identity.
  // Rebuilding the same source in a retry/tag pipeline is a distinct release
  // attempt, so its immutable discovery tag must include that candidate job.
  ci.tags = ['sha-' + ci.sourceRevision + '-job-' + released.candidateJobId,
    ...(ci.versionTag ? [ci.versionTag] : [])];
  const git = (...args) => execute('git', args, {cwd: root});
  if (git('rev-parse', 'HEAD') !== ci.sourceRevision || git('rev-parse', 'HEAD^{tree}') !== released.sourceTree ||
    git('ls-tree', 'HEAD', 'wizard') !== '160000 commit ' + released.wizardRevision + '\twizard')
    throw Error('Publication checkout must match the accepted source and Wizard gitlink.');
  if (env.CI_COMMIT_TAG) {
    git('fetch', '--no-tags', 'origin', env.CI_DEFAULT_BRANCH);
    git('merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD');
  }
  if (!env.CI_REGISTRY_USER || !env.CI_REGISTRY_PASSWORD || !env.DOCKERHUB_USER || !env.DOCKERHUB_TOKEN)
    throw Error('Scoped internal registry and protected Docker Hub credentials are required.');
  const roles = [
    {name: 'controller', repository: env.DOCKERHUB_REPOSITORY, source: released.registryReference,
      imageId: released.imageId, revision: ci.sourceRevision},
    {name: 'wizard', repository: env.DOCKERHUB_WIZARD_REPOSITORY, source: released.wizardRegistryReference,
      imageId: released.wizardImageId, revision: released.wizardRevision}
  ];
  // The accepted manifest digest binds the config and every layer. Docker's
  // local image ID is daemon-specific: classic stores report the config digest,
  // while containerd stores may report the manifest digest. Keep the local ID
  // checks below, but never equate that ID with an anonymous manifest's config.
  // Refuse a conflicting existing alias before publishing either component.
  for (const role of roles) {
    role.digest = role.source.split('@')[1];
    role.tags = ci.tags.map(tag => role.repository + ':' + tag);
    role.missing = [];
    for (const tag of ci.tags) {
      const current = await inspectManifest(role.repository, tag);
      if (current && current.digest !== role.digest)
        throw Error('Refusing to replace an existing Docker Hub commit or version tag.');
      if (!current) role.missing.push(tag);
    }
  }
  const auth = fs.mkdtempSync(path.join(os.tmpdir(), 'system-dockerhub-registry-'));
  fs.chmodSync(auth, 0o700);
  const dockerEnv = {...env, DOCKER_CONFIG: auth};
  const docker = (...args) => execute('docker', args, {env: dockerEnv});
  const inspect = reference => JSON.parse(docker('image', 'inspect', reference))[0];
  const aliases = [];
  try {
    execute('docker', ['login', '--username', env.CI_REGISTRY_USER, '--password-stdin', env.CI_REGISTRY],
      {env: dockerEnv, input: env.CI_REGISTRY_PASSWORD});
    // Verify both accepted runtimes before granting the temporary Docker Hub login.
    for (const role of roles) {
      docker('pull', role.source);
      const image = inspect(role.source), labels = image.Config?.Labels;
      if (image.Id !== role.imageId || image.Os !== 'linux' || image.Architecture !== 'amd64' ||
        labels?.['org.system-bootstrapper.test-job'] !== String(released.candidateJobId) ||
        labels?.['org.opencontainers.image.revision'] !== role.revision ||
        (role.name === 'wizard' && labels?.['org.system-bootstrapper.source-revision'] !== ci.sourceRevision))
        throw Error('The accepted runtime platform/source/job identity does not match.');
    }
    execute('docker', ['login', '--username', env.DOCKERHUB_USER, '--password-stdin', 'docker.io'],
      {env: dockerEnv, input: env.DOCKERHUB_TOKEN});
    for (const role of roles) {
      for (const tag of role.missing) {
        // The resource_group serializes this project's publishers. Recheck
        // outside changes too; registry-side immutable tags provide the final
        // guard against a different publisher racing this check and push.
        const current = await inspectManifest(role.repository, tag);
        if (current) {
          if (current.digest !== role.digest)
            throw Error('Docker Hub tag changed during publication.');
          continue;
        }
        const target = role.repository + ':' + tag;
        const existing = docker('image', 'ls', '--no-trunc', '--filter', 'reference=' + target, '--format', '{{.ID}}');
        if (existing) {
          if (inspect(target).Id !== role.imageId) throw Error('Refusing to replace an unrelated local image alias.');
        } else {
          docker('tag', role.source, target); aliases.push([target, role.imageId]);
        }
        docker('push', target);
      }
      for (const selector of [...ci.tags, role.digest]) {
        const current = await inspectManifest(role.repository, selector);
        if (!current || current.digest !== role.digest)
          throw Error('Anonymous Docker Hub acceptance did not preserve the tested image.');
        role.configDigest = current.configDigest;
      }
    }
    const receipt = {format: 'system-public-release-v1', ...ci, sourceTree: released.sourceTree,
      wizardRevision: released.wizardRevision, platform: 'linux/amd64',
      upstreamRelease: {projectId: ci.projectId, pipelineId: ci.pipelineId,
        candidateJobId: released.candidateJobId, registryReference: released.registryReference,
        candidateEvidenceSha256: released.candidateEvidenceSha256}};
    for (const role of roles) receipt[role.name] = {imageId: role.imageId, configDigest: role.configDigest, sourceRevision: role.revision,
      reference: role.repository + '@' + role.digest, tags: role.tags};
    const output = path.join(root, 'test-results/dockerhub');
    fs.mkdirSync(output, {recursive: true});
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'release.json'), bytes);
    fs.writeFileSync(path.join(output, 'release.json.sha256'), sha256(bytes) + '  release.json\n');
    return receipt;
  } finally {
    fs.rmSync(auth, {recursive: true, force: true});
    for (const [reference, expected] of aliases.reverse()) {
      if (inspect(reference).Id !== expected) throw Error('Cannot clean a changed public publication alias.');
      docker('image', 'rm', reference);
    }
  }
}

module.exports = {context, readEvidence, manifest, publish};
if (require.main === module) publish().then(value => {
  console.log('Published accepted controller: ' + value.controller.reference);
  console.log('Published accepted Wizard: ' + value.wizard.reference);
  console.log('Release receipt: test-results/dockerhub/release.json (with SHA-256 sidecar).');
}).catch(() => {
  console.error('Docker Hub publication refused; check protected source, complete candidate evidence, immutable tags and anonymous pulls.');
  process.exitCode = 1;
});
