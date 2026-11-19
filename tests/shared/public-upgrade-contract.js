'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {download, prepare, prepareSource, run, preserved, NativeCLI} = require('../e2e/public-upgrade');
const edge = require('../../bootstrapper/upgrade-paths.json').transitions[0];
const id = char => 'sha256:' + char.repeat(64);
function fixture() {
  const metadata = {format: 'system-accepted-release-v1', version: edge.from, tag: 'v' + edge.from, platform: 'linux/amd64',
    source: {repository: 'https://github.com/example/system.git', revision: 'a'.repeat(40), tree: 'b'.repeat(40), wizardRevision: 'c'.repeat(40)},
    acceptance: {requiredChecksPassed: true, controllerWizardSameAttempt: true, candidateJobId: 31},
    images: {controller: {reference: 'example/system@' + id('1'), imageId: id('3'), configDigest: id('3')},
      wizard: {reference: 'example/wizard@' + id('2'), imageId: id('4'), configDigest: id('4')}}};
  return metadata;
}
test('previous public fixture is selected explicitly and redirects stay anonymous on approved TLS origins', async () => {
  const metadata = fixture();
  assert.deepEqual(await download('example/system', edge.from, async () => Response.json(metadata)), metadata);
  await assert.rejects(download('example/system', edge.from, async () => new Response(null, {status: 302, headers: {location: 'http://attacker.invalid/file'}})), /redirect/);
  await assert.rejects(download('example/system', edge.from, async () => new Response(null, {status: 404})), /unavailable/);
});
test('image preparation verifies official labels, source/job and exact digests before saving archives', async () => {
  const metadata = fixture(), calls = [];
  let bad = false;
  const execute = (_command, args) => {
    calls.push(args);
    if (args[0] === 'image' && args[1] === 'inspect') {
      const role = args.at(-1).includes('wizard') ? 'wizard' : 'controller';
      const row = metadata.images[role];
      return JSON.stringify([{Id: bad ? id('f') : row.imageId, RepoDigests: [row.reference],
        Config: {Labels: {'org.opencontainers.image.revision': metadata.source[role === 'controller' ? 'revision' : 'wizardRevision'],
          'org.system-bootstrapper.test-job': '31'}}}]);
    }
    return '';
  };
  const result = await prepare('/tmp/public-upgrade-fixture', {SYSTEM_TEST_PUBLIC_RELEASE_REPOSITORY: 'example/system'}, execute, async () => Response.json(metadata));
  assert.equal(result.images.previousController.id, metadata.images.controller.imageId);
  assert.equal(calls.filter(args => args[0] === 'image' && args[1] === 'save').length, 2);
  bad = true;
  await assert.rejects(prepare('/tmp/public-upgrade-fixture', {SYSTEM_TEST_PUBLIC_RELEASE_REPOSITORY: 'example/system'}, execute, async () => Response.json(metadata)), /identity-mismatch/);
});
test('source preparation keeps exact target and previous Git objects with a clean native checkout', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'public-upgrade-source-contract-'));
  try {
    const origin = path.join(directory, 'origin'), output = path.join(directory, 'output');
    fs.mkdirSync(origin); fs.mkdirSync(output);
    const git = args => execFileSync('git', ['-C', origin, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
    git(['init']);
    fs.writeFileSync(path.join(origin, 'VERSION'), edge.to + '\n');
    git(['add', 'VERSION']);
    git(['update-index', '--add', '--cacheinfo', '160000,' + 'c'.repeat(40) + ',wizard']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Prepared source']);
    const revision = git(['rev-parse', 'HEAD']);
    const previous = {source: {repository: origin, revision, tree: git(['rev-parse', 'HEAD^{tree}']), wizardRevision: 'c'.repeat(40)}};
    const execute = (command, args, options) => {
      const sourceRoot = path.resolve(__dirname, '../..');
      return execFileSync(command, args.map(value => value === sourceRoot ? origin : value), options);
    };
    const prepared = prepareSource(output, previous, {...process.env, CI_COMMIT_SHA: revision}, execute);
    assert.match(prepared.sha256, /^[a-f0-9]{64}$/);
    const restored = path.join(directory, 'restored'); fs.mkdirSync(restored);
    execFileSync('tar', ['-xzf', prepared.archive, '-C', restored]);
    assert.equal(execFileSync('git', ['-C', restored, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), revision);
    assert.equal(execFileSync('git', ['-C', restored, 'status', '--porcelain'], {encoding: 'utf8'}), '');
    assert.equal(fs.readFileSync(path.join(restored, 'VERSION'), 'utf8').trim(), edge.to);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
test('same candidate drives real CLI operations, interrupted offline recovery and restart before recording evidence', async () => {
  const metadata = fixture(), events = [];
  const files = {'.docker.env': "# fixture\nexport BOOTSTRAPPER_IMAGE='old'\nexport WIZARD_IMAGE='custom'\nKEEP='yes'\n", '.projects.env/.demo.env': 'project-source-preserved\n'};
  let selected = [id('5'), id('6')], working = {...files}, phase = 'planned', controller = 'not-started', interrupt = false;
  const candidate = {spec: {restore: {base: '/recovered-data/platform'}, publicUpgrade: {metadata, edge}, images: {candidate: {id: id('5')}, wizard: {id: id('6')}}},
    evidence: {}, stage: async (_name, action) => action(), call: async () => {}, inner: async () => ''};
  const native = {initialize: async () => { events.push('initialize'); selected = [id('3'), id('4')]; },
    cli: async (operation, confirmation) => {
      events.push(operation);
      if (operation === 'plan') return {installedVersion: edge.from, targetVersion: edge.to, confirmPlanSha256: 'a'.repeat(64)};
      if (operation === 'apply') {
        if (confirmation !== 'a'.repeat(64)) throw Error('confirmation-refused');
        phase = controller = 'completed'; selected = [id('5'), id('6')];
        return {phase, dataSampleVerified: true};
      }
      if (operation === 'recover') {
        if (interrupt) { interrupt = false; controller = 'rollback-started'; throw Error('one-shot-recovery-failure'); }
        phase = controller = 'rolled-back'; selected = [id('3'), id('4')];
        working = {...files, '.docker.env': files['.docker.env'].replace("'old'", "'system-bootstrapper-recovery:" + 'b'.repeat(64) + "'").replace("'custom'", "'system-bootstrapper-recovery:" + 'c'.repeat(64) + "'")};
      }
      return {operation: {phase, recoveryImageSelectors: phase === 'rolled-back'}, controller};
    }, offline: async () => events.push('old-images-removed'), interruptRecovery: async () => { interrupt = true; },
    restoreOriginal: async () => { events.push('restore-original'); working = {...files}; },
    finish: async () => { events.push('finish'); selected = [id('5'), id('6')]; }};
  const dependencies = {configuration: async () => working, native,
    storage: {attach: async () => events.push('backup-attached'), detach: async () => events.push('backup-detached')}, baseline: {Image: id('5')},
    verify: async () => {}, dataSample: async () => ({sha256: 'a'.repeat(64), sampledProjects: 1}), imageIds: async () => selected};
  await run(candidate, {}, dependencies);
  assert.deepEqual(events, ['backup-attached', 'initialize', 'plan', 'apply', 'apply', 'status', 'backup-detached', 'old-images-removed',
    'recover', 'status', 'recover', 'status', 'restore-original', 'finish']);
  assert.equal(candidate.evidence.publicUpgrade.rollbackVerified, true);
  assert.equal(candidate.evidence.publicUpgrade.fromSourceRevision, metadata.source.revision);
  delete candidate.evidence.publicUpgrade;
  dependencies.verify = async () => { throw Error('registry-or-data-failed'); };
  await assert.rejects(run(candidate, {}, dependencies), /registry-or-data-failed/);
  assert.equal(candidate.evidence.publicUpgrade, undefined);
  assert.equal(preserved(files), preserved({...files, '.docker.env': files['.docker.env'].replace("'old'", "'target'")}));
});

test('registry adapter preserves arguments and disables previous digest transport during real archive recovery', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'public-upgrade-transport-'));
  try {
    const script = path.resolve(__dirname, '../e2e/public-upgrade-docker.sh');
    const docker = path.join(directory, 'docker'), compose = path.join(directory, 'docker-compose');
    fs.symlinkSync(script, docker); fs.symlinkSync(script, compose);
    const reference = 'example/system@' + id('1'), image = id('3');
    fs.writeFileSync(path.join(directory, 'images.tsv'), reference + '\t' + image + '\tprevious\n');
    fs.writeFileSync(path.join(directory, 'docker.native'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$SYSTEM_PUBLIC_UPGRADE_FIXTURE/arguments"\nprintf \'[{"Id":"' + image + '","RepoDigests":[]}]\\n\'\n', {mode: 0o755});
    fs.writeFileSync(path.join(directory, 'docker-compose.native'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$SYSTEM_PUBLIC_UPGRADE_FIXTURE/arguments"\nprintf "%s" "$BOOTSTRAPPER_IMAGE"\n', {mode: 0o755});
    const env = {...process.env, SYSTEM_PUBLIC_UPGRADE_FIXTURE: directory};
    const args = ['--host=unix:///var/run/docker.sock', 'image', 'inspect', reference];
    const inspected = JSON.parse(execFileSync(docker, args, {env, encoding: 'utf8'}));
    assert.equal(inspected[0].Id, image);
    assert.deepEqual(inspected[0].RepoDigests, [reference]);
    execFileSync(docker, ['exec', 'fixture', 'printf', '%s', 'one two'], {env});
    assert.equal(fs.readFileSync(path.join(directory, 'arguments'), 'utf8').split('\n').at(-2), 'one two');
    const output = execFileSync(compose, ['-f', '/source/system/docker-compose.yml', 'up', '--no-build', '-d', 'bootstrapper'],
      {env: {...env, BOOTSTRAPPER_IMAGE: reference}, encoding: 'utf8'});
    assert.equal(output, image);
    assert.match(fs.readFileSync(path.join(directory, 'arguments'), 'utf8'), new RegExp('-f\\n' + directory + '/compose.yml\\nup'));
    fs.writeFileSync(path.join(directory, 'offline-recovery'), 'offline');
    assert.throws(() => execFileSync(docker, args, {env, stdio: 'pipe'}), error => error.status === 87);
    execFileSync(docker, ['image', 'inspect', 'system-bootstrapper-recovery:' + 'a'.repeat(64)], {env});
    fs.writeFileSync(path.join(directory, 'fail-recovery-once'), 'once');
    const recoveryEnv = {...env, BOOTSTRAPPER_IMAGE: 'system-bootstrapper-recovery:' + 'a'.repeat(64)};
    assert.throws(() => execFileSync(compose, ['-f', '/source/system/docker-compose.yml', 'up', '-d', 'bootstrapper'],
      {env: recoveryEnv, stdio: 'pipe'}), error => error.status === 88);
    assert.equal(fs.existsSync(path.join(directory, 'fail-recovery-once')), false);
    execFileSync(compose, ['-f', '/source/system/docker-compose.yml', 'up', '-d', 'bootstrapper'], {env: recoveryEnv});
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('mount adapter only models the exact owned live filesystem and delegates backup or unrelated paths', () => {
  const script = path.resolve(__dirname, '../e2e/public-upgrade-findmnt.sh');
  const env = {...process.env, SYSTEM_PUBLIC_UPGRADE_LIVE: '/recovered-data/platform'};
  assert.equal(execFileSync(script, ['-rn', '-T', '/recovered-data/platform/configuration', '-o', 'MAJ:MIN'], {env, encoding: 'utf8'}), '0:1\n');
  for (const target of ['/tmp', os.tmpdir()]) {
    const args = ['-rn', '-T', target, '-o', 'MAJ:MIN'];
    assert.equal(execFileSync(script, args, {env, encoding: 'utf8'}), execFileSync('/usr/bin/findmnt', args, {encoding: 'utf8'}));
  }
});

test('native host helper mounts backup strictly for plan/apply and performs recovery/status without backup storage', async () => {
  const calls = [], candidate = {id: 'a'.repeat(24), spec: {restore: {base: '/recovered-data/platform'}, images: {gitlab: {id: id('7')}}},
    inner: async args => { calls.push(args); return '{}'; }};
  const native = new NativeCLI(candidate);
  await native.invoke(['--operation', 'plan']);
  assert(calls[0].includes('type=bind,src=/external-seed,dst=/external-seed'));
  assert(calls[0].includes(native.fixture + '/source:' + native.fixture + '/source:ro'));
  for (const operation of ['recover', 'status', 'restore-original']) {
    await native.invoke(operation === 'restore-original' ? [operation] : ['--operation', operation]);
    assert(!calls.at(-1).some(value => value.includes('/external-seed')));
    assert(calls.at(-1).includes('/var/run/docker.sock:/var/run/docker.sock'));
    assert(calls.at(-1).includes('--entrypoint'));
  }
});
