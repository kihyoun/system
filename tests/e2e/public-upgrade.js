'use strict';
// Extend the existing restored-data candidate; no second platform is allocated.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const graph = require('../../bootstrapper/upgrade-paths.json');
const {manifest} = require('../../gitlab/publish-dockerhub');
const recovery = require('./recovery');
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');
const required = (value, code) => { if (!value) throw Error(code); };
const root = path.resolve(__dirname, '../..');

async function download(repository, version, request = fetch) {
  required(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository) &&
    repository.split('/').every(part => !['.', '..'].includes(part)), 'public-upgrade-repository-invalid');
  let url = 'https://github.com/' + repository + '/releases/download/v' + version + '/system-release-v' + version + '.json';
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await request(url, {redirect: 'manual', signal: AbortSignal.timeout(30000)});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = new URL(response.headers.get('location'), url);
      required(next.protocol === 'https:' && !next.username && !next.password && !next.port &&
        ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname), 'public-upgrade-download-redirect');
      url = next.href; continue;
    }
    required(response.ok, 'previous-public-release-unavailable');
    const bytes = Buffer.from(await response.arrayBuffer());
    required(bytes.length <= 1024 ** 2, 'previous-public-metadata-too-large');
    const metadata = JSON.parse(bytes);
    required(metadata.format === 'system-accepted-release-v1' && metadata.version === version && metadata.tag === 'v' + version &&
      metadata.platform === 'linux/amd64' && metadata.source.repository === 'https://github.com/' + repository + '.git' &&
      ['revision', 'tree', 'wizardRevision'].every(key => /^[a-f0-9]{40}$/.test(metadata.source[key] || '')) &&
      metadata.acceptance?.requiredChecksPassed === true && metadata.acceptance?.controllerWizardSameAttempt === true &&
      Number.isSafeInteger(metadata.acceptance.candidateJobId) && metadata.acceptance.candidateJobId > 0,
    'previous-public-release-identity-invalid');
    return metadata;
  }
  throw Error('public-upgrade-download-redirect-limit');
}
async function prepare(output, env = process.env, execute = execFileSync, request = fetch, inspectManifest = manifest) {
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  const incoming = graph.transitions.filter(row => row.to === version);
  required(incoming.length === 1, 'one-explicit-previous-public-upgrade-fixture-required');
  const edge = incoming[0];
  const metadata = await download(env.SYSTEM_TEST_PUBLIC_RELEASE_REPOSITORY || 'kihyoun/system', edge.from, request);
  const images = {};
  for (const role of ['controller', 'wizard']) {
    const row = metadata.images[role];
    required(/^(?:docker\.io\/)?[a-z0-9_-]+\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(row.reference || '') &&
      /^sha256:[a-f0-9]{64}$/.test(row.imageId || '') && /^sha256:[a-f0-9]{64}$/.test(row.configDigest || ''), 'previous-public-image-reference-invalid');
    const [repository, digest] = row.reference.replace(/^docker.io\//, '').split('@');
    let published;
    try { published = await inspectManifest(repository, digest, request); }
    catch { throw Error('previous-public-manifest-verification-failed'); }
    required(published?.digest === digest && published.configDigest === row.configDigest,
      'previous-public-manifest-identity-mismatch');
    execute('docker', ['pull', row.reference], {stdio: 'inherit', timeout: 600000});
    const image = JSON.parse(execute('docker', ['image', 'inspect', row.reference], {encoding: 'utf8'}))[0];
    // Docker's classic store reports the config ID; containerd may report the
    // manifest ID. The publisher records its accepted local ID independently.
    required(image.Id === row.imageId && image.Os === 'linux' && image.Architecture === 'amd64' &&
      (image.RepoDigests || []).map(value => value.replace(/^docker.io\//, '')).includes(row.reference.replace(/^docker.io\//, '')) &&
      image.Config?.Labels?.['org.opencontainers.image.revision'] === metadata.source[role === 'controller' ? 'revision' : 'wizardRevision'] &&
      image.Config?.Labels?.['org.system-bootstrapper.test-job'] === String(metadata.acceptance.candidateJobId) &&
      (role !== 'wizard' || image.Config?.Labels?.['org.system-bootstrapper.source-revision'] === metadata.source.revision),
    'previous-public-image-identity-mismatch');
    const archive = path.join(output, 'previous-public-' + role + '.tar');
    execute('docker', ['image', 'save', '--output', archive, row.reference], {stdio: 'inherit', timeout: 600000});
    images[role === 'controller' ? 'previousController' : 'previousWizard'] = {id: image.Id, archive};
  }
  return {metadata, edge, images};
}
function archiveConfigDigest(archive, execute = execFileSync) {
  // Reuse the saved candidate archive, since its future public manifest does
  // not exist yet. Docker save emits this compatibility manifest in both stores.
  try {
    const read = filename => execute('tar', ['-xOf', archive, filename],
      {timeout: 120000, maxBuffer: 8 * 1024 ** 2});
    const rows = JSON.parse(read('manifest.json'));
    required(Array.isArray(rows) && rows.length === 1 &&
      /^(?:[a-f0-9]{64}\.json|blobs\/sha256\/[a-f0-9]{64})$/.test(rows[0].Config || ''), 'invalid-config');
    const digest = 'sha256:' + hash(read(rows[0].Config));
    required(rows[0].Config.replace(/^blobs\/sha256\//, '').replace(/\.json$/, '') === digest.slice(7), 'invalid-config');
    return digest;
  } catch { throw Error('public-upgrade-candidate-archive-config-invalid'); }
}
async function configuration(candidate) {
  return JSON.parse(await candidate.inner(['exec', 'system_bootstrapper_1', 'node', '-e',
    "const fs=require('fs'),c=require('crypto');const files=['.docker.env',...fs.readdirSync('/state/.projects.env').filter(n=>/^\\.[A-Za-z0-9_.-]+\\.env$/.test(n)).sort().map(n=>'.projects.env/'+n)];process.stdout.write(JSON.stringify(Object.fromEntries(files.map(n=>[n,fs.readFileSync('/state/'+n,'utf8')]))));"]));
}
function preserved(files) {
  return hash(JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, raw]) => [name,
    name === '.docker.env' ? raw.replace(/^(?:export )?(?:BOOTSTRAPPER_IMAGE|WIZARD_IMAGE)=.*(?:\n|$)/gm, '') : raw]))));
}
function prepareSource(output, previous, env = process.env, execute = execFileSync) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'public-upgrade-source-'));
  const source = path.join(temporary, 'source'), archive = path.join(output, 'public-upgrade-source.tar.gz');
  const git = args => execute('git', args, {stdio: 'pipe', timeout: 120000,
    env: {...env, GIT_TERMINAL_PROMPT: '0'}, maxBuffer: 1024 * 1024});
  required(/^[a-f0-9]{40}$/.test(env.CI_COMMIT_SHA || ''), 'public-upgrade-exact-source-required');
  try {
    git(['init', source]);
    git(['-C', source, 'fetch', '--depth=1', root, env.CI_COMMIT_SHA]);
    git(['-C', source, 'checkout', '--detach', env.CI_COMMIT_SHA]);
    git(['-C', source, 'fetch', '--depth=1', previous.source.repository, previous.source.revision]);
    required(String(git(['-C', source, 'rev-parse', previous.source.revision + '^{tree}'])).trim() === previous.source.tree &&
      String(git(['-C', source, 'ls-tree', previous.source.revision, 'wizard'])).trim() ===
      '160000 commit ' + previous.source.wizardRevision + '\twizard', 'previous-public-source-identity-mismatch');
    execute('tar', ['-czf', archive, '-C', source, '.'], {timeout: 120000});
    return {archive, sha256: recovery.hashFile(archive)};
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
}
async function replaceController(candidate, baseline, image, fixture) {
  const args = ['create', '--name', 'system_bootstrapper_1', '--restart', baseline.HostConfig.RestartPolicy.Name,
    '--label', 'com.docker.compose.project=system', '--label', 'com.docker.compose.service=bootstrapper'];
  for (const value of baseline.Config.Env) args.push('--env', value);
  for (const value of baseline.HostConfig.ExtraHosts || []) args.push('--add-host', value);
  for (const mount of baseline.Mounts) {
    required(['bind', 'volume'].includes(mount.Type), 'public-upgrade-unexpected-candidate-mount');
    args.push('--mount', 'type=' + mount.Type + ',src=' + (mount.Type === 'volume' ? mount.Name : mount.Source) + ',dst=' + mount.Destination + (mount.RW ? '' : ',readonly'));
  }
  if (fixture) args.push('--env', 'SYSTEM_PUBLIC_UPGRADE_FIXTURE=' + fixture,
    '--volume', fixture + ':' + fixture + ':ro',
    '--volume', fixture + '/source/tests/e2e/public-upgrade-docker.sh:/usr/bin/docker:ro',
    '--volume', fixture + '/source/tests/e2e/public-upgrade-docker.sh:/usr/bin/docker-compose:ro');
  await candidate.inner(['stop', '--time', '30', 'system_bootstrapper_1']);
  await candidate.inner(['rm', 'system_bootstrapper_1']);
  await candidate.inner([...args, image]);
  await candidate.inner(['start', 'system_bootstrapper_1']);
}

