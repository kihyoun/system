const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, after } = require('node:test');
const cli = path.resolve(__dirname, '../../dist/cli/main.js');

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: '/', env: { PATH: '', HOME: '/nonexistent', NO_COLOR: '' },
    encoding: 'utf8', timeout: 10000,
  });
}

test('help and version work without host tools, configuration or services', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: system-bootstrapper/);
  assert.match(help.stdout, /promotion-abort/);
  assert.match(help.stdout, /recovery-export/);
  assert.match(help.stdout, /gitlab-credentials/);
  assert.match(help.stdout, /controller-update/);
  assert.match(help.stdout, /promote/);
  assert.match(help.stdout, /gitlab-upgrade/);
  assert.match(help.stdout, /upgrade/);
  assert.match(help.stdout, /cli-install --runtime/);
  assert.match(help.stdout, /accepted-release\.json/);
  assert.match(help.stdout, /accepted-cli\.tgz/);
  assert.match(help.stdout, /--artifact/);
  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, require('../../package.json').version + '\n');
});

test('bare startup greets the user without starting an operation', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /You build it\. You own it\./);
  assert.ok(!result.stdout.includes('\x1b'));
});

test('unknown arguments fail without invoking an external command', () => {
  const result = run(['harvest', '--unexpected']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /unknown-command-use-help/);
  const recovery = run(['promotion-abort', '--checkout', '/source']);
  assert.equal(recovery.status, 1);
  assert.equal(recovery.stdout, '');
  assert.match(recovery.stderr, /promotion-checkpoint-and-persistence-required/);
  const archive=run(['recovery-export','--checkout','/source']);
  assert.equal(archive.status,1);assert.equal(archive.stdout,'');assert.match(archive.stderr,/missing-persistence-env/);
});

test('explicit recovery commands require source and image before any native command', async () => {
  for (const args of [['restore', '--checkout', '/source'], ['harvest', '--checkout', 'relative', '--image', 'pin']]) {
    const result=run(args); assert.equal(result.status,1); assert.equal(result.stdout,'');
    assert.match(result.stderr,/explicit-host-checkout-required|accepted-controller-image-required/);
  }
  const {parseHostArguments}=require('../../dist/cli/main.js');
  assert.deepEqual(parseHostArguments(['restore','--checkout','/source','--image','pin','--check-only','--configuration-backup','/backup.zip']),{
    checkout:'/source',image:'pin',persistenceEnv:'/etc/system-bootstrapper/persistence.env',configurationBackup:'/backup.zip',checkOnly:true,forward:[]
  });
  assert.throws(()=>parseHostArguments(['harvest','--image','one','--image','two']),/duplicate-option/);
  for (const action of ['controller-update','upgrade','recovery','promote','gitlab-upgrade']) {
    const {resolveHostArguments}=require('../../dist/cli/main.js');await assert.rejects(resolveHostArguments([action],async()=>{throw Error('cli-installation-required');}),/cli-installation-required/);
    const invalid=run([action,'--checkout','/source','--force']);assert.equal(invalid.status,1);assert.equal(invalid.stdout,'');assert.match(invalid.stderr,/operation-failed/);
  }
});

test('host lifecycle CLI refuses invalid explicit checkout and unexpected flags before host work', () => {
  for (const action of ['start', 'stop', 'persistence']) {
    for (const args of [[action, '--checkout', 'relative'], [action, '--checkout', '/source', '--force']]) {
      const result = run(args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /explicit-host-checkout-required/);
    }
  }
});

