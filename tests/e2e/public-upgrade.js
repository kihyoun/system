'use strict';
// Extend the existing restored-data candidate; no second platform is allocated.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const graph = require('../../config/releases/upgrade-paths.json');
const {createPublicationRuntime} = require('../../dist/modules/release/publication-runtime');
const recovery = require('./recovery');
const {terminalContainerState} = require('../../dist/modules/gitlab-upgrade/policy');
const diagnostics = require('./public-upgrade-diagnostics.json');
const security = require('../../config/gitlab/security-release.json');
const {manifest} = createPublicationRuntime(security).images;
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');
const required = (value, code) => { if (!value) throw Error(code); };
const root = path.resolve(__dirname, '../..');

function sanitizeGitlabFailure(value) {
  if(!value||!['running','completed','unavailable'].includes(value.phase))return undefined;
  if(value.phase==='completed')return Number.isInteger(value.exitCode)&&value.exitCode>=0&&value.exitCode<=255?
    {phase:'completed',exitCode:value.exitCode}:undefined;
  return {phase:value.phase};
}

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
const fixtureRuntime = '/opt/system-public-upgrade';
function runtimeVolumes(fixture) {
  return [fixture + '/runtime:' + fixtureRuntime + ':ro',
    ...['/lib/ld-musl-x86_64.so.1', '/usr/lib/libstdc++.so.6', '/usr/lib/libgcc_s.so.1']
      .map(file => fixture + '/runtime' + file + ':' + file + ':ro'),
    fixture + '/runtime/lib/ld-musl-x86_64.so.1:/lib/libc.musl-x86_64.so.1:ro'];
}
async function replaceController(candidate, baseline, image, fixture) {
  const labels = Object.fromEntries(Object.entries(baseline.Config.Labels || {})
    .filter(([key]) => key.startsWith('com.docker.compose.') && key !== 'com.docker.compose.image'));
  // The restored controller was created manually. Compose discovers only
  // containers with a config-hash label; this fixture marker makes its native
  // configuration differ so Compose recreates the controller with real labels.
  labels['com.docker.compose.config-hash'] ||= hash(JSON.stringify({fixture: 'public-upgrade-controller', image}));
  Object.assign(labels, {'com.docker.compose.project': 'system', 'com.docker.compose.service': 'bootstrapper',
    'com.docker.compose.container-number': '1', 'com.docker.compose.oneoff': 'False'});
  const args = ['create', '--name', 'system_bootstrapper_1', '--restart', baseline.HostConfig.RestartPolicy.Name];
  for (const [key, value] of Object.entries(labels)) args.push('--label', key + '=' + value);
  for (const value of baseline.Config.Env) args.push('--env', value);
  for (const value of baseline.HostConfig.ExtraHosts || []) args.push('--add-host', value);
  for (const mount of baseline.Mounts) {
    required(['bind', 'volume'].includes(mount.Type), 'public-upgrade-unexpected-candidate-mount');
    args.push('--mount', 'type=' + mount.Type + ',src=' + (mount.Type === 'volume' ? mount.Name : mount.Source) + ',dst=' + mount.Destination + (mount.RW ? '' : ',readonly'));
  }
  if (fixture) args.push('--env', 'SYSTEM_PUBLIC_UPGRADE_FIXTURE=' + fixture,
    '--volume', fixture + ':' + fixture + ':ro',
    '--volume', fixture + '/source/tests/e2e/public-upgrade-docker.js:/usr/bin/docker:ro',
    '--volume', fixture + '/source/tests/e2e/public-upgrade-docker.js:/usr/bin/docker-compose:ro',
    ...runtimeVolumes(fixture).flatMap(value => ['--volume', value]));
  await candidate.inner(['stop', '--time', '30', 'system_bootstrapper_1']);
  await candidate.inner(['rm', 'system_bootstrapper_1']);
  await candidate.inner([...args, image]);
  await candidate.inner(['start', 'system_bootstrapper_1']);
}

