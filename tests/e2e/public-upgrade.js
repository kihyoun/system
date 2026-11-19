'use strict';
// Extend the existing restored-data candidate; no second platform is allocated.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const graph = require('../../bootstrapper/upgrade-paths.json');
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
async function prepare(output, env = process.env, execute = execFileSync, request = fetch) {
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
    execute('docker', ['pull', row.reference], {stdio: 'inherit', timeout: 600000});
    const image = JSON.parse(execute('docker', ['image', 'inspect', row.reference], {encoding: 'utf8'}))[0];
    required(image.Id === row.imageId && image.Id === row.configDigest &&
      (image.RepoDigests || []).map(value => value.replace(/^docker.io\//, '')).includes(row.reference.replace(/^docker.io\//, '')) &&
      image.Config?.Labels?.['org.opencontainers.image.revision'] === metadata.source[role === 'controller' ? 'revision' : 'wizardRevision'] &&
      image.Config?.Labels?.['org.system-bootstrapper.test-job'] === String(metadata.acceptance.candidateJobId), 'previous-public-image-identity-mismatch');
    const archive = path.join(output, 'previous-public-' + role + '.tar');
    execute('docker', ['image', 'save', '--output', archive, row.reference], {stdio: 'inherit', timeout: 600000});
    images[role === 'controller' ? 'previousController' : 'previousWizard'] = {id: image.Id, archive};
  }
  return {metadata, edge, images};
}
async function configuration(candidate) {
  return JSON.parse(await candidate.inner(['exec', 'system_bootstrapper_1', 'node', '-e',
    "const fs=require('fs'),c=require('crypto');const files=['.docker.env',...fs.readdirSync('/state/.projects.env').filter(n=>/^\\.[A-Za-z0-9_.-]+\\.env$/.test(n)).sort().map(n=>'.projects.env/'+n)];process.stdout.write(JSON.stringify(Object.fromEntries(files.map(n=>[n,fs.readFileSync('/state/'+n,'utf8')]))));"]));
}
function preserved(files) {
  return hash(JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, raw]) => [name,
    name === '.docker.env' ? raw.replace(/^(?:export )?(?:BOOTSTRAPPER_IMAGE|WIZARD_IMAGE)=.*(?:\n|$)/gm, '') : raw]))));
}
async function writeConfiguration(candidate, files, controller, wizard) {
  const raw = recovery.updateConfiguration(files['.docker.env'], {BOOTSTRAPPER_IMAGE: controller, WIZARD_IMAGE: wizard});
  await candidate.call(['exec', '-i', candidate.daemon, 'sh', '-ec', 'cat > ' + candidate.spec.restore.base + '/configuration/.docker.env'], {input: raw});
}
async function replaceController(candidate, baseline, image) {
  const args = ['create', '--name', 'system_bootstrapper_1', '--restart', baseline.HostConfig.RestartPolicy.Name,
    '--label', 'com.docker.compose.project=system', '--label', 'com.docker.compose.service=bootstrapper'];
  for (const value of baseline.Config.Env) args.push('--env', value);
  for (const value of baseline.HostConfig.ExtraHosts || []) args.push('--add-host', value);
  for (const mount of baseline.Mounts) {
    required(['bind', 'volume'].includes(mount.Type), 'public-upgrade-unexpected-candidate-mount');
    args.push('--mount', 'type=' + mount.Type + ',src=' + (mount.Type === 'volume' ? mount.Name : mount.Source) + ',dst=' + mount.Destination + (mount.RW ? '' : ',readonly'));
  }
  await candidate.inner(['stop', '--time', '30', 'system_bootstrapper_1']);
  await candidate.inner(['rm', 'system_bootstrapper_1']);
  await candidate.inner([...args, image]);
  await candidate.inner(['start', 'system_bootstrapper_1']);
}
async function run(candidate, expected, dependencies = {}) {
  const fixture = candidate.spec.publicUpgrade;
  required(fixture && fixture.edge.to === fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim() &&
    fixture.metadata.version === fixture.edge.from, 'prepared-public-upgrade-required');
  const read = dependencies.configuration || configuration;
  const write = dependencies.writeConfiguration || writeConfiguration;
  const replace = dependencies.replaceController || replaceController;
  const verify = dependencies.verify || (async () => {
    await candidate.wait(async () => { const value = await recovery.syncFetch(candidate); return !!value.main?.data; }, 600000);
    await recovery.verifyServiceIdentity(candidate, expected);
    await recovery.verifyRegistryBlob(candidate, {expected});
    await candidate.inner(['exec', 'runner_docker_1', 'gitlab-runner', 'verify']);
  });
  await candidate.stage(fixture.edge.requiredStage, async () => {
    const files = await read(candidate), before = preserved(files);
    const sample = dependencies.dataSample || (() => candidate.rails(fs.readFileSync(path.join(root, 'gitlab/verify-upgrade-data.rb'), 'utf8')));
    const dataBefore = await sample();
    const baseline = dependencies.baseline || JSON.parse(await candidate.inner(['inspect', 'system_bootstrapper_1']))[0];
    const oldController = fixture.metadata.images.controller.imageId, oldWizard = fixture.metadata.images.wizard.imageId;
    const targetController = candidate.spec.images.candidate.id, targetWizard = candidate.spec.images.wizard.id;
    // The outer preparation verified the old official digests/labels. Offline
    // Docker archives lose RepoDigests, so this owned fixture selects exact IDs.
    // Consumer preflight keeps all real registry, provenance and source checks.
    for (const [controller, wizard] of [[oldController, oldWizard], [targetController, targetWizard],
      [oldController, oldWizard], [targetController, targetWizard]]) {
      await write(candidate, files, controller, wizard);
      await replace(candidate, baseline, controller);
      await verify();
      required(JSON.stringify(await sample()) === JSON.stringify(dataBefore), 'public-upgrade-data-sample-changed');
      required(preserved(await read(candidate)) === before, 'public-upgrade-configuration-changed');
      const actual = dependencies.imageIds ? await dependencies.imageIds() : JSON.parse(await candidate.inner(['inspect', 'system_bootstrapper_1', 'system_wizard_1'])).map(row => row.Image);
      required(actual[0] === controller && actual[1] === wizard, 'public-upgrade-selected-images-differ');
    }
    // Restore the pre-existing private Wizard pin and exact original fixture
    // configuration before the cold database rollback continues.
    await candidate.call(['exec', '-i', candidate.daemon, 'sh', '-ec', 'cat > ' + candidate.spec.restore.base + '/configuration/.docker.env'], {input: files['.docker.env']});
    await replace(candidate, baseline, baseline.Image);
    await verify();
    required(JSON.stringify(await read(candidate)) === JSON.stringify(files), 'public-upgrade-original-configuration-not-restored');
    candidate.evidence.publicUpgrade = {fromVersion: fixture.edge.from, toVersion: fixture.edge.to,
      fromSourceRevision: fixture.metadata.source.revision, fromControllerImageId: oldController, fromWizardImageId: oldWizard,
      configurationPreserved: true, dataPreserved: true, runnerRegistryVerified: true, rollbackVerified: true};
  });
}
module.exports = {download, prepare, configuration, preserved, writeConfiguration, replaceController, run};