const fs = require('node:fs');
let sharedNodeDirectory;
function fixtureNode() {
  if (!sharedNodeDirectory) {
    sharedNodeDirectory = fs.mkdtempSync('/tmp/system-cli-node-');
    fs.chmodSync(sharedNodeDirectory,0o755);
    fs.copyFileSync(process.execPath,path.join(sharedNodeDirectory,'node'),fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(path.join(sharedNodeDirectory,'node'),0o755);
  }
  return path.join(sharedNodeDirectory,'node');
}
after(() => {if (sharedNodeDirectory) fs.rmSync(sharedNodeDirectory,{recursive:true,force:true});});
function installationFixture(t, runtimeOnly = false) {
  // Root-owned executable ancestry is part of the real installation contract;
  // inherited TMPDIR may intentionally point into an unprivileged workspace.
  const root = fs.mkdtempSync('/tmp/system-cli-installation-');
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.chmodSync(root, 0o755);
  const runtime = path.join(root, 'runtime');
  const packageRoot = runtimeOnly ? path.join(runtime, 'cli/node_modules/@systembootstrapper/cli') : path.join(root, 'package');
  const checkout = path.join(root, 'checkout'), data = path.join(root, 'data');
  const privateDirectory = path.join(root, 'private'), commandDirectory = path.join(root, 'bin');
  for (const directory of [checkout, privateDirectory, commandDirectory, path.join(data, 'configuration'), path.join(packageRoot, 'dist/cli')])
    fs.mkdirSync(directory, {recursive: true, mode: 0o755});
  fs.chmodSync(privateDirectory, 0o700);
  fs.chmodSync(path.join(data, 'configuration'), 0o700);
  const nodeExecutable = path.join(root, 'node');
  fs.linkSync(fixtureNode(),nodeExecutable);
  const metadata = require('../../package.json');
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({name: metadata.name, version: metadata.version, bin: metadata.bin}));
  for (const name of ['main.js', 'presentation.js', 'applicationCommands.js'])
    fs.copyFileSync(path.resolve(__dirname, '../../dist/cli', name), path.join(packageRoot, 'dist/cli', name));
  const source = {sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), sourceLayout: 'system-monorepo-v1', wizardSourceTree: 'c'.repeat(40)};
  const controller = 'docker.io/example/system@sha256:' + 'd'.repeat(64);
  const persistenceEnv = path.join(privateDirectory, 'persistence.env');
  fs.writeFileSync(persistenceEnv, `PERSISTENCE_MODE=local\nPERSISTENT_DIR='${data}'\n`, {mode: 0o600});
  const receipt = path.join(data, 'configuration/.release-images.json');
  fs.writeFileSync(receipt, JSON.stringify({schemaVersion: 1, status: 'startup-requested', ...source}), {mode: 0o600});
  const main = path.join(data, 'configuration/.docker.env');
  fs.writeFileSync(main, `BOOTSTRAPPER_IMAGE='${controller}'\n`, {mode: 0o600});
  const paths = {binding: path.join(privateDirectory, 'cli-installation.json'), command: path.join(commandDirectory, 'system-bootstrapper'), packageRoot, nodeExecutable};
  const calls = [];
  const host = {rootUser: () => true, source(directory) {calls.push(directory); assert([checkout,packageRoot].includes(directory)); return source;}};
  const {CliInstallationService} = require('../../dist/modules/host-bootstrap/cliInstallation.service');
  const service = new CliInstallationService(host, paths);
  return {root, runtime, packageRoot, checkout, data, persistenceEnv, source, controller, paths, calls, host, service, main, receipt};
}