class NativeCLI {
  constructor(candidate) {
    this.candidate = candidate;
    this.live = candidate.spec.restore.base;
    this.fixture = this.live + '/public-upgrade-fixture-' + candidate.id;
    this.planDir = this.live + '/recovery/public-upgrades/candidate-' + candidate.id;
    this.storage = this.live + '/public-upgrade-storage.env';
  }
  async write(filename, input) {
    await this.candidate.call(['exec', '-i', this.candidate.daemon, 'sh', '-ec',
      'umask 077; cat > "$1"', 'sh', filename], {input});
  }
  async initialize(baseline, expected) {
    const candidate = this.candidate, storage = require('./local-storage'), prepared = candidate.spec.publicUpgrade.source;
    required(candidate.evidence.gitlabUpgrade?.registryVerified === true, 'existing-candidate-registry-ci-proof-required');
    required(prepared && recovery.hashFile(prepared.archive) === prepared.sha256, 'public-upgrade-source-archive-required');
    await candidate.call(['exec', candidate.daemon, 'mkdir', '-p', this.fixture + '/source', this.fixture + '/bin']);
    await candidate.call(['exec', '-i', candidate.daemon, 'tar', '-xzf', '-', '-C', this.fixture + '/source'], {inputFile: prepared.archive});
    await candidate.inner(['run', '--rm', '--network', 'none', '--memory', '128m', '--cpus', '0.25', '--entrypoint', '/bin/sh',
      '--volume', this.fixture + ':' + this.fixture, candidate.spec.images.candidate.id, '-ec',
      'cp /usr/bin/docker "$1/docker.native"; cp -L /usr/bin/docker-compose "$1/docker-compose.native"; '+
      'cp /lib/ld-musl-x86_64.so.1 "$1/ld-musl-x86_64.so.1"; chmod 755 "$1"/*.native; '+
      'chmod 755 "$1/source/tests/e2e/public-upgrade-docker.sh" "$1/source/tests/e2e/public-upgrade-findmnt.sh"; '+
      'ln -s ../source/tests/e2e/public-upgrade-docker.sh "$1/bin/docker"; '+
      'ln -s ../source/tests/e2e/public-upgrade-docker.sh "$1/bin/docker-compose"; '+
      'ln -s ../source/tests/e2e/public-upgrade-findmnt.sh "$1/bin/findmnt"', 'sh', this.fixture]);
    const previous = candidate.spec.publicUpgrade.metadata;
    await this.write(this.fixture + '/fixture.json', JSON.stringify({runId: candidate.id, live: this.live, previous,
      spec: {sourceRevision: candidate.spec.sourceRevision, sourceTree: candidate.spec.sourceTree,
        wizardSourceRevision: candidate.spec.wizardSourceRevision, ciIdentity: candidate.spec.ciIdentity, images: candidate.spec.images},
      gitlabUpgrade: candidate.evidence.gitlabUpgrade}));
    const mappings = [];
    for (const role of ['controller', 'wizard']) {
      mappings.push(previous.images[role].reference.replace(/^docker.io\//, '') + '\t' + previous.images[role].imageId + '\tprevious');
      mappings.push('system-upgrade-fixture/' + role + '@' + candidate.spec.images[role === 'controller' ? 'candidate' : 'wizard'].id +
        '\t' + candidate.spec.images[role === 'controller' ? 'candidate' : 'wizard'].id + '\ttarget');
    }
    await this.write(this.fixture + '/images.tsv', mappings.join('\n') + '\n');
    const mounts = [this.fixture + ':' + this.fixture + ':ro',
      this.fixture + '/source/tests/e2e/public-upgrade-docker.sh:/usr/bin/docker:ro',
      this.fixture + '/source/tests/e2e/public-upgrade-docker.sh:/usr/bin/docker-compose:ro'];
    const environment = Object.fromEntries(baseline.Config.Env.map(value => [value.slice(0, value.indexOf('=')), value.slice(value.indexOf('=') + 1)]));
    environment.SYSTEM_PUBLIC_UPGRADE_FIXTURE = this.fixture;
    await this.write(this.fixture + '/compose.yml', JSON.stringify({services: {bootstrapper: {
      environment, volumes: mounts, network_mode: 'bridge', extra_hosts: baseline.HostConfig.ExtraHosts || []}}}));
    await this.write(this.storage, "export PERSISTENCE_MODE='local'\nexport PERSISTENT_MOUNT='/'\nexport PERSISTENT_DIR='" + this.live +
      "'\nexport PERSISTENT_UUID=''\nexport SEED_DIR='" + storage.SEED + "'\nexport SEED_MOUNT='" + storage.MOUNT + "'\nexport SEED_UUID=''\n");
    await candidate.call(['exec', candidate.daemon, 'cp', '/run/system-bootstrapper/guided-preview-ca.pem', this.fixture + '/ca.pem']);
    this.token = await candidate.rails("require 'json';u=User.find_by_username('root');t=u.personal_access_tokens.create!(name:'disposable-public-upgrade',scopes:['api'],expires_at:Date.tomorrow);puts JSON.generate(token:t.token)");
    // The preceding registry-CI stage deliberately committed its verification
    // job. Freeze that current head before this read-only upgrade data oracle.
    const branch = await candidate.api('/projects/' + expected.projectId + '/repository/branches/' + encodeURIComponent(expected.branch), this.token.token);
    required(/^[a-f0-9]{40}$/.test(branch.commit?.id || ''), 'public-upgrade-existing-head-required');
    this.baselineHead = branch.commit.id;
    await this.write(this.fixture + '/token', this.token.token);
    await this.invoke(['initialize']);
    await replaceController(candidate, baseline, previous.images.controller.imageId, this.fixture);
  }
  async invoke(args) {
    const candidate = this.candidate, storage = require('./local-storage');
    const command = ['run', '--rm', '-i', '--network', 'host', '--memory', '512m', '--cpus', '1',
      '--entrypoint', '/opt/gitlab/embedded/bin/python3',
      '--env', 'SYSTEM_PUBLIC_UPGRADE_FIXTURE=' + this.fixture, '--env', 'SYSTEM_PUBLIC_UPGRADE_LIVE=' + this.live,
      '--env', 'PATH=' + this.fixture + '/bin:/opt/gitlab/embedded/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      '--env', 'GIT_OPTIONAL_LOCKS=0',
      '--env', 'SSL_CERT_FILE=' + this.fixture + '/ca.pem', '--env', 'DOCKER_CONFIG=/tmp/public-upgrade-docker',
      '--volume', this.live + ':' + this.live,
      '--volume', this.fixture + '/source:' + this.fixture + '/source:ro',
      '--volume', '/var/lib/docker:/var/lib/docker:ro', '--volume', '/var/run/docker.sock:/var/run/docker.sock',
      '--volume', this.fixture + '/ld-musl-x86_64.so.1:/lib/ld-musl-x86_64.so.1:ro',
      '--volume', this.fixture + '/ld-musl-x86_64.so.1:/lib/libc.musl-x86_64.so.1:ro'];
    if (args[0] === '--operation' && ['plan', 'apply'].includes(args[1])) command.push('--mount',
      'type=bind,src=' + storage.MOUNT + ',dst=' + storage.MOUNT);
    for (const host of ['gitlab', 'registry', 'sync', 'wizard']) command.push('--add-host', host + '.candidate.test:127.0.0.1');
    const raw = await candidate.inner([...command, candidate.spec.images.gitlab.id,
      this.fixture + '/source/tests/e2e/public-upgrade-host.py', ...args], {timeout: 1200000});
    return JSON.parse(raw.split('\n').at(-1));
  }
  cli(operation, confirmation) {
    const repository = this.candidate.spec.publicUpgrade.metadata.source.repository.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '');
    return this.invoke(['--operation', operation, '--persistence-env', this.storage, '--plan-dir', this.planDir,
      '--repository', repository, '--target', this.candidate.spec.publicUpgrade.edge.to,
      '--backup-file', require('./local-storage').MOUNT + '/public-upgrade-' + this.candidate.id + '.zip',
      '--token-file', this.fixture + '/token', '--timeout', '600', '--backup-timeout', '900',
      ...(confirmation ? ['--confirm-plan', confirmation] : [])]);
  }
  async offline() {
    await this.write(this.fixture + '/offline-recovery', 'previous-public-transport-disabled\n');
    for (const role of ['controller', 'wizard']) {
      const id = this.candidate.spec.publicUpgrade.metadata.images[role].imageId;
      await this.candidate.inner(['image', 'rm', '--force', id]);
      let absent = false;
      try { await this.candidate.inner(['image', 'inspect', id]); } catch { absent = true; }
      required(absent, 'previous-public-image-not-absent-before-recovery');
    }
  }
  interruptRecovery() { return this.write(this.fixture + '/fail-recovery-once', 'one-shot\n'); }
  async restoreOriginal(files) {
    await this.write(this.live + '/configuration/.docker.env', files['.docker.env']);
    await this.invoke(['restore-original']);
  }
  async finish(_files, baseline) {
    await replaceController(this.candidate, baseline, baseline.Image);
    await this.candidate.rails("User.find_by_username('root').personal_access_tokens.where(name:'disposable-public-upgrade',revoked:false).find_each(&:revoke!);puts '{}'");
  }
}
async function run(candidate, expected, dependencies = {}) {
  const fixture = candidate.spec.publicUpgrade;
  required(fixture && fixture.edge.to === fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim() &&
    fixture.metadata.version === fixture.edge.from, 'prepared-public-upgrade-required');
  const read = dependencies.configuration || configuration;
  let currentExpected = expected;
  const verify = dependencies.verify || (async () => {
    await candidate.wait(async () => { const value = await recovery.syncFetch(candidate); return !!value.main?.data; }, 600000);
    // This includes the exact existing registry tag/digest. Reuse the native
    // registry job immediately before this stage; do not create more commits
    // or jobs while checking a frozen data sample.
    await recovery.verifyServiceIdentity(candidate, currentExpected);
    await candidate.inner(['exec', 'runner_docker_1', 'gitlab-runner', 'verify']);
  });
  await candidate.stage(fixture.edge.requiredStage, async () => {
    const files = await read(candidate), before = preserved(files);
    const sample = dependencies.dataSample || (() => candidate.rails(fs.readFileSync(path.join(root, 'gitlab/verify-upgrade-data.rb'), 'utf8')));
    const dataBefore = await sample();
    const baseline = dependencies.baseline || JSON.parse(await candidate.inner(['inspect', 'system_bootstrapper_1']))[0];
    const oldController = fixture.metadata.images.controller.imageId, oldWizard = fixture.metadata.images.wizard.imageId;
    const targetController = candidate.spec.images.candidate.id, targetWizard = candidate.spec.images.wizard.id;
    const native = dependencies.native || new NativeCLI(candidate), storage = dependencies.storage || require('./local-storage');
    await storage.attach(candidate);
    await native.initialize(baseline, expected);
    currentExpected = {...expected, head: native.baselineHead || expected.head};
    const check = async (controller, wizard) => {
      await verify();
      required(JSON.stringify(await sample()) === JSON.stringify(dataBefore), 'public-upgrade-data-sample-changed');
      required(preserved(await read(candidate)) === before, 'public-upgrade-configuration-changed');
      const actual = dependencies.imageIds ? await dependencies.imageIds() : JSON.parse(await candidate.inner(['inspect', 'system_bootstrapper_1', 'system_wizard_1'])).map(row => row.Image);
      required(actual[0] === controller && actual[1] === wizard, 'public-upgrade-selected-images-differ');
    };
    await check(oldController, oldWizard);
    const plan = await native.cli('plan');
    required(plan.installedVersion === fixture.edge.from && plan.targetVersion === fixture.edge.to &&
      /^[a-f0-9]{64}$/.test(plan.confirmPlanSha256 || ''), 'public-upgrade-native-plan-invalid');
    let refused = false;
    try { await native.cli('apply', '0'.repeat(64)); } catch { refused = true; }
    required(refused, 'public-upgrade-unconfirmed-plan-not-refused');
    const applied = await native.cli('apply', plan.confirmPlanSha256);
    required(applied.phase === 'completed' && applied.dataSampleVerified === true, 'public-upgrade-native-apply-incomplete');
    await check(targetController, targetWizard);
    required((await native.cli('status')).operation.phase === 'completed', 'public-upgrade-native-status-incomplete');
    await storage.detach(candidate);
    await native.offline();
    await native.interruptRecovery();
    let interrupted = false;
    try { await native.cli('recover', plan.confirmPlanSha256); } catch { interrupted = true; }
    required(interrupted && (await native.cli('status')).controller === 'rollback-started',
      'public-upgrade-interrupted-recovery-not-journaled');
    const restored = await native.cli('recover', plan.confirmPlanSha256);
    required(restored.operation.phase === 'rolled-back' && restored.operation.recoveryImageSelectors === true &&
      restored.controller === 'rolled-back', 'public-upgrade-native-recovery-incomplete');
    await check(oldController, oldWizard);
    const recovered = await read(candidate);
    required(['BOOTSTRAPPER_IMAGE', 'WIZARD_IMAGE'].every(key =>
      new RegExp('^export ' + key + "='system-bootstrapper-recovery:[a-f0-9]{64}'$", 'm').test(recovered['.docker.env'])),
    'public-upgrade-recovery-selectors-not-persistent');
    // A separate process restart must re-source the durable recovery aliases.
    await candidate.inner(['restart', 'system_bootstrapper_1']);
    await check(oldController, oldWizard);
    required((await native.cli('status')).operation.phase === 'rolled-back', 'public-upgrade-recovery-status-not-durable');
    await native.restoreOriginal(files);
    // The final normal controller starts after physical backup detachment,
    // preserving the existing no-backup startup/Fetch acceptance boundary.
    await native.finish(files, baseline);
    await verify();
    required(JSON.stringify(await read(candidate)) === JSON.stringify(files), 'public-upgrade-original-configuration-not-restored');
    candidate.evidence.publicUpgrade = {fromVersion: fixture.edge.from, toVersion: fixture.edge.to,
      fromSourceRevision: fixture.metadata.source.revision, fromControllerImageId: oldController, fromWizardImageId: oldWizard,
      configurationPreserved: true, dataPreserved: true, runnerRegistryVerified: true, rollbackVerified: true};
  });
}
module.exports = {download, prepare, archiveConfigDigest, prepareSource, configuration, preserved, replaceController, NativeCLI, run};
