#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {validate, verifyCommitted} = require('../project-bootstrap/wizard-source/package');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function included(name) {
  return /^[A-Za-z0-9._/-]+$/.test(name) && !name.split('/').some(part => part === '..' || part === '.git') &&
    !/(^|\/)(node_modules|dist|test-results|\.test-context|\.candidate-context|\.codeql-context|\.projects\.env)(\/|$)/.test(name) &&
    (name === 'operations/src/mirror/credentials.service.ts' || !/(^|\/)(private\.env|\.docker\.env|\.env(?:\.[^/]+)?|credentials(?:\.[^/]+)?|bootstrapper\.json|bootstrapper\.zip|bootstrapper_initial_root_password)$/.test(name)) &&
    (name === 'tests/e2e/acme-fixture/pebble.minica.pem' || !/\.(key|pem|p12|pfx)$/.test(name)) &&
    name !== 'project-bootstrap/wizard-source/snapshot.json';
}
function prepare(root) {
  root = path.resolve(root);
  const at = (cwd, ...args) => {
    const gitdir = cwd === root ? process.env.SYSTEM_SOURCE_GIT_DIR : process.env.WIZARD_SOURCE_GIT_DIR;
    return execFileSync('git', ['--no-replace-objects', '-c', 'safe.directory=' + cwd,
      '-c', 'core.hooksPath=/dev/null', '-C', cwd, ...(gitdir ? ['--git-dir=' + gitdir] : []), ...args], {maxBuffer: 32 * 1024 * 1024});
  };
  const git = (...args) => at(root, ...args);
  const revision = git('rev-parse', 'HEAD').toString().trim();
  const snapshot = validate(JSON.parse(fs.readFileSync(path.join(root, 'project-bootstrap/wizard-source/snapshot.json'), 'utf8')));
  verifyCommitted(root, snapshot);
  const sourceEntries = git('ls-tree', '-rz', 'HEAD').toString().split('\0').filter(Boolean).map(entry => {
    const match = /^(\d+) (\w+) [a-f0-9]{40}\t(.+)$/.exec(entry);
    if (!match) throw Error('Unexpected committed source entry.');
    return {mode: match[1], type: match[2], name: match[3]};
  });
  if (sourceEntries.some(entry => entry.name.startsWith('operations/src/') && /\.[cm]?[jt]sx?$/.test(entry.name) && !included(entry.name)))
    throw Error('Operations source path conflicts with a private-data exclusion.');
  const entries = sourceEntries.filter(entry => entry.name !== 'wizard' && !entry.name.startsWith('wizard/') && included(entry.name));
  if (entries.some(entry => entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)))
    throw Error('Static scan context refuses source links and nested submodules.');
  for (const required of ['tests/codeql/Dockerfile', 'operations/src/ci/codeql.service.ts', 'tests/codeql/check-sarif.js'])
    if (!entries.some(entry => entry.name === required)) throw Error('Committed CodeQL tooling is incomplete.');
  const output = path.join(root, '.codeql-context');
  if (fs.existsSync(output) && (fs.lstatSync(output).isSymbolicLink() || !fs.lstatSync(output).isDirectory()))
    throw Error('Static context output must be a real directory.');
  fs.mkdirSync(output, {recursive: true});
  const temporary = fs.mkdtempSync(path.join(output, '.prepare-'));
  try {
    const source = path.join(temporary, 'source');
    fs.mkdirSync(source);
    const archive = path.join(temporary, 'context.tar');
    git('archive', '--format=tar', '--output=' + archive, 'HEAD', '--', ...entries.map(entry => entry.name));
    execFileSync('tar', ['-xf', archive, '-C', source]);
    // Deployment snapshots intentionally omit historical managed build recipes.
    // Static analysis scans all public committed Wizard blobs at that same pin.
    const shared = snapshot.sourceLayout === 'system-monorepo-v1';
    const wizard = shared ? root : path.join(root, 'wizard');
    const wizardTree = shared ? snapshot.wizardSourceTree : snapshot.sourceRevision;
    const wizardFiles = at(wizard, 'ls-tree', '-rz', wizardTree).toString().split('\0').filter(Boolean).map(entry => {
      const match = /^(\d+) (\w+) [a-f0-9]{40}\t(.+)$/.exec(entry);
      if (!match) throw Error('Unexpected committed Wizard entry.');
      return {mode: match[1], type: match[2], name: match[3]};
    }).filter(entry => included(entry.name));
    if (wizardFiles.some(entry => entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)))
      throw Error('Static scan refuses Wizard links and nested submodules.');
    const wizardArchive = path.join(temporary, 'wizard.tar');
    at(wizard, 'archive', '--format=tar', '--output=' + wizardArchive, wizardTree, '--', ...wizardFiles.map(file => file.name));
    fs.mkdirSync(path.join(source, 'wizard'));
    execFileSync('tar', ['-xf', wizardArchive, '-C', path.join(source, 'wizard')]);
    const files = [...entries.map(entry => entry.name), ...wizardFiles.map(file => 'wizard/' + file.name)].sort();
    const manifest = {revision, ...(shared ? {sourceLayout: snapshot.sourceLayout,
      sourceRevision: snapshot.sourceRevision, wizardSourceTree: snapshot.wizardSourceTree} :
      {wizardRevision: snapshot.sourceRevision}), files};
    fs.writeFileSync(path.join(source, 'scan-source.json'), JSON.stringify(manifest) + '\n');
    execFileSync('tar', ['-cf', archive, '-C', temporary, 'source']);
    const names = execFileSync('tar', ['-tf', archive], {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024})
      .split('\n').filter(name => name && !name.endsWith('/')).sort();
    if (JSON.stringify(names) !== JSON.stringify([...files, 'scan-source.json'].map(name => 'source/' + name).sort()))
      throw Error('Static archive differs from selected committed inputs.');
    const checksum = hash(fs.readFileSync(archive));
    fs.writeFileSync(path.join(output, 'revision'), revision + '\n');
    fs.writeFileSync(path.join(output, 'sha256'), checksum + '\n');
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({...manifest, checksum}, null, 2) + '\n');
    fs.renameSync(archive, path.join(output, 'context.tar'));
    return manifest;
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
}
module.exports = {included, prepare};
if (require.main === module) {
  try { console.log('Prepared static scan of ' + prepare(path.resolve(__dirname, '..')).revision); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
