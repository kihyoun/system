'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {validate} = require('../../project-bootstrap/wizard-source/package');
const root = path.resolve(__dirname, '../..');
const cataloguePath = 'src/i18n/nativeOperationMessages.ts';
const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 2 && args[0] === '--catalog', 'Use no arguments for the pinned snapshot, or --catalog FILE for an explicit local source check.');
const contents = args.length ? fs.readFileSync(path.resolve(args[1]), 'utf8') : (() => {
  const snapshot = validate(JSON.parse(fs.readFileSync(path.join(root, 'project-bootstrap/wizard-source/snapshot.json'), 'utf8')));
  const file = snapshot.files.find(file => file.path === cataloguePath);
  assert(file, 'The pinned Wizard snapshot must contain the actual native operation message catalogue.');
  return Buffer.from(file.content, 'base64').toString('utf8');
})();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-locale-messages-'));
try {
  const file = path.join(directory, 'nativeOperationMessages.mts');
  fs.writeFileSync(file, contents);
  const {nativeOperationGerman, nativeOperationKorean} = require(file);
  const messagesIn = filename => {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    // Fixed public sentences, extracted from native producers rather than copied
    // fixture keys. Dynamic diagnostics and operator values are not translated.
    return [...source.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map(match => match[1])
      .filter(value => /^[A-Z]/.test(value) && value.includes(' ') && value.endsWith('.'));
  };
  const messages = new Set();
  for (const filename of [
    'sync/src/PreviewSetup.ts',
    'project-bootstrap/preview-setup/settings.js',
    'project-bootstrap/preview-setup/source.js',
    'project-bootstrap/preview-setup/provision.rb',
    'project-bootstrap/preview-setup/producers.js',
    'project-bootstrap/wizard-source-primary/run.js',
    'project-bootstrap/wizard-source-primary/binding.js',
    'sync/src/WizardEnvironments.ts'
  ]) {
    const extracted = messagesIn(filename);
    assert(extracted.length >= 2, 'No native public messages extracted from ' + filename);
    for (const message of extracted) messages.add(message);
  }
  const api = messagesIn('sync/src/index.ts');
  for (const prefix of ['A GitLab upgrade is in progress.', 'A backup or recovery operation is in progress.',
    'Wait for the current platform operation to finish.', 'Development preview setup status is unavailable.']) {
    const message = api.find(value => value.startsWith(prefix));
    assert(message, 'Native API fixture disappeared: ' + prefix);
    messages.add(message);
  }
  const environments = fs.readFileSync(path.join(root, 'sync/src/WizardEnvironments.ts'), 'utf8');
  const dynamic = /throw new Error\('([^'\n]+)' \+ name \+ '([^'\n]+)'\)/.exec(environments);
  assert(dynamic, 'Native exact-host certificate diagnostic changed.');
  for (const name of ['review', 'beta']) messages.add(dynamic[1] + name + dynamic[2]);
  for (const message of messages) {
    assert(nativeOperationGerman[message] && nativeOperationGerman[message] !== message, 'Missing German native message: ' + message);
    assert(nativeOperationKorean[message] && /[가-힣]/.test(nativeOperationKorean[message]), 'Missing Korean native message: ' + message);
  }
  assert.deepEqual(Object.keys(nativeOperationGerman).sort(), Object.keys(nativeOperationKorean).sort());
  console.log('PASS native preview public messages from actual Sync/Ruby producers and the Wizard catalogue: ' + messages.size + ' messages.');
} finally { fs.rmSync(directory, {recursive: true, force: true}); }
