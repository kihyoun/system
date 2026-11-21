'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {pack} = require('../../dist/modules/source-preparation/wizard-source.service');
const {CommittedContextService} = require('../../dist/modules/ci/committed-context.service');
const {NativeContextProcess} = require('../../dist/modules/ci/context-process');
const {WizardSourceService} = require('../../dist/modules/source-preparation/wizard-source.service');
const committedContext = new CommittedContextService(new NativeContextProcess(), new WizardSourceService());
const {CodeqlContextService} = require('../../dist/modules/ci/codeql-context.service');
const prepare = root => new CodeqlContextService(committedContext).prepare(root);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeql-shared-source-'));
const source = path.resolve(__dirname, '../..');
const selectors = {SYSTEM_SOURCE_GIT_DIR: process.env.SYSTEM_SOURCE_GIT_DIR, WIZARD_SOURCE_GIT_DIR: process.env.WIZARD_SOURCE_GIT_DIR};
const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const write = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, value); };
try {
  for (const key of Object.keys(selectors)) delete process.env[key];
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write('src/modules/ci/codeql.service.ts', 'public scanner service fixture\n');
  for (const name of ['Dockerfile', 'check-sarif.js']) write('tests/codeql/' + name, 'scanner fixture\n');
  write('src/api/index.ts', 'export const role = "sync";\n');
  write('wizard/package.json', '{}\n');
  write('wizard/.gitlab-ci.yml', 'stages: [test]\n');
  write('wizard/src/index.tsx', 'export const role = "wizard";\n');
  write('wizard/src/api/Helper.tsx', fs.readFileSync(path.join(__dirname, '../../wizard/src/api/Helper.tsx')));
  write('wizard/start.sh', '#!/bin/sh\nexit 0\n');
  write('wizard/.system-bootstrapper/build-v1/smoke/check.js', 'historical public scan input\n');
  write('wizard/.env', 'excluded-secret\n');
  git('add', '.'); git('update-index', '--chmod=+x', 'wizard/start.sh'); git('commit', '-qm', 'Shared source');
  const revision = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD:wizard');
  const snapshot = pack(root); assert.equal(snapshot.version, 2);
  write('assets/wizard-source/snapshot.json', JSON.stringify(snapshot));
  write('wizard/src/index.tsx', 'dirty-secret'); write('wizard/credentials.json', 'untracked-secret');
  const result = prepare(root);
  assert.equal(result.sourceLayout, 'system-monorepo-v1');
  assert.equal(result.sourceRevision, revision); assert.equal(result.wizardSourceTree, tree);
  assert.equal(result.wizardRevision, undefined);
  assert.deepEqual(result.excludedGenerated, [], 'Older contexts without the portable inventory retain every source input');
  assert.equal(new Set(result.files).size, result.files.length);
  assert(result.files.includes('src/api/index.ts'));
  assert(result.files.includes('wizard/src/index.tsx'));
  assert(result.files.includes('wizard/.system-bootstrapper/build-v1/smoke/check.js'));
  assert(!result.files.some(file => /wizard\/(wizard|sync|tests)\//.test(file)));
  assert(!result.files.some(file => /credentials|\.env$/.test(file)));
  const archive = path.join(root, '.codeql-context/context.tar');
  assert.equal(execFileSync('tar', ['-xOf', archive, 'source/wizard/src/index.tsx'], {encoding: 'utf8'}), 'export const role = "wizard";\n');
  assert.match(execFileSync('tar', ['-tvf', archive, 'source/wizard/start.sh'], {encoding: 'utf8'}), /^-rwxr[-w]xr-x/);
  write('assets/wizard-source/snapshot.json', JSON.stringify({...snapshot, wizardSourceTree: '0'.repeat(40)}));
  assert.throws(() => prepare(root), /manifest hash|committed source/);
  write('assets/wizard-source/snapshot.json', JSON.stringify(snapshot));

  const runtimePaths = ['templates/project-bootstrap/wizard-build/typed-v6/runtime/project-ci.cjs',
    'wizard/.gitlab/runtime/project-ci.cjs', 'wizard/.system-bootstrapper/build-v2/runtime/project-ci.cjs'];
  const licensePaths = runtimePaths.map(name => path.posix.join(path.posix.dirname(name), 'LICENSES.txt'));
  const producerPath = 'wizard/.gitlab/producer-v2.json';
  // The isolated source snapshot omits reserved installed recipes. Construct
  // their fixture copies from the canonical template shipped in that context.
  const runtime = fs.readFileSync(path.join(source, runtimePaths[0]));
  const license = fs.readFileSync(path.join(source, licensePaths[0]));
  const actual = new Map([...runtimePaths.map(name => [name, runtime]),
    ...licensePaths.map(name => [name, license]),
    [producerPath, fs.readFileSync(path.join(source, producerPath))]]);
  const restore = name => write(name, actual.get(name));
  const commit = (message, names) => {
    git('add', '-A', '--', ...names); git('commit', '-qm', message);
    write('assets/wizard-source/snapshot.json', JSON.stringify(pack(root)));
  };
  restore(runtimePaths[1]);
  commit('Incomplete generated inventory', [runtimePaths[1]]);
  assert.throws(() => prepare(root), /generated runtime inventory is incomplete/);
  for (const name of actual.keys()) restore(name);
  const fourth = 'wizard/.system-bootstrapper/build-v3/runtime/project-ci.cjs';
  const historical = 'templates/project-bootstrap/wizard-build/typed-v5/runtime/project-ci.cjs';
  const authored = 'src/modules/project-ci/portable-entry.ts';
  write(fourth, actual.get(runtimePaths[0])); write(historical, actual.get(runtimePaths[0]));
  write(authored, 'export const bootstrap = true;\n');
  commit('Complete generated inventory and other public sources', [...actual.keys(), fourth, historical, authored]);
  // Dirty copies cannot authorize omissions or change their recorded hashes.
  for (const name of [...runtimePaths, producerPath]) write(name, 'uncommitted generated artifact replacement\n');
  const generated = prepare(root);
  const runtimeHash = crypto.createHash('sha256').update(actual.get(runtimePaths[0])).digest('hex');
  assert.deepEqual(generated.excludedGenerated.map(entry => entry.path).sort(), [...runtimePaths].sort());
  for (const entry of generated.excludedGenerated) {
    assert.equal(entry.sha256, runtimeHash);
    assert.equal(entry.license.sha256, crypto.createHash('sha256').update(actual.get(entry.license.path)).digest('hex'));
    assert(generated.files.includes(entry.license.path), 'License companions stay in the public source archive');
    assert(!generated.files.includes(entry.path));
  }
  for (const name of [fourth, historical, authored, 'wizard/.system-bootstrapper/build-v1/smoke/check.js'])
    assert(generated.files.includes(name), 'Exact generated inventory must retain other public source: ' + name);
  const archiveNames = execFileSync('tar', ['-tf', archive], {encoding: 'utf8'}).split('\n');
  for (const name of runtimePaths) assert(!archiveNames.includes('source/' + name));
  assert(execFileSync('tar', ['-xOf', archive, 'source/' + fourth], {maxBuffer: 8 * 1024 * 1024}).equals(actual.get(runtimePaths[0])));
  const archivedManifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'source/scan-source.json'], {encoding: 'utf8'}));
  assert.deepEqual(archivedManifest.excludedGenerated, generated.excludedGenerated);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.codeql-context/manifest.json'), 'utf8')).excludedGenerated, generated.excludedGenerated);
  for (const name of [...runtimePaths, producerPath]) restore(name);
  write(runtimePaths[0], Buffer.concat([actual.get(runtimePaths[0]), Buffer.from('// changed committed copy\n')]));
  commit('Reject a changed generated copy', [runtimePaths[0]]);
  assert.throws(() => prepare(root), /generated runtime copies differ/);
  restore(runtimePaths[0]); commit('Restore generated copy', [runtimePaths[0]]);
  const producer = JSON.parse(actual.get(producerPath).toString('utf8'));
  write(producerPath, JSON.stringify({...producer, runtimeSha256: '0'.repeat(64)}));
  commit('Reject producer hash mismatch', [producerPath]);
  assert.throws(() => prepare(root), /producer identity or SHA-256 differs/);
  restore(producerPath); commit('Restore producer identity', [producerPath]);
  write(licensePaths[2], Buffer.concat([actual.get(licensePaths[2]), Buffer.from('changed license\n')]));
  commit('Reject license mismatch', [licensePaths[2]]);
  assert.throws(() => prepare(root), /license copies differ/);
  restore(licensePaths[2]); commit('Restore license identity', [licensePaths[2]]);
  fs.rmSync(path.join(root, runtimePaths[2]));
  commit('Reject a missing generated copy', [runtimePaths[2]]);
  assert.throws(() => prepare(root), /generated runtime inventory is incomplete/);
  restore(runtimePaths[2]); commit('Restore missing generated copy', [runtimePaths[2]]);
  const runtimeBlob = git('rev-parse', 'HEAD:' + runtimePaths[0]);
  git('update-index', '--cacheinfo', '120000,' + runtimeBlob + ',' + runtimePaths[0]);
  git('commit', '-qm', 'Reject a generated artifact link');
  write('assets/wizard-source/snapshot.json', JSON.stringify(pack(root)));
  assert.throws(() => prepare(root), /links and nested submodules/);
  git('update-index', '--cacheinfo', '100644,' + runtimeBlob + ',' + runtimePaths[0]);
  git('commit', '-qm', 'Restore regular generated artifact');
  write('assets/wizard-source/snapshot.json', JSON.stringify(pack(root)));
  git('update-index', '--add', '--cacheinfo', '120000,' + git('hash-object', 'wizard/package.json') + ',wizard/unsafe-link');
  git('commit', '-qm', 'Unsafe source link');
  assert.throws(() => prepare(root), /links and nested submodules/);
  console.log('PASS: committed CodeQL source, exact generated inventory and hashes, retained authored/historical/other generated source, incomplete/tampered/license/producer/link rejection.');
} finally {
  fs.rmSync(root, {recursive: true, force: true});
  for (const [key, value] of Object.entries(selectors)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
