'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {test} = require('node:test');
const installation = require('../../project-bootstrap/wizard-source-primary/source-installation');
const {parse} = require('../../bootstrapper/record-source-installation');
const {Adoption} = require('../../project-bootstrap/wizard-source-primary/run');
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const cube = fs.readFileSync(path.join(__dirname, '../../system/.docker.env.example'), 'utf8').slice(0, 1184);
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'source-installation-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const expected = {controller: 'sha256:' + 'a'.repeat(64), wizard: 'sha256:' + 'b'.repeat(64),
    sourceCommit: 'c'.repeat(40), sourceTree: 'd'.repeat(40), wizardSourceRevision: 'e'.repeat(40)};
  const mainConfig = path.join(directory, '.docker.env'), filename = path.join(directory, installation.FILE);
  const main = cube + '\nexport BOOTSTRAPPER_IMAGE=' + expected.controller + '\nexport WIZARD_IMAGE=' + expected.wizard + '\n';
  fs.writeFileSync(mainConfig, main, {mode: 0o600});
  const files = ['package.json', 'src/api/Helper.tsx', '.gitlab-ci.yml'].map(name => ({path: name, mode: '100644',
    sha256: sha256('fixture\n'), content: Buffer.from('fixture\n').toString('base64')}));
  const manifest = {version: 1, sourceRevision: expected.wizardSourceRevision,
    files: files.map(({path, mode, sha256}) => ({path, mode, sha256}))};
  const snapshotFile = path.join(directory, 'snapshot.json');
  fs.writeFileSync(snapshotFile, JSON.stringify({...manifest, manifestHash: sha256(JSON.stringify(manifest)), files}));
  const images = {}, containers = {}, calls = [];
  for (const role of ['controller', 'wizard']) {
    images[expected[role]] = {Id: expected[role], Os: 'linux', Architecture: 'amd64', Config: {Labels: {
      'org.opencontainers.image.revision': role === 'controller' ? expected.sourceCommit : expected.wizardSourceRevision,
      'org.system-bootstrapper.source-revision': expected.sourceCommit,
      'org.system-bootstrapper.source-tree': expected.sourceTree, 'org.system-bootstrapper.test-job': '81'}}};
    const name = role === 'controller' ? 'system_bootstrapper_1' : 'system_wizard_1';
    containers[name] = {Name: '/' + name, Image: expected[role], State: {Running: true}};
  }
  const inspect = args => {
    calls.push(args); assert.equal(args[1], 'inspect');
    assert(['image', 'container'].includes(args[0]));
    const row = (args[0] === 'image' ? images : containers)[args[2]];
    assert(row, 'Only exact selected images and canonical containers may be inspected.'); return clone(row);
  };
  return {directory, expected, mainConfig, main, filename, snapshotFile, images, containers, calls,
    options: {mainConfig, snapshotFile, inspect}};
}
test('source installation records actual paired bytes and provenance without claiming accepted release or changing Production', t => {
  const f = fixture(t), record = installation.recordInstallation(f.expected, f.options);
  assert.equal(record.format, 'system-source-installation-v1');
  assert.equal(record.sourceTree, f.expected.sourceTree);
  assert.equal(record.images.wizard.imageId, f.expected.wizard);
  assert.equal(record.images.controller.candidateJobId, record.images.wizard.candidateJobId);
  assert.equal(installation.sourceInstallation(f.main, f.options), f.expected.wizard);
  assert.equal(fs.readFileSync(f.mainConfig, 'utf8'), f.main);
  assert.equal(fs.statSync(f.filename).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.filename).uid, 0);
  for (const name of ['.release-images.json', '.release-images.env']) assert(!fs.existsSync(path.join(f.directory, name)));
  assert(!Object.hasOwn(record, 'productRelease')); assert(!Object.hasOwn(record, 'acceptance'));
  const bytes = fs.readFileSync(f.filename, 'utf8');
  assert.deepEqual(installation.recordInstallation(f.expected, f.options), record);
  assert.equal(fs.readFileSync(f.filename, 'utf8'), bytes, 'Repeat recording must retain the existing provenance record.');
  const adoption = new Adoption({mainConfig: f.mainConfig, request: async () => undefined});
  assert.throws(() => adoption.publicRelease(f.main), /accepted public release/, 'Source provenance must never satisfy public release acceptance.');
});
test('fresh runtime inspection rejects switched or stopped Production and mismatched source/tree/gitlink/job labels', t => {
  for (const change of [
    f => {f.containers.system_wizard_1.Image = f.expected.controller;},
    f => {f.containers.system_bootstrapper_1.Image = f.expected.wizard;},
    f => {f.containers.system_wizard_1.State.Running = false;},
    f => {f.containers.system_wizard_1.Name = '/unrelated';},
    f => {f.images[f.expected.wizard].Config.Labels['org.opencontainers.image.revision'] = '0'.repeat(40);},
    f => {f.images[f.expected.controller].Config.Labels['org.opencontainers.image.revision'] = '0'.repeat(40);},
    f => {f.images[f.expected.wizard].Config.Labels['org.system-bootstrapper.source-revision'] = '0'.repeat(40);},
    f => {f.images[f.expected.controller].Config.Labels['org.system-bootstrapper.source-tree'] = '0'.repeat(40);},
    f => {f.images[f.expected.wizard].Config.Labels['org.system-bootstrapper.source-tree'] = '0'.repeat(40);},
    f => {f.images[f.expected.wizard].Config.Labels['org.system-bootstrapper.test-job'] = '82';},
    f => {f.images[f.expected.controller].Id = f.expected.wizard;},
    f => {f.images[f.expected.wizard].Architecture = 'arm64';},
    f => {f.images[f.expected.wizard].Os = 'windows';},
  ]) {
    const f = fixture(t); installation.recordInstallation(f.expected, f.options); change(f);
    assert.throws(() => installation.sourceInstallation(f.main, f.options), /exact running source installation/);
    assert.throws(() => installation.recordInstallation(f.expected, f.options));
    assert.equal(fs.readFileSync(f.mainConfig, 'utf8'), f.main);
  }
});
test('recording requires independent immutable selections, matching packaged Wizard and a same-job pair before writes', t => {
  for (const change of [
    f => {f.expected.controller = 'controller:latest';},
    f => {f.expected.sourceTree = '0'.repeat(40);},
    f => {f.expected.wizardSourceRevision = '0'.repeat(40);},
    f => {f.images[f.expected.wizard].Config.Labels['org.system-bootstrapper.test-job'] = '82';},
    f => {f.images[f.expected.wizard].Config.Labels['org.system-bootstrapper.test-job'] = '9007199254740992';},
    f => {f.images[f.expected.wizard].Config.Labels['org.system-bootstrapper.test-job'] = '081';},
    f => {fs.writeFileSync(f.mainConfig, f.main.replace(f.expected.wizard, 'wizard:latest'));},
    f => {const value = JSON.parse(fs.readFileSync(f.snapshotFile)); value.sourceRevision = '0'.repeat(40); fs.writeFileSync(f.snapshotFile, JSON.stringify(value));},
  ]) {
    const f = fixture(t); change(f);
    assert.throws(() => installation.recordInstallation(f.expected, f.options));
    assert(!fs.existsSync(f.filename));
  }
});
test('retained provenance is private, bounded, regular and cannot acquire acceptance claims', t => {
  for (const change of [
    f => fs.chmodSync(f.filename, 0o644),
    f => fs.chownSync(f.filename, 65534, 65534),
    f => {fs.renameSync(f.filename, f.filename + '.target'); fs.symlinkSync(f.filename + '.target', f.filename);},
    f => fs.writeFileSync(f.filename, ' '.repeat(1048577)),
    f => {const value = JSON.parse(fs.readFileSync(f.filename)); value.productRelease = {tag: 'v1.0.0'}; fs.writeFileSync(f.filename, JSON.stringify(value));},
    f => {const value = JSON.parse(fs.readFileSync(f.filename)); value.acceptance = {requiredChecksPassed: true}; fs.writeFileSync(f.filename, JSON.stringify(value));},
    f => {const value = JSON.parse(fs.readFileSync(f.filename)); value.images.controller.candidateJobId++; fs.writeFileSync(f.filename, JSON.stringify(value));},
    f => {const value = JSON.parse(fs.readFileSync(f.filename)); value.images.wizard.reference = 'wizard:latest'; fs.writeFileSync(f.filename, JSON.stringify(value));},
  ]) {
    const f = fixture(t); installation.recordInstallation(f.expected, f.options); change(f);
    assert.throws(() => installation.sourceInstallation(f.main, f.options));
    assert.throws(() => installation.recordInstallation(f.expected, f.options));
  }
});
test('host entrypoint requires every explicit source and image selection exactly once', () => {
  const args = ['--controller', 'sha256:' + 'a'.repeat(64), '--wizard', 'sha256:' + 'b'.repeat(64),
    '--source-revision', 'c'.repeat(40), '--source-tree', 'd'.repeat(40), '--wizard-revision', 'e'.repeat(40)];
  assert.deepEqual(parse(args), {controller: args[1], wizard: args[3], sourceCommit: args[5], sourceTree: args[7], wizardSourceRevision: args[9]});
  for (const bad of [[], args.slice(0, -1), [...args, '--controller', args[1]], [...args, '--accepted-release', 'true']]) assert.throws(() => parse(bad));
});