function controllerFixture(baseline, fixture) {
  // Keep only the disposable platform's adapters. The native Compose file
  // must continue to select release images, storage and staged startup.
  const inherited = Object.fromEntries(baseline.Config.Env.map(value => [value.slice(0, value.indexOf('=')), value.slice(value.indexOf('=') + 1)]));
  const environment = Object.fromEntries(['GITLAB_OMNIBUS_CONFIG', 'GITLAB_RUNNER_HELPER_IMAGE',
    'SYSTEM_WIZARD_ENVIRONMENT_IMAGE'].filter(key => Object.hasOwn(inherited, key)).map(key => [key, inherited[key]]));
  environment.SYSTEM_PUBLIC_UPGRADE_FIXTURE = fixture;
  const volumes = [fixture + ':' + fixture + ':ro',
    fixture + '/source/tests/e2e/public-upgrade-docker.js:/usr/bin/docker:ro',
    fixture + '/source/tests/e2e/public-upgrade-docker.js:/usr/bin/docker-compose:ro', ...runtimeVolumes(fixture)];
  return {services: {bootstrapper: {environment, volumes, network_mode: 'bridge',
    extra_hosts: baseline.HostConfig.ExtraHosts || []}}};
}

async function waitForServices(candidate, milliseconds = 600000, selectedImages = {}) {
  const names = ['system_bootstrapper_1', 'system_web_1', 'system_gitlab_1', 'system_wizard_1', 'runner_docker_1'];
  required(Object.entries(selectedImages).every(([name, image]) =>
    names.includes(name) && /^sha256:[a-f0-9]{64}$/.test(image)), 'public-upgrade-selected-images-differ');
  await candidate.wait(async () => {
    const rows = JSON.parse(await candidate.inner(['inspect', ...names]));
    for (const row of rows) {
      const terminal = terminalContainerState(row);
      if (terminal) throw Object.assign(Error('public-upgrade-service-' + terminal), {noRetry: true,
        ...(Number.isInteger(row.State.ExitCode) && row.State.ExitCode >= 0 && row.State.ExitCode <= 255 ? {exitCode: row.State.ExitCode} : {})});
    }
    return rows.length === names.length && new Set(rows.map(row => row.Name)).size === names.length &&
      rows.every(row => {
        const name = row.Name?.replace(/^\//, '');
        return names.includes(name) && row.State?.Running === true &&
          row.State.Status !== 'removing' &&
          (!Object.hasOwn(selectedImages, name) || row.Image === selectedImages[name]) &&
          !['Paused', 'Restarting', 'Dead'].some(key => row.State[key]) &&
          (!row.State.Health || row.State.Health.Status === 'healthy');
      });
  }, milliseconds);
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
    await this.candidate.inner(['run', '--rm', '-i', '--network', 'none', '--memory', '128m', '--cpus', '0.25',
      '--entrypoint', '/usr/local/bin/node', '--volume', this.live + ':' + this.live,
      this.candidate.spec.images.candidate.id, '/system/dist/modules/testing/public-upgrade-entry.js',
      'write', filename], {input});
  }

  async createCredential() {
    if (!this.token) this.token = await this.candidate.rails("require 'json';u=User.find_by_username('root');t=u.personal_access_tokens.create!(name:'disposable-public-upgrade',scopes:['api'],expires_at:Date.tomorrow);puts JSON.generate(token:t.token,root_id:u.id)");
  }

  async initialize(baseline, expected, beforeMigration = false) {
    const candidate = this.candidate, storage = require('./local-storage'), prepared = candidate.spec.publicUpgrade.source;
    required(beforeMigration ? !candidate.evidence.gitlabUpgrade?.migrationVerified : candidate.evidence.gitlabUpgrade?.registryVerified === true, 'existing-candidate-registry-ci-proof-required');
    required(prepared && recovery.hashFile(prepared.archive) === prepared.sha256, 'public-upgrade-source-archive-required');
    await candidate.call(['exec', candidate.daemon, 'mkdir', '-p', this.fixture + '/source', this.fixture + '/bin']);
    await candidate.call(['exec', '-i', candidate.daemon, 'tar', '-xzf', '-', '-C', this.fixture + '/source'], {inputFile: prepared.archive});
    await candidate.inner(['run', '--rm', '--network', 'none', '--memory', '256m', '--cpus', '0.25',
      '--entrypoint', '/usr/local/bin/node', '--volume', this.fixture + ':' + this.fixture,
      candidate.spec.images.candidate.id, '/system/dist/modules/testing/public-upgrade-entry.js',
      'prepare', this.fixture]);
    const previous = candidate.spec.publicUpgrade.metadata;
    // Prove the copied interpreter and bundled modules load in the candidate
    // helper and historical controller before changing the running controller.
    // Offline tests cannot prove this Alpine/glibc boundary; these probes belong to the real candidate gate.
    for (const image of [candidate.spec.images.candidate.id, previous.images.controller.imageId]) {
      const output = await candidate.inner(['run', '--rm', '--network', 'none', '--memory', '128m', '--cpus', '0.25',
        '--entrypoint', fixtureRuntime + '/node', ...runtimeVolumes(this.fixture).flatMap(value => ['--volume', value]),
        image, '-e', "require('/opt/system-public-upgrade/dist/modules/testing/public-upgrade-host-entry.js');process.stdout.write('runtime-ready')"]);
      required(output.trim() === 'runtime-ready', 'public-upgrade-runtime-unavailable');
    }

    await this.write(this.fixture + '/fixture.json', JSON.stringify({runId: candidate.id, live: this.live, previous, edge:candidate.spec.publicUpgrade.edge,
      spec: {sourceRevision: candidate.spec.sourceRevision, sourceTree: candidate.spec.sourceTree,
        sourceLayout:candidate.spec.sourceLayout,wizardSourceTree:candidate.spec.wizardSourceTree,
        wizardSourceRevision: candidate.spec.wizardSourceRevision, ciIdentity: candidate.spec.ciIdentity, images: candidate.spec.images},
      gitlabUpgrade: beforeMigration ? this.securityIdentity() : candidate.evidence.gitlabUpgrade,
      ...(beforeMigration ? {publicationMode:'future-release-before-prerequisite-v1'} : {}),guidedOrigin:candidate.guidedFixtureOrigin}));
    const mappings = [];
    for (const role of ['controller', 'wizard']) {
      mappings.push(previous.images[role].reference.replace(/^docker.io\//, '') + '\t' + previous.images[role].imageId + '\tprevious');
      mappings.push('system-upgrade-fixture/' + role + '@' + candidate.spec.images[role === 'controller' ? 'candidate' : 'wizard'].id +
        '\t' + candidate.spec.images[role === 'controller' ? 'candidate' : 'wizard'].id + '\ttarget');
    }
    for (const [reference,image] of Object.entries(require('./gitlab-upgrade').prepared(candidate).imageIds))
      mappings.push(reference.replace(/^docker.io\//,'')+'\t'+image+'\tsupport');
    await this.write(this.fixture + '/images.tsv', mappings.join('\n') + '\n');
    await this.write(this.fixture + '/compose.yml', JSON.stringify(controllerFixture(baseline, this.fixture)));
    await this.write(this.storage, "export PERSISTENCE_MODE='local'\nexport PERSISTENT_MOUNT='/'\nexport PERSISTENT_DIR='" + this.live +
      "'\nexport PERSISTENT_UUID=''\nexport SEED_DIR='" + storage.SEED + "'\nexport SEED_MOUNT='" + storage.MOUNT + "'\nexport SEED_UUID=''\n");
    await candidate.call(['exec', candidate.daemon, 'cp', '/run/system-bootstrapper/guided-preview-ca.pem', this.fixture + '/ca.pem']);
    await this.createCredential();
    // Refresh this head again after registry CI when entering the paired phase.
    const branch = await candidate.api('/projects/' + expected.projectId + '/repository/branches/' + encodeURIComponent(expected.branch), this.token.token);
    required(/^[a-f0-9]{40}$/.test(branch.commit?.id || ''), 'public-upgrade-existing-head-required');
    this.baselineHead = branch.commit.id;
    await this.write(this.fixture + '/token', this.token.token);
    await this.invoke(['initialize']);
    if (beforeMigration) {
      await this.invoke(['gitlab-previous-selectors']);
      await this.invoke(['freeze-publication']);
    }
    await replaceController(candidate, baseline, previous.images.controller.imageId, this.fixture);
    // The previous controller reconciles its services asynchronously. Healthy
    // containers from the restored candidate are not the selected public pair.
    await waitForServices(candidate, 600000, {
      system_bootstrapper_1: previous.images.controller.imageId,
      system_wizard_1: previous.images.wizard.imageId
    });
  }

  async invoke(args) {
    const candidate = this.candidate, storage = require('./local-storage');
    const command = ['run', '--rm', '-i', '--pid', 'host', '--network', 'host', '--memory', '512m', '--cpus', '1',
      '--entrypoint', fixtureRuntime + '/node',
      '--env', 'SYSTEM_PUBLIC_UPGRADE_FIXTURE=' + this.fixture, '--env', 'SYSTEM_PUBLIC_UPGRADE_LIVE=' + this.live,
      '--env', 'PATH=' + this.fixture + '/bin:' + fixtureRuntime + ':/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      '--env', 'GIT_OPTIONAL_LOCKS=0',
      '--env', 'SSL_CERT_FILE=' + this.fixture + '/ca.pem', '--env', 'DOCKER_CONFIG=/tmp/public-upgrade-docker',
      '--volume', this.live + ':' + this.live,
      '--volume', this.fixture + '/source:' + this.fixture + '/source:ro',
      '--volume', '/var/lib/docker:/var/lib/docker:ro', '--volume', '/var/run/docker.sock:/var/run/docker.sock',
      ...runtimeVolumes(this.fixture).flatMap(value => ['--volume', value])];
    if (args[0] === '--operation' && ['plan', 'apply'].includes(args[1])) command.push('--mount',
      'type=bind,src=' + storage.MOUNT + ',dst=' + storage.MOUNT);
    for (const host of ['gitlab', 'registry', 'sync', 'wizard']) command.push('--add-host', host + '.candidate.test:127.0.0.1');
    const hooks=['initialize','restore-original','freeze-publication','gitlab-previous-selectors','save-migrated-public-selection','candidate-pair-selectors','restore-migrated-public-selection'];
    const requested = args[0] === 'gitlab' ? args[args.indexOf('--operation')+1] : args[0] === '--operation' ? args[1] : args[0];
    required(args[0]==='gitlab' ? ['prepare','plan','promote','status','abort','rollback'].includes(requested) : [...hooks,'plan','apply','status','recover'].includes(requested), 'public-upgrade-native-operation-invalid');
    const operation=args[0]==='gitlab' ? 'gitlab-'+requested : hooks.includes(requested) && requested!=='restore-original' ? 'initialize' : requested;
    const failureCodes = Object.fromEntries([...new Set([
      ...Object.values(diagnostics.errors), ...Object.values(diagnostics.dockerOperations),
      ...Object.values(diagnostics.exceptionTypes), ...Object.values(diagnostics.planSteps), diagnostics.fallback
    ])].map(code => [diagnostics.marker + code, 'public-upgrade-native-' + operation + '-' + code]));
    try {
      const raw = await candidate.inner([...command, candidate.spec.images.candidate.id,
        this.fixture + '/source/tests/e2e/public-upgrade-host.js', ...args], {timeout: 1200000, failureCodes});
      return JSON.parse(raw.split('\n').at(-1));
    } catch (error) {
      if (['canceled-or-overall-timeout', 'readiness-timeout', 'candidate-overall-timeout', 'candidate-cleanup-timeout'].includes(error.message)) throw error;
      if (Object.values(failureCodes).includes(error.message)) throw error;
      const failure = Error('public-upgrade-native-' + operation + '-failed');
      if (Number.isInteger(error.exitCode)) failure.exitCode = error.exitCode;
      if (['ETIMEDOUT', 'ENOBUFS', 'ENOENT', 'EACCES'].includes(error.systemCode)) failure.systemCode = error.systemCode;
      throw failure;
    }
  }

  cli(operation, confirmation) {
    const repository = this.candidate.spec.publicUpgrade.metadata.source.repository.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '');
    return this.invoke(['--operation', operation, '--checkout', this.fixture + '/source', '--persistence-env', this.storage, '--plan-dir', this.planDir,
      '--repository', repository, '--target', this.candidate.spec.publicUpgrade.edge.to,
      '--backup-file', require('./local-storage').MOUNT + '/public-upgrade-' + this.candidate.id + '.zip',
      ...(this.candidate.spec.publicUpgrade.edge.databaseMigration ? ['--gitlab-checkpoint', this.gitlabCheckpointDir || this.candidate.spec.restore.base + '/configuration/gitlab-upgrades/candidate-' + this.candidate.id] : []),
      '--token-file', this.fixture + '/token', '--timeout', '600', '--backup-timeout', '900',
      ...(confirmation ? ['--confirm-plan', confirmation] : [])]);
  }

  securityIdentity() {
    const ids=require('./gitlab-upgrade').prepared(this.candidate).imageIds;
    return {fromImage:security.fromImage,toImage:security.toImage,fromImageId:ids[security.fromImage],toImageId:ids[security.toImage],
      runnerImage:security.runner.toImage,runnerImageId:ids[security.runner.toImage],fromRunnerImageId:ids[security.runner.fromImage],
      helperImage:security.runner.helperImage,helperImageId:ids[security.runner.helperImage],fromHelperImageId:ids[security.runner.fromHelperImage],
      runnerVersion:security.runner.toVersion,jobCaBundleSha256:security.jobCaBundleSha256};
  }

  gitlab(operation, confirmation) {
    const repository=this.candidate.spec.publicUpgrade.metadata.source.repository.replace(/^https:\/\/github.com\//,'').replace(/\.git$/,'');
    return this.invoke(['gitlab','--operation',operation,'--checkout',this.fixture+'/source','--persistence-env',this.storage,
      '--directory',this.live+'/configuration/gitlab-prerequisites/candidate-'+this.candidate.id,
      '--repository',repository,'--target',this.candidate.spec.publicUpgrade.edge.to,'--timeout','900',
      ...(confirmation?[operation==='rollback'?'--confirm-checkpoint':'--confirm-plan',confirmation]:[]),
      ...(operation==='rollback'&&this.pairedCheckpoint?['--paired-checkpoint',this.pairedCheckpoint]:[])]);
  }

  async migrate() {
    const prepared=await this.gitlab('prepare');
    required(prepared.status==='prepared' && typeof prepared.checkpointDir==='string' && prepared.checkpointDir.startsWith(this.live+'/configuration/gitlab-upgrades/'),'public-upgrade-native-GitLab-prerequisite-missing');
    this.gitlabCheckpointDir=prepared.checkpointDir;
    const plan=await this.gitlab('plan');
    required(/^[a-f0-9]{64}$/.test(plan.planSha256||''),'public-upgrade-native-plan-invalid');
    let result;
    try {result=await this.gitlab('promote',plan.planSha256);}
    catch(error) {
      this.candidate.evidence ||= {};
      this.candidate.evidence.gitlabUpgradeFailure=await this.captureGitlabFailure();
      throw error;
    }
    required(result.status==='promoted' && result.toImage===security.toImage && /^[a-f0-9]{64}$/.test(result.checkpointSha256||''),'upgrade-checkpoint-proof-invalid');
    await this.invoke(['save-migrated-public-selection']);
    await this.invoke(['candidate-pair-selectors']);
    await replaceController(this.candidate,this.originalBaseline,this.originalBaseline.Image,this.fixture);
    await waitForServices(this.candidate,600000,{
      system_bootstrapper_1:this.originalBaseline.Image,
      system_wizard_1:this.candidate.spec.images.wizard.id
    });
    return result;
  }

  async captureGitlabFailure() {
    try {
      // Read the existing owned journal before normal cleanup, without another
      // database/readiness probe or any process/lease mutation.
      const script="process.stdout.write(JSON.stringify(require('/opt/system-public-upgrade/dist/modules/gitlab-upgrade/status').upgradeChildOutcome('/state')));";
      const output=await this.candidate.inner(['exec','system_bootstrapper_1','node','-e',script],{timeout:5000});
      return sanitizeGitlabFailure(JSON.parse(output)) || {phase:'unavailable'};
    } catch {return {phase:'unavailable'};}
  }

  async selectMigratedPublic(expected) {
    required(this.preparedMigration && this.gitlabCheckpointDir,'public-upgrade-native-GitLab-prerequisite-missing');
    const branch=await this.candidate.api('/projects/'+expected.projectId+'/repository/branches/'+encodeURIComponent(expected.branch),this.token.token);
    required(/^[a-f0-9]{40}$/.test(branch.commit?.id||''),'public-upgrade-existing-head-required');this.baselineHead=branch.commit.id;
    await this.invoke(['restore-migrated-public-selection']);
    await replaceController(this.candidate,this.originalBaseline,this.candidate.spec.publicUpgrade.metadata.images.controller.imageId,this.fixture);
    await waitForServices(this.candidate,600000,{
      system_bootstrapper_1:this.candidate.spec.publicUpgrade.metadata.images.controller.imageId,
      system_wizard_1:this.candidate.spec.publicUpgrade.metadata.images.wizard.imageId
    });
  }

  rollback(checkpoint) {return this.gitlab('rollback',checkpoint);}

  async restoreAfterRollback() {
    await this.restoreOriginal(this.originalFiles);
    await this.finish(this.originalFiles,this.originalBaseline);
    await this.candidate.wait(async()=>{const value=await recovery.syncFetch(this.candidate);return !!value.main?.data;},600000);
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
    await waitForServices(this.candidate,600000,{
      system_bootstrapper_1:baseline.Image,
      system_wizard_1:this.candidate.spec.images.wizard.id
    });
  }

  async revokeCredential() {
    try {await this.candidate.api('/personal_access_tokens/self', this.token.token, 'DELETE');}
    catch {await this.candidate.rails("User.find_by_username('root').personal_access_tokens.where(name:'disposable-public-upgrade',revoked:false).find_each(&:revoke!);puts '{}'");}
  }
}
async function run(candidate, expected, dependencies = {}) {
  const fixture = candidate.spec.publicUpgrade;
  required(fixture && fixture.edge.to === fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim() &&
    fixture.metadata.version === fixture.edge.from, 'prepared-public-upgrade-required');
  const read = dependencies.configuration || configuration;
  let currentExpected = expected;
  let verificationAuth;
  const verify = dependencies.verify || (async () => {
    await waitForServices(candidate);
    await candidate.wait(async () => { const value = await recovery.syncFetch(candidate); return !!value.main?.data; }, 600000);
    // This includes the exact existing registry tag/digest. Reuse the native
    // registry job immediately before this stage; do not create more commits
    // or jobs while checking a frozen data sample.
    await recovery.verifyServiceIdentity(candidate, currentExpected, verificationAuth);
    await candidate.inner(['exec', 'runner_docker_1', 'gitlab-runner', 'verify']);
  });
  await candidate.stage(fixture.edge.requiredStage, async () => {
    const files = await read(candidate), before = preserved(files);
    const native = dependencies.native || candidate.publicUpgradeNative || new NativeCLI(candidate), storage = dependencies.storage || require('./local-storage');
    await native.createCredential();
    verificationAuth = native.token;
    const sample = dependencies.dataSample || (() => require('./public-upgrade-data').sample(candidate, verificationAuth));
    const dataBefore = await sample();
    const baseline = dependencies.baseline || JSON.parse(await candidate.inner(['inspect', 'system_bootstrapper_1']))[0];
    const oldController = fixture.metadata.images.controller.imageId, oldWizard = fixture.metadata.images.wizard.imageId;
    const targetController = candidate.spec.images.candidate.id, targetWizard = candidate.spec.images.wizard.id;
    await storage.attach(candidate);
    if(native.preparedMigration) await native.selectMigratedPublic(expected);
    else await native.initialize(baseline, expected);
    verificationAuth = native.token;
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
    if (fixture.edge.databaseMigration) required(plan.gitlabPrerequisite?.fromVersion === '19.5.3' && plan.gitlabPrerequisite?.toVersion === '19.6.1' && /^[a-f0-9]{64}$/.test(plan.gitlabPrerequisite?.checkpointSha256 || ''), 'public-upgrade-native-GitLab-prerequisite-missing');
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
    if(native.preparedMigration) {
      native.pairedCheckpoint=native.live+'/recovery/controller-updates/'+path.basename(native.planDir);
    } else {
    await native.restoreOriginal(files);
    // The final normal controller starts after physical backup detachment,
    // preserving the existing no-backup startup/Fetch acceptance boundary.
    try {
      await native.finish(files, baseline);
      await verify();
      required(JSON.stringify(await read(candidate)) === JSON.stringify(files), 'public-upgrade-original-configuration-not-restored');
    } finally {await native.revokeCredential();}
    }
    candidate.evidence.publicUpgrade = {fromVersion: fixture.edge.from, toVersion: fixture.edge.to,
      fromSourceRevision: fixture.metadata.source.revision, fromControllerImageId: oldController, fromWizardImageId: oldWizard,
      configurationPreserved: true, dataPreserved: true, runnerRegistryVerified: true, rollbackVerified: true,
      ...(fixture.edge.databaseMigration ? {gitlabPrerequisiteVerified:true,gitlabCheckpointSha256:plan.gitlabPrerequisite.checkpointSha256,gitlabFromVersion:plan.gitlabPrerequisite.fromVersion,gitlabToVersion:plan.gitlabPrerequisite.toVersion} : {})};
  });
}
async function prepareGitlabMigration(candidate,expected) {
  const native=new NativeCLI(candidate);
  native.originalFiles=await configuration(candidate);
  native.originalBaseline=JSON.parse(await candidate.inner(['inspect','system_bootstrapper_1']))[0];
  await native.initialize(native.originalBaseline,expected,true);
  native.preparedMigration=true;
  candidate.publicUpgradeNative=native;
  return native;
}
module.exports = {sanitizeGitlabFailure, prepareGitlabMigration, download, prepare, archiveConfigDigest, prepareSource, configuration, preserved, replaceController, controllerFixture, waitForServices, NativeCLI, run};
