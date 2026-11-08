#!/usr/bin/env node
'use strict';
// Browser inputs come from committed objects and the provenance-checked snapshot.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {validate, verifyCommitted} = require('../project-bootstrap/wizard-source/package');
const recipe = 'tests/wizard-browser.Dockerfile';
// Exact public build inputs only; never copy a host trust store or private CAs.
const systemInputs = [recipe, 'bootstrapper/refresh-ca.sh', 'bootstrapper/ca/cacert-2026-10-20.crt',
  'bootstrapper/ca/provenance.json', 'bootstrapper/ca/check.js'];
function prepareWizardBrowser(root) {
  root = path.resolve(root);
  const git = (...args) => execFileSync('git', ['-c', 'safe.directory='+root, '-C', root, ...args], {maxBuffer:32*1024*1024});
  const revision = git('rev-parse', 'HEAD').toString().trim();
  const pin = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(git('ls-tree', 'HEAD', 'wizard').toString().trim());
  const snapshot = validate(JSON.parse(fs.readFileSync(path.join(root, 'project-bootstrap/wizard-source/snapshot.json'), 'utf8')));
  if (!pin || pin[1] !== snapshot.sourceRevision) throw Error('Browser snapshot must match the committed Wizard gitlink.');
  verifyCommitted(root, snapshot);
  const committed = systemInputs.map(name => {
    const entry = git('ls-tree', 'HEAD', name).toString().trim();
    if (!/^100(?:644|755) blob [a-f0-9]{40}\t/.test(entry)) throw Error('Browser build input must be a committed regular file: '+name);
    return {name, mode:entry.slice(0, 6), content:git('show', 'HEAD:'+name)};
  });
  for (const required of ['package.json', 'package-lock.json', 'playwright.config.ts']) {
    if (!snapshot.files.some(file => file.path === required)) throw Error('Incomplete Wizard browser inputs: '+required);
  }
  if (!snapshot.files.some(file => file.path.startsWith('tests/browser/'))) throw Error('Wizard browser suite is missing.');
  const output = path.join(root, '.wizard-browser-context');
  if (fs.existsSync(output) && (!fs.lstatSync(output).isDirectory() || fs.lstatSync(output).isSymbolicLink())) throw Error('Browser context output must be a real directory.');
  fs.mkdirSync(output, {recursive:true});
  const temporary = fs.mkdtempSync(path.join(output, '.prepare-'));
  try {
    const write = (name, content, mode) => {
      const filename = path.join(temporary, name);
      fs.mkdirSync(path.dirname(filename), {recursive:true});
      fs.writeFileSync(filename, content, {mode:mode === '100755' ? 0o755 : 0o644});
    };
    for (const file of committed) write(file.name, file.content, file.mode);
    for (const file of snapshot.files) write('wizard/'+file.path, Buffer.from(file.content, 'base64'), file.mode);
    const files = [...systemInputs, ...snapshot.files.map(file => 'wizard/'+file.path)].sort();
    const archive = path.join(temporary, 'context.tar');
    execFileSync('tar', ['-cf', archive, '-C', temporary, ...files]);
    const actual = execFileSync('tar', ['-tf', archive], {encoding:'utf8', maxBuffer:2*1024*1024}).split('\n').filter(Boolean).sort();
    if (JSON.stringify(actual) !== JSON.stringify(files)) throw Error('Browser archive differs from the explicit committed inputs.');
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    fs.writeFileSync(path.join(temporary, 'revision'), revision+'\n');
    fs.writeFileSync(path.join(temporary, 'sha256'), checksum+'\n');
    fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify({revision, wizardRevision:snapshot.sourceRevision, snapshotManifest:snapshot.manifestHash, checksum, files}, null, 2)+'\n');
    for (const name of ['context.tar', 'revision', 'sha256', 'manifest.json']) fs.renameSync(path.join(temporary, name), path.join(output, name));
    return {revision, wizardRevision:snapshot.sourceRevision, checksum, files};
  } finally { fs.rmSync(temporary, {recursive:true, force:true}); }
}
module.exports = {prepareWizardBrowser};
if (require.main === module) {
  try { const result = prepareWizardBrowser(path.resolve(__dirname, '..')); console.log('Prepared committed Wizard browser context: '+result.revision+' ('+result.files.length+' files)'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
