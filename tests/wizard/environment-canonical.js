'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const logo = require('../../sync/dist/Helper').default.textLogo;
const source = fs.readFileSync(require.resolve('../../project-bootstrap/wizard-environments/canonical'), 'utf8');
const file = '/system/system/.projects.env/.wizard.env', lock = file + '.environments.lock';
const prefix = '# BOOTSTRAPPER_PROJECT=';
const operation = 'a'.repeat(48), token = 'b'.repeat(48);
const receipt = {defaultProject: true, template: 'wizard', state: 'complete', operation: 'registration', namespaceId: 1,
  repository: {id: 1, path: 'root/wizard', defaultBranch: 'main', ciPath: '.system-bootstrapper/ci.yml', systemProject: true},
  wizardWorkflow: {environments: {operation, controller: 'system_bootstrapper_1', settings: {review: {enabled: false}, beta: {enabled: false}}}}};
let current = JSON.parse(JSON.stringify(receipt));
const encode = () => logo + '# body must retain exact whitespace\n\n' + prefix + Buffer.from(JSON.stringify(current)).toString('base64') + '\n\n';
const files = new Map([[file, encode()], ['/system/system/.docker.env', 'WIZARD_HOST=production.example.test\nGITLAB_REGISTRY_URL=https://registry.example.test\nROOT_PASSWORD=private-never-return\n']]);
const directories = new Set(), inodes = new Map(); let race, inode = 0, existsRace;
const error = code => Object.assign(new Error(code), {code});
const mockfs = {
  existsSync(name) { if (existsRace) existsRace(name); return files.has(name) || directories.has(name); },
  statSync(name) { if (!directories.has(name)) throw error('ENOENT'); return {dev: 1, ino: inodes.get(name)}; },
  readFileSync(name) { if (!files.has(name)) throw error('ENOENT'); return files.get(name); },
  writeFileSync(name, text, options = {}) { if (options.flag === 'wx' && files.has(name)) throw error('EEXIST'); files.set(name, text); },
  mkdirSync(name) { if (directories.has(name)) throw error('EEXIST'); if (race) { const callback = race; race = null; callback(); } directories.add(name); inodes.set(name, ++inode); },
  unlinkSync(name) { if (!files.delete(name)) throw error('ENOENT'); },
  rmdirSync(name) { if ([...files.keys()].some(key => key.startsWith(name + '/'))) throw error('ENOTEMPTY'); if (!directories.delete(name)) throw error('ENOENT'); },
  renameSync(from, to) { if (!files.has(from)) throw error('ENOENT'); files.set(to, files.get(from)); files.delete(from); }
};
const moduleValue = {exports: {}};
const requireValue = name => name === 'fs' ? mockfs : name === 'crypto' ? crypto : name === 'path' ? require('path') : {promises: {lookup: async () => []}};
vm.runInNewContext(source, {require: requireValue, module: moduleValue, Buffer, URL, console, process: {env: {}}});
const run = moduleValue.exports.run;
(async () => {
  const publicRead = await run('read', {});
  assert(!JSON.stringify(publicRead).includes('private-never-return'));
  race = () => { current.wizardWorkflow.environments.operation = 'c'.repeat(48); files.set(file, encode()); };
  await assert.rejects(() => run('lock', {operation, token, helper: 'owned'}));
  assert(!directories.has(lock), 'reservation race stranded a lock');
  current.wizardWorkflow.environments.operation = operation; files.set(file, encode());
  await run('lock', {operation, token, helper: 'owned'});
  const before = files.get(file), read = await run('read', {});
  await run('cas', {operation, token, expectedHash: read.contentHash, deployments: {review: {lastPipelineId: 12}}});
  assert.strictEqual(files.get(file).replace(/^# BOOTSTRAPPER_PROJECT=.*$/m, '# MARKER'), before.replace(/^# BOOTSTRAPPER_PROJECT=.*$/m, '# MARKER'));
  await assert.rejects(() => run('cas', {operation, token, expectedHash: read.contentHash, deployments: {}}));
  current = JSON.parse(Buffer.from(files.get(file).split('\n').find(line => line.startsWith(prefix)).slice(prefix.length), 'base64'));
  current.wizardWorkflow.environments.operation = 'd'.repeat(48); files.set(file, encode());
  await assert.rejects(() => run('unlock', {operation, token: 'f'.repeat(48)}));
  assert(directories.has(lock));
  await run('unlock', {operation, token});
  assert(!directories.has(lock), 'owner could not unlock after external reservation change');
  const lost = 'e'.repeat(48);
  await run('unlock', {operation: current.wizardWorkflow.environments.operation, token: lost});
  await assert.rejects(() => run('lock', {operation: current.wizardWorkflow.environments.operation, token: lost, helper: 'delayed'}));
  assert(!directories.has(lock), 'delayed acquisition ignored its durable cancellation token');
  const replaced = '1'.repeat(48), foreign = '2'.repeat(48);
  existsRace = name => {
    if (name === file + '.environments-cancel-' + replaced && files.has(lock + '/owner')) {
      existsRace = null;
      files.set(name, replaced);
      // Cancellation released the old directory; another owner acquired it.
      inodes.set(lock, ++inode);
      files.set(lock + '/owner', JSON.stringify({token: foreign, helper: 'new-owner'}));
    }
  };
  await assert.rejects(() => run('lock', {operation: current.wizardWorkflow.environments.operation, token: replaced, helper: 'old-owner'}));
  assert(directories.has(lock), 'old acquisition removed a replacement mutex');
  assert.strictEqual(JSON.parse(files.get(lock + '/owner')).token, foreign);
  current.repository = {...current.repository, id: 5, namespaceId: 3, path: 'group/wizard',
    managementMode: 'source-primary', ciPath: '.gitlab/primary.yml'};
  current.sourcePrimary = {version: 1, ciFiles: [{path: '.gitlab/primary.yml', sha256: 'a'.repeat(64)}]};
  files.set(file, encode());
  const nativeRead = await run('read', {});
  assert.strictEqual(nativeRead.receipt.repository.id, 5);
  assert.strictEqual(nativeRead.receipt.repository.managementMode, 'source-primary');
  assert.strictEqual(nativeRead.receipt.repository.namespaceId, 3);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(nativeRead.receipt.sourcePrimary)), current.sourcePrimary);
  current.repository.managementMode = 'unknown'; files.set(file, encode());
  await assert.rejects(() => run('read', {}), /ownership/);
  console.log('Canonical receipt: under-lock reservation check, token-owned unlock, exact-byte deployment CAS, hash conflicts and public-setting allowlist passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
