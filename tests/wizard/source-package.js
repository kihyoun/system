const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const {pack, validate, safePath} = require('../../dist/modules/source-preparation/wizard-source.service');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-source-'));
const source = path.resolve(__dirname, '../..');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {stdio: ['ignore', 'pipe', 'pipe']}).toString().trim();
function repo(directory) {
  fs.mkdirSync(directory, {recursive: true}); git(directory, 'init');
  git(directory, 'config', 'user.name', 'Fixture'); git(directory, 'config', 'user.email', 'fixture@example.invalid');
}
try {
  repo(root); const wizard = path.join(root, 'wizard'); repo(wizard);
  fs.mkdirSync(path.join(wizard, 'src/api'), {recursive: true});
  fs.writeFileSync(path.join(wizard, 'package.json'), '{}');
  // The candidate contains only the validated pinned snapshot, not checkout Git
  // metadata. Use its unchanged Helper bytes to seed our disposable Git fixture.
  const snapshotFixture = validate(JSON.parse(fs.readFileSync(path.join(source, 'assets/wizard-source/snapshot.json'), 'utf8')));
  const helper = Buffer.from(snapshotFixture.files.find(file => file.path === 'src/api/Helper.tsx').content, 'base64');
  fs.writeFileSync(path.join(wizard, 'src/api/Helper.tsx'), helper);
  fs.writeFileSync(path.join(wizard, '.gitlab-ci.yml'), 'original upstream ci\n');
  fs.writeFileSync(path.join(wizard, 'README.md'), 'source readme\n');
  fs.writeFileSync(path.join(wizard, 'binary.png'), Buffer.from([0, 255, 128, 13, 10]));
  fs.writeFileSync(path.join(wizard, 'script.sh'), '#!/bin/sh\nexit 0\n');
  fs.mkdirSync(path.join(wizard, '.system-bootstrapper/build-v1'), {recursive: true});
  fs.writeFileSync(path.join(wizard, '.system-bootstrapper/build-v1/build.sh'), '# Generic native producer; the controller installs its managed recipe separately.\n');
  for (const name of ['private.env', '.docker.env', '.env', '.env.local', '.npmrc', 'credentials.json']) fs.writeFileSync(path.join(wizard, name), 'secret');
  git(wizard, 'add', '.'); git(wizard, 'update-index', '--chmod=+x', 'script.sh'); git(wizard, 'commit', '-m', 'Pinned source');
  const revision = git(wizard, 'rev-parse', 'HEAD');
  git(root, 'add', 'wizard'); git(root, 'commit', '-m', 'Pin Wizard');
  fs.writeFileSync(path.join(wizard, 'binary.png'), 'dirty source must never leak');
  fs.writeFileSync(path.join(wizard, 'untracked-token.txt'), 'secret');
  const snapshot = pack(root); assert.equal(snapshot.sourceRevision, revision);
  const files = new Map(snapshot.files.map(file => [file.path, file]));
  assert.deepEqual(Buffer.from(files.get('binary.png').content, 'base64'), Buffer.from([0, 255, 128, 13, 10]));
  assert.equal(files.get('script.sh').mode, '100755');
  assert.equal(Buffer.from(files.get('src/api/Helper.tsx').content, 'base64').compare(helper), 0);
  assert(files.has('.system-bootstrapper/SOURCE_README.md')); assert(!files.has('README.md'));
  assert(!files.has('.system-bootstrapper/build-v1/build.sh'), 'Legacy source import occupied the controller-owned build recipe namespace');
  for (const name of ['private.env', '.docker.env', '.env', '.env.local', '.npmrc', 'credentials.json', 'untracked-token.txt']) assert(!files.has(name));
  assert.equal(Buffer.from(files.get('.system-bootstrapper/preflight.env').content, 'base64').toString(), 'SKIP_PREFLIGHT_CHECK=true\n');
  assert.equal(pack(root).manifestHash, snapshot.manifestHash, 'snapshot ignores dirty checkout');
  const bad = JSON.parse(JSON.stringify(snapshot)); bad.files[0].content = 'YmFk';
  assert.throws(() => validate(bad), /Invalid Wizard source file/);
  for (const name of ['../private.env', '/absolute', 'a//b', 'a/../b', '.git/config', 'space name']) assert(!safePath(name));
  git(wizard, 'update-index', '--add', '--cacheinfo', '120000,' + git(wizard, 'hash-object', 'script.sh') + ',link');
  git(wizard, 'commit', '-m', 'Unsafe link'); git(root, 'add', 'wizard'); git(root, 'commit', '-m', 'Pin unsafe link');
  assert.throws(() => pack(root), /links and nested submodules/);
  git(wizard, 'rm', 'link'); git(wizard, 'commit', '-m', 'Remove unsafe fixture');
  git(root, 'rm', '--cached', 'wizard');
  fs.rmSync(path.join(wizard, '.git'), {recursive: true});
  fs.rmSync(path.join(wizard, 'untracked-token.txt'));
  git(root, 'add', 'wizard'); git(root, 'commit', '-m', 'Import regular Wizard sources');
  const regular = pack(root);
  assert.equal(regular.version, 2);
  assert.equal(regular.sourceLayout, 'system-monorepo-v1');
  assert.equal(regular.sourceRevision, git(root, 'rev-parse', 'HEAD'));
  assert.equal(regular.wizardSourceTree, git(root, 'rev-parse', 'HEAD:wizard'));
  fs.writeFileSync(path.join(wizard, 'binary.png'), 'another dirty source');
  assert.equal(pack(root).manifestHash, regular.manifestHash);
  assert.throws(() => validate({...regular, wizardSourceTree: 'f'.repeat(40)}), /hash mismatch/);
  assert.throws(() => validate({...snapshot, sourceLayout: 'system-monorepo-v1'}), /layout/);
  console.log('Wizard snapshot: pinned objects, binary bytes/modes, private exclusions, dirty checkout, hash/path/link guards passed.');
} finally { fs.rmSync(root, {recursive: true, force: true}); }