test('installed npm command works in fresh and sudo-style sessions while host selection stays private', {skip: process.getuid?.() !== 0}, async t => {
  const f = installationFixture(t);
  const npmScope = path.join(f.root, 'npm/lib/node_modules/@systembootstrapper');
  fs.mkdirSync(npmScope, {recursive: true, mode: 0o755});
  const npmPackage = path.join(npmScope, 'cli');
  fs.symlinkSync(f.packageRoot, npmPackage, 'dir');
  const npmEntry = path.join(npmPackage, 'dist/cli/main.js');
  fs.symlinkSync(npmEntry, f.paths.command);
  f.service.install({checkout: f.checkout, persistenceEnv: f.persistenceEnv});
  assert.equal(fs.readlinkSync(f.paths.command), npmEntry, 'an owned existing npm-link command is retained');
  assert.equal(fs.realpathSync(f.paths.command), path.join(f.packageRoot, 'dist/cli/main.js'));
  const bindingBytes = fs.readFileSync(f.paths.binding), entryBytes = fs.readFileSync(f.paths.command);
  f.service.install({checkout: f.checkout, persistenceEnv: f.persistenceEnv});
  assert(fs.readFileSync(f.paths.binding).equals(bindingBytes));
  assert(fs.readFileSync(f.paths.command).equals(entryBytes));
  assert.equal(fs.readFileSync(f.paths.command, 'utf8').split('\n')[0], '#!' + f.paths.nodeExecutable);
  assert.equal(fs.statSync(f.paths.binding).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.persistenceEnv).mode & 0o777, 0o600);
  for (const identity of [{}, {uid: 65534, gid: 65534}]) {
    const result = spawnSync('/bin/sh', ['-c', 'command -v system-bootstrapper; system-bootstrapper --version; system-bootstrapper --help'], {
      ...identity, cwd: '/', encoding: 'utf8', timeout: 10000,
      env: {PATH: path.dirname(f.paths.command), HOME: '/nonexistent', NO_COLOR: ''},
    });
    assert.equal(result.status, 0, result.stderr);
    assert(result.stdout.startsWith(f.paths.command + '\n' + require('../../package.json').version + '\n'));
    assert.match(result.stdout, /Usage: system-bootstrapper/);
    assert(!result.stdout.includes(f.persistenceEnv));
  }
  const previousDirectory = process.cwd();
  try {
    process.chdir('/');
    assert.deepEqual(f.service.resolve(), {checkout: f.checkout, persistenceEnv: f.persistenceEnv});
  } finally {process.chdir(previousDirectory);}
  assert.deepEqual(f.service.resolve(true), {checkout: f.checkout, persistenceEnv: f.persistenceEnv, image: f.controller});
  const {resolveHostArguments} = require('../../dist/cli/main.js');
  assert.deepEqual(await resolveHostArguments(['harvest'], storage => f.service.resolve(storage)), ['harvest', '--checkout', f.checkout, '--image', f.controller, '--persistence-env', f.persistenceEnv]);
  const previous = process.env.PERSISTENCE_ENV_FILE;
  try {
    assert.deepEqual(await resolveHostArguments(['start'], storage => f.service.resolve(storage)), ['start', '--checkout', f.checkout]);
    assert.equal(process.env.PERSISTENCE_ENV_FILE, f.persistenceEnv);
  } finally {if (previous === undefined) delete process.env.PERSISTENCE_ENV_FILE; else process.env.PERSISTENCE_ENV_FILE = previous;}
  const explicit = ['restore', '--checkout', '/reviewed', '--image', f.controller];
  assert.deepEqual(await resolveHostArguments(explicit, () => assert.fail('explicit recovery must not read an installed binding')), explicit);
  await assert.rejects(resolveHostArguments(['restore', '--persistence-env', '/other'], storage => f.service.resolve(storage)), /selector-mismatch/);
  await assert.rejects(resolveHostArguments(['harvest', '--other'], () => assert.fail('invalid flags must fail before binding')), /unknown-command-use-help/);
  fs.unlinkSync(f.main);
  fs.writeFileSync(path.join(f.data, 'configuration/.release-images.env'), `BOOTSTRAPPER_IMAGE='${f.controller}'\n`, {mode: 0o600});
  assert.equal(f.service.resolve(true).image, f.controller);
  assert(f.calls.length >= 3, 'install and resolution both verify the selected source');
});

