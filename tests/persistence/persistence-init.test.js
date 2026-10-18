'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {initializeState} = require('../../system/persistence-init');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-persistence-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const runtime = path.join(root, 'runtime');
  const state = path.join(root, 'state');
  fs.mkdirSync(runtime); fs.mkdirSync(state);
  return {runtime, state};
}

test('imports legacy configuration and receipts once and applies private modes', t => {
  const {runtime, state} = fixture(t);
  fs.writeFileSync(path.join(runtime, '.docker.env'), 'legacy');
  fs.mkdirSync(path.join(runtime, '.projects.env'));
  fs.writeFileSync(path.join(runtime, '.projects.env/.wizard.env'), 'receipt');
  initializeState(state, runtime);
  assert.equal(fs.readFileSync(path.join(state, '.docker.env'), 'utf8'), 'legacy');
  assert.equal(fs.readFileSync(path.join(runtime, '.projects.env/.wizard.env'), 'utf8'), 'receipt');
  assert.equal(fs.statSync(state).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(state, '.docker.env')).mode & 0o777, 0o600);
  initializeState(state, runtime);
});

test('saved volume configuration wins over a new container image', t => {
  const {runtime, state} = fixture(t);
  fs.writeFileSync(path.join(runtime, '.docker.env'), 'stale image');
  fs.writeFileSync(path.join(state, '.docker.env'), 'saved state');
  initializeState(state, runtime);
  assert.equal(fs.readFileSync(path.join(runtime, '.docker.env'), 'utf8'), 'saved state');
});

test('canonical reset and recreation survives controller replacement', t => {
  const {runtime, state} = fixture(t);
  initializeState(state, runtime);
  assert.equal(fs.lstatSync(path.join(runtime, '.docker.env')).isSymbolicLink(), true);
  fs.writeFileSync(path.join(state, '.docker.env'), 'one');
  fs.unlinkSync(path.join(state, '.docker.env'));
  initializeState(state, runtime);
  fs.writeFileSync(path.join(state, '.docker.env'), 'two');
  const freshRuntime = path.join(path.dirname(runtime), 'fresh');
  fs.mkdirSync(freshRuntime);
  fs.writeFileSync(path.join(freshRuntime, '.docker.env'), 'stale baked configuration');
  fs.unlinkSync(path.join(state, '.docker.env'));
  initializeState(state, freshRuntime);
  assert.equal(fs.existsSync(path.join(state, '.docker.env')), false);
  fs.writeFileSync(path.join(state, '.docker.env'), 'three');
  assert.equal(fs.readFileSync(path.join(freshRuntime, '.docker.env'), 'utf8'), 'three');
});

test('first-setup Sync authentication remains stable and private', t => {
  const {runtime, state} = fixture(t);
  initializeState(state, runtime);
  const file = path.join(state, 'sync-auth.env');
  const initial = fs.readFileSync(file, 'utf8');
  assert.match(initial, /^export SYNC_USER=bootstrapper_[a-f0-9]{16}\nexport SYNC_PASS=[A-Za-z0-9_-]{43}\n$/);
  initializeState(state, runtime);
  assert.equal(fs.readFileSync(file, 'utf8'), initial);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('atomic receipt replacement remains on the persistent directory', t => {
  const {runtime, state} = fixture(t);
  initializeState(state, runtime);
  const temporary = path.join(runtime, '.projects.env/.wizard.env.tmp');
  fs.writeFileSync(temporary, 'atomic receipt');
  fs.renameSync(temporary, path.join(runtime, '.projects.env/.wizard.env'));
  assert.equal(fs.readFileSync(path.join(state, '.projects.env/.wizard.env'), 'utf8'), 'atomic receipt');
});

test('rejects unexpected runtime and persistent configuration symlinks', t => {
  const {runtime, state} = fixture(t);
  fs.symlinkSync('/tmp/unrelated', path.join(runtime, '.docker.env'));
  assert.throws(() => initializeState(state, runtime), /Unexpected configuration link/);
  fs.unlinkSync(path.join(runtime, '.docker.env'));
  fs.symlinkSync('/tmp/unrelated', path.join(state, '.docker.env'));
  assert.throws(() => initializeState(state, runtime), /Unsafe configuration destination/);
});
