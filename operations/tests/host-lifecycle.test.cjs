const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HostLifecycleService } = require('../dist/host-lifecycle/lifecycle.service');
const { HostLifecycleModule } = require('../dist/host-lifecycle/host-lifecycle.module');
const { HostPersistenceService } = require('../dist/host-lifecycle/persistence.service');
const { NestFactory } = require('@nestjs/core');
function fixture(t, active = true, failure = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'system'));
  fs.writeFileSync(path.join(root, 'system/.docker.env'), 'export SELECTOR=fixture\n');
  const calls = [];
  const child = { async run(binary, args, options) {
    if (binary === 'bash') { calls.push([binary, args]); return 'SELECTOR=fixture\0'; }
    if (args.includes('ps')) { calls.push([binary, args]); return active ? 'owned-controller\n' : ''; }
    calls.push([binary, args, options]);
    if (failure) throw Error('stop failed');
    return '';
  }};
  const service = new HostLifecycleService({ prepare() { throw Error('stop must not initialize storage'); } }, child);
  return { root, calls, service };
}
test('host stop drains the running controller before Compose down and forwards cancellation', async t => {
  const f = fixture(t), signal = new AbortController().signal;
  await f.service.execute('stop', f.root, {}, signal);
  const writes = f.calls.filter(call => call[2]);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0][1].slice(-5), ['exec', '-T', 'bootstrapper', 'bash', '/system/system/stop.sh']);
  assert.equal(writes[1][1].at(-1), 'down');
  assert.equal(writes[0][2].signal, signal);
  assert.equal(writes[0][2].env.SELECTOR, 'fixture');
});
test('host stop preserves services after failed controller drain', async t => {
  const f = fixture(t, true, true);
  await assert.rejects(f.service.execute('stop', f.root, {}), /stop failed/);
  assert(!f.calls.some(call => call[1].at(-1) === 'down'));
});
test('host stop skips exec when controller is already stopped', async t => {
  const f = fixture(t, false);
  await f.service.execute('stop', f.root, {});
  assert.equal(f.calls.filter(call => call[2]).length, 1);
  assert.equal(f.calls.at(-1)[1].at(-1), 'down');
});
test('host lifecycle Nest context provides shared services without starting host work', async () => {
  const app = await NestFactory.createApplicationContext(HostLifecycleModule, { logger: false });
  try {
    assert(app.get(HostLifecycleService) instanceof HostLifecycleService);
    assert(app.get(HostPersistenceService) instanceof HostPersistenceService);
  } finally { await app.close(); }
});

test('configuration adapter separates diagnostics and cancels a stuck shell', async t => {
  const { readEnvironment } = require('../dist/host-lifecycle/lifecycle.service');
  const { ManagedChildProcess } = require('../dist/runtime/managed-child');
  const f = fixture(t), file = path.join(f.root, 'config');
  fs.writeFileSync(file, 'printf "Configuration loaded\\n"\nexport TEST_VALUE=kept\n');
  const env = await readEnvironment(new ManagedChildProcess(), [file], process.env, f.root);
  assert.equal(env.TEST_VALUE, 'kept');
  assert(!Object.keys(env).some(key => key.includes('Configuration loaded')));
  fs.writeFileSync(file, 'sleep 60\n');
  const abort = new AbortController();
  const started = Date.now();
  const waiting = readEnvironment(new ManagedChildProcess(), [file], process.env, f.root, abort.signal);
  setTimeout(() => abort.abort(), 40);
  await assert.rejects(waiting, /external-command-failed/);
  assert(Date.now() - started < 3000);
});
test('release fallback keeps empty build selector offline and rejects special file modes', t => {
  const { releaseFallback } = require('../dist/host-lifecycle/lifecycle.service');
  const f = fixture(t), file = path.join(f.root, 'release');
  fs.writeFileSync(file, 'BOOTSTRAPPER_IMAGE=docker.io/example/system@sha256:' + 'a'.repeat(64) + '\nWIZARD_IMAGE=docker.io/example/wizard@sha256:' + 'b'.repeat(64) + '\n', { mode: 0o600 });
  assert.equal(releaseFallback(file, { SYSTEM_BOOTSTRAPPER_SKIP_BUILD: '' }).SYSTEM_BOOTSTRAPPER_SKIP_BUILD, '1');
  fs.chmodSync(file, 0o4600);
  assert.throws(() => releaseFallback(file, {}), /Invalid private release/);
});