test('CLI installation refuses missing, unsafe, changed and foreign bindings before host work', {skip: process.getuid?.() !== 0}, t => {
  const f = installationFixture(t);
  assert.throws(() => f.service.resolve(), /cli-installation-required/);
  fs.writeFileSync(f.paths.command, 'foreign command', {mode: 0o755});
  assert.throws(() => f.service.install({checkout: f.checkout, persistenceEnv: f.persistenceEnv}), /command-already-exists/);
  assert.equal(fs.readFileSync(f.paths.command, 'utf8'), 'foreign command');
  fs.unlinkSync(f.paths.command);
  assert.throws(() => f.service.install({checkout: 'relative', persistenceEnv: f.persistenceEnv}), /absolute-path-required/);
  const {CliInstallationService} = require('../../dist/modules/host-bootstrap/cliInstallation.service');
  assert.throws(() => new CliInstallationService({...f.host, rootUser: () => false}, f.paths).install({checkout: f.checkout}), /requires-root/);
  const unsafe = installationFixture(t);
  fs.chownSync(unsafe.packageRoot,1000,1000);
  assert.throws(() => unsafe.service.install({checkout:unsafe.checkout,persistenceEnv:unsafe.persistenceEnv}),/cli-root-owned-path-required/);
  fs.chownSync(unsafe.packageRoot,0,0);fs.chmodSync(unsafe.packageRoot,0o777);
  assert.throws(() => unsafe.service.install({checkout:unsafe.checkout,persistenceEnv:unsafe.persistenceEnv}),/cli-root-owned-path-required/);
  fs.chmodSync(unsafe.packageRoot,0o755);
  fs.renameSync(path.join(unsafe.packageRoot,'dist'),path.join(unsafe.packageRoot,'dist-real'));
  fs.symlinkSync(path.join(unsafe.packageRoot,'dist-real'),path.join(unsafe.packageRoot,'dist'),'dir');
  assert.throws(() => unsafe.service.install({checkout:unsafe.checkout,persistenceEnv:unsafe.persistenceEnv}),/cli-root-owned-path-required/);
  assert(!fs.existsSync(unsafe.paths.command));assert(!fs.existsSync(unsafe.paths.binding));
  const hidden = installationFixture(t);
  const scope = path.join(hidden.root,'npm/lib/node_modules/@systembootstrapper'),controlled = path.join(hidden.root,'user-controlled');
  fs.mkdirSync(scope,{recursive:true});fs.mkdirSync(controlled);fs.chownSync(controlled,1000,1000);
  const intermediate=path.join(controlled,'package'),npmPackage=path.join(scope,'cli');
  fs.symlinkSync(hidden.packageRoot,intermediate,'dir');fs.lchownSync(intermediate,1000,1000);
  fs.symlinkSync(intermediate,npmPackage,'dir');
  const linkedEntry=path.join(npmPackage,'dist/cli/main.js');fs.symlinkSync(linkedEntry,hidden.paths.command);
  const hiddenEntry=path.join(hidden.packageRoot,'dist/cli/main.js'),hiddenBytes=fs.readFileSync(hiddenEntry);
  assert.equal(fs.lstatSync(npmPackage).uid,0);assert.equal(fs.realpathSync(hidden.paths.command),hiddenEntry);
  assert.throws(() => hidden.service.install({checkout:hidden.checkout,persistenceEnv:hidden.persistenceEnv}),/cli-command-already-exists/,'every actual symlink target ancestor must be trusted');
  assert.equal(fs.readlinkSync(hidden.paths.command),linkedEntry);assert(!fs.existsSync(hidden.paths.binding));assert(fs.readFileSync(hiddenEntry).equals(hiddenBytes));
  const links=path.join(hidden.root,'links');fs.mkdirSync(links);
  fs.symlinkSync(path.join(links,'b'),path.join(links,'a'),'dir');fs.symlinkSync(path.join(links,'a'),path.join(links,'b'),'dir');
  fs.unlinkSync(npmPackage);fs.symlinkSync(path.join(links,'a'),npmPackage,'dir');
  assert.throws(() => hidden.service.install({checkout:hidden.checkout,persistenceEnv:hidden.persistenceEnv}),/cli-command-already-exists/,'cyclic command target chains fail closed');
  for(let index=0;index<42;index++)fs.symlinkSync(index===41?hidden.packageRoot:path.join(links,'deep-'+(index+1)),path.join(links,'deep-'+index),'dir');
  fs.unlinkSync(npmPackage);fs.symlinkSync(path.join(links,'deep-0'),npmPackage,'dir');
  assert.throws(() => hidden.service.install({checkout:hidden.checkout,persistenceEnv:hidden.persistenceEnv}),/cli-command-already-exists/,'excessive command target chains fail closed');
  assert(!fs.existsSync(hidden.paths.binding));assert(fs.readFileSync(hiddenEntry).equals(hiddenBytes));
  f.service.install({checkout: f.checkout, persistenceEnv: f.persistenceEnv});
  const saved = fs.readFileSync(f.paths.binding);
  for (const mutate of [value => value.format = 'unknown', value => value.checkout = 'relative', value => value.source.sourceCommit = 'e'.repeat(40)]) {
    const value = JSON.parse(saved); mutate(value); fs.writeFileSync(f.paths.binding, JSON.stringify(value));
    assert.throws(() => f.service.resolve(), /binding-invalid|source-mismatch/);
  }
  fs.writeFileSync(f.paths.binding, saved); fs.chmodSync(f.paths.binding, 0o644);
  assert.throws(() => f.service.resolve(), /private-file-permissions-or-owner-mismatch/);
  fs.chmodSync(f.paths.binding, 0o600);
  fs.writeFileSync(f.main, 'BOOTSTRAPPER_IMAGE=mutable:latest\n');
  assert.throws(() => f.service.resolve(true), /saved-controller-image-required/);
  const selectorBytes = fs.readFileSync(f.persistenceEnv);fs.unlinkSync(f.persistenceEnv);
  assert.throws(() => f.service.resolve(), error => error.code === 'ENOENT');
  fs.writeFileSync(f.persistenceEnv, selectorBytes, {mode: 0o600});
  fs.unlinkSync(f.paths.binding); fs.symlinkSync(f.persistenceEnv, f.paths.binding);
  assert.throws(() => f.service.resolve());

  const inaccessible = installationFixture(t);
  const inaccessibleEntry = path.join(inaccessible.packageRoot, 'dist/cli/main.js');
  const originalEntry = fs.readFileSync(inaccessibleEntry);
  const originalMode = fs.statSync(inaccessibleEntry).mode & 0o777;
  fs.chmodSync(inaccessible.root, 0o700);
  assert.throws(() => inaccessible.service.install({checkout: inaccessible.checkout, persistenceEnv: inaccessible.persistenceEnv}), /cli-public-runtime-required/);
  assert(fs.readFileSync(inaccessibleEntry).equals(originalEntry), 'failed public-ancestor preflight must not rewrite the bin');
  assert.equal(fs.statSync(inaccessibleEntry).mode & 0o777, originalMode);
  assert(!fs.existsSync(inaccessible.paths.command));
  assert(!fs.existsSync(inaccessible.paths.binding));

  const unpublished = installationFixture(t);
  const unpublishedEntry = path.join(unpublished.packageRoot, 'dist/cli/main.js');
  const unpublishedBytes = fs.readFileSync(unpublishedEntry);
  const unpublishedMode = fs.statSync(unpublishedEntry).mode & 0o777;
  const rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => {if (to === unpublished.paths.binding) throw Object.assign(new Error('binding publication failed'), {code: 'EIO'}); return rename(from, to);};
    assert.throws(() => unpublished.service.install({checkout: unpublished.checkout, persistenceEnv: unpublished.persistenceEnv}), /binding publication failed/);
  } finally {fs.renameSync = rename;}
  assert(!fs.existsSync(unpublished.paths.command), 'no public command before a durable binding');
  assert(!fs.existsSync(unpublished.paths.binding));
  assert(fs.readFileSync(unpublishedEntry).equals(unpublishedBytes), 'failed binding publication rolls back executable changes');
  assert.equal(fs.statSync(unpublishedEntry).mode & 0o777, unpublishedMode);

  const unlinked = installationFixture(t);
  const unlinkedEntry = path.join(unlinked.packageRoot, 'dist/cli/main.js');
  const unlinkedBytes = fs.readFileSync(unlinkedEntry);
  const symlink = fs.symlinkSync;
  try {
    fs.symlinkSync = (target, destination, type) => {if (destination === unlinked.paths.command) throw Object.assign(new Error('command publication failed'), {code: 'EIO'}); return symlink(target, destination, type);};
    assert.throws(() => unlinked.service.install({checkout: unlinked.checkout, persistenceEnv: unlinked.persistenceEnv}), /command publication failed/);
  } finally {fs.symlinkSync = symlink;}
  assert(!fs.existsSync(unlinked.paths.command));
  assert(!fs.existsSync(unlinked.paths.binding), 'failed final command publication rolls back the new binding');
  assert(fs.readFileSync(unlinkedEntry).equals(unlinkedBytes));
});

