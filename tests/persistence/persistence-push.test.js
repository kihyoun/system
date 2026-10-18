'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');

const script = path.resolve(__dirname, '../../system/push.sh');
// Small stored ZIP fixtures keep this acceptance test independent of Python or
// a zip writer package. Production unzip and rsync execute without stubs.
function zip(entries) {
  const chunks = [], directory = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(contents);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    chunks.push(local, filename, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10); end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}

function fixture(t, entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-push-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const runtime = path.join(root, 'runtime'), state = path.join(root, 'state');
  fs.mkdirSync(runtime); fs.mkdirSync(state);
  fs.mkdirSync(path.join(state, '.projects.env'));
  fs.symlinkSync(path.join(state, '.docker.env'), path.join(runtime, '.docker.env'));
  fs.symlinkSync(path.join(state, '.projects.env'), path.join(runtime, '.projects.env'));
  if (entries) fs.writeFileSync(path.join(root, 'bootstrapper.zip'), zip(entries));
  const run = (extraEnv = {}) => spawnSync('bash', [script], {
    cwd: runtime, encoding: 'utf8', env: {...process.env, SYSTEM_CONFIG_DIR: state, ...extraEnv}
  });
  return {root, runtime, state, run};
}

test('ZIP Push recreates a reset main file through canonical state and keeps runtime link', t => {
  const {runtime, state, run} = fixture(t, {'.docker.env': 'export SETTING=restored\n'});
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(state, '.docker.env'), 'utf8'), 'export SETTING=restored\n');
  assert.equal(fs.lstatSync(path.join(runtime, '.docker.env')).isSymbolicLink(), true);
  assert.equal(fs.statSync(path.join(state, '.docker.env')).mode & 0o777, 0o600);
});

test('archive replaces ordinary projects and preserves owned Wizard receipt', t => {
  const {state, run} = fixture(t, {
    '.docker.env': 'main', '.projects.env/.app.env': 'new project', '.projects.env/.wizard.env': 'archive wizard'
  });
  const owned = '# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify({defaultProject: true, template: 'wizard'})).toString('base64') + '\n';
  fs.writeFileSync(path.join(state, '.projects.env/.wizard.env'), owned);
  fs.writeFileSync(path.join(state, '.projects.env/.old.env'), 'old project');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(state, '.projects.env/.wizard.env'), 'utf8'), owned);
  assert.equal(fs.readFileSync(path.join(state, '.projects.env/.app.env'), 'utf8'), 'new project');
  assert.equal(fs.existsSync(path.join(state, '.projects.env/.old.env')), false);
});

test('corrupt archives fail without reporting success or modifying saved configuration', t => {
  const {root, state, run} = fixture(t);
  fs.writeFileSync(path.join(root, 'bootstrapper.zip'), 'corrupt');
  fs.writeFileSync(path.join(state, '.docker.env'), 'original');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Ready\./);
  assert.equal(fs.readFileSync(path.join(state, '.docker.env'), 'utf8'), 'original');
});

test('failed project copy propagates failure and restores owned Wizard receipt', t => {
  const {root, state, run} = fixture(t, {'.projects.env/.app.env': 'new'});
  const owned = '# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify({defaultProject: true, template: 'wizard'})).toString('base64') + '\n';
  fs.writeFileSync(path.join(state, '.projects.env/.wizard.env'), owned);
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const rsync = path.join(bin, 'rsync');
  fs.writeFileSync(rsync, '#!/bin/sh\nrm -f "$SYSTEM_CONFIG_DIR/.projects.env/.wizard.env"\nexit 23\n', {mode: 0o755});
  const result = run({PATH: bin + ':' + process.env.PATH});
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Ready\./);
  assert.equal(fs.readFileSync(path.join(state, '.projects.env/.wizard.env'), 'utf8'), owned);
});

test('failed main copy does not report success or replace the saved file', t => {
  const {root, state, run} = fixture(t, {'.docker.env': 'replacement'});
  fs.writeFileSync(path.join(state, '.docker.env'), 'original');
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cp'), '#!/bin/sh\nexit 17\n', {mode: 0o755});
  const result = run({PATH: bin + ':' + process.env.PATH});
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Ready\./);
  assert.equal(fs.readFileSync(path.join(state, '.docker.env'), 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(state).filter(name => name.startsWith('.push-config.')), []);
});