test('accepted runtime-only CLI installation exposes help without inventing a host checkout', {skip: process.getuid?.() !== 0}, t => {
  const f = installationFixture(t, true);
  const {hash, integrity} = require('../../dist/modules/release/npmIdentity');
  const version = require('../../package.json').version;
  const provenance = {format: 'system-cli-source-v1', version, sourceRevision: f.source.sourceCommit, sourceTree: f.source.sourceTree, pipelineId: 1, packageJobId: 2};
  fs.mkdirSync(path.join(f.packageRoot, 'assets'));
  const provenanceFile = path.join(f.packageRoot, 'assets/source.json');
  fs.writeFileSync(provenanceFile, JSON.stringify(provenance));
  const staging = path.join(f.root, 'archive');
  fs.mkdirSync(staging);
  fs.cpSync(f.packageRoot, path.join(staging, 'package'), {recursive: true});
  const artifact = path.join(f.root, 'private/accepted-cli.tgz');
  const packed = spawnSync('tar', ['--create', '--gzip', '--file', artifact, '--directory', staging, 'package'], {encoding: 'utf8'});
  assert.equal(packed.status, 0, packed.stderr);
  fs.chmodSync(artifact, 0o600);
  const artifactBytes = fs.readFileSync(artifact);
  const cliReceipt = {format: 'system-cli-source-v1', name: '@systembootstrapper/cli', ...provenance, filename: `systembootstrapper-cli-${version}.tgz`, sha256: hash(artifactBytes), integrity: integrity(artifactBytes)};
  const images = Object.fromEntries(['controller', 'wizard'].map(role => [role, {reference: `docker.io/example/${role}@sha256:` + 'd'.repeat(64), imageId: 'sha256:' + 'd'.repeat(64), configDigest: 'sha256:' + 'd'.repeat(64)}]));
  const release = {format: 'system-accepted-release-v1', version, tag: 'v' + version, platform: 'linux/amd64', source: {revision: f.source.sourceCommit, tree: f.source.sourceTree, sourceLayout: f.source.sourceLayout, wizardSourceTree: f.source.wizardSourceTree}, quickstart: {cli: cliReceipt}, images, acceptance: {requiredChecksPassed: true, controllerWizardSameAttempt: true, candidateJobId: 2}};
  const metadata = path.join(f.root, 'private/release.json');
  fs.writeFileSync(metadata, JSON.stringify(release), {mode: 0o600});
  fs.writeFileSync(path.join(f.runtime, 'node-executable'), f.paths.nodeExecutable + '\n');
  const input = {runtime: f.runtime, releaseMetadata: metadata, artifact};
  assert.throws(() => f.service.install({...input, artifact: undefined}), error => error.code === 'ENOENT');
  const entry = path.join(f.packageRoot, 'dist/cli/main.js'), entryBytes = fs.readFileSync(entry);
  fs.appendFileSync(entry, '\n// changed installed bytes\n');
  assert.throws(() => f.service.install(input), /cli-installed-artifact-bytes-mismatch/);
  assert(!fs.existsSync(f.paths.command));
  fs.writeFileSync(entry, entryBytes);
  fs.writeFileSync(provenanceFile, JSON.stringify({...provenance, packageJobId: 3}));
  assert.throws(() => f.service.install(input), /CLI artifact differs from accepted source, job or bytes/);
  assert(!fs.existsSync(f.paths.command));
  fs.writeFileSync(provenanceFile, JSON.stringify(provenance));
  fs.appendFileSync(artifact, 'tampered');
  assert.throws(() => f.service.install(input), /CLI artifact differs from accepted source, job or bytes/);
  assert(!fs.existsSync(f.paths.command));
  fs.writeFileSync(artifact, artifactBytes);
  f.service.install(input);
  fs.copyFileSync(metadata,path.join(f.runtime,'accepted-release.json'));
  fs.copyFileSync(artifact,path.join(f.runtime,'accepted-cli.tgz'));
  fs.chmodSync(path.join(f.runtime,'accepted-release.json'),0o600);
  fs.chmodSync(path.join(f.runtime,'accepted-cli.tgz'),0o600);
  f.service.install({runtime:f.runtime});
  assert(!fs.existsSync(f.paths.binding));
  assert.throws(() => f.service.resolve(), /cli-installation-required/);
  const result = spawnSync(f.paths.command, ['--help'], {cwd: '/', env: {PATH: '', HOME: '/nonexistent'}, encoding: 'utf8', timeout: 10000});
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Usage: system-bootstrapper/);
  assert.equal(f.calls.length, 0, 'runtime-only installation must not select a host source');
});
