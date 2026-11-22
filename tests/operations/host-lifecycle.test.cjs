const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HostLifecycleService } = require('../../dist/modules/host-lifecycle/lifecycle.service');
const { HostLifecycleModule } = require('../../dist/modules/host-lifecycle/hostLifecycle.module');
const { HostPersistenceService } = require('../../dist/modules/host-lifecycle/persistence.service');
const { NestFactory } = require('@nestjs/core');
function fixture(t, active = true, failure = false, runtime = {version: '2.0.0', cli: true}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configurationDirectory = runtime.version.startsWith('1.') ? 'system' : 'config/system';
  fs.mkdirSync(path.join(root, configurationDirectory),{recursive:true});
  fs.writeFileSync(path.join(root,'VERSION'),runtime.version+'\n');
  fs.writeFileSync(path.join(root, configurationDirectory, '.docker.env'), 'export SELECTOR=fixture\n');
  const calls = [];
  const child = { async run(binary, args, options) {
    if (binary === 'bash') { calls.push([binary, args]); return 'SELECTOR=fixture\0'; }
    if (args.includes('ps')) { calls.push([binary, args]); return active ? 'owned-controller\n' : ''; }
    if (args.includes('-e')) { calls.push([binary, args]); return JSON.stringify(runtime); }
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
  assert.deepEqual(writes[0][1].slice(-5), ['node', '/system/dist/cli/main.js', 'lifecycle', 'stop', '/system']);
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

test('configuration adapter accepts data and refuses execution or cancelled work', async t => {
  const { readEnvironment } = require('../../dist/modules/host-lifecycle/lifecycle.service');
  const f = fixture(t), file = path.join(f.root, 'configuration.env');
  const runner = {run(){assert.fail('configuration must not spawn a process');}};
  fs.writeFileSync(file, 'export TEST_VALUE=kept\n');
  assert.equal((await readEnvironment(runner, [file], {}, f.root)).TEST_VALUE, 'kept');
  fs.writeFileSync(file, 'sleep 60\n');
  await assert.rejects(readEnvironment(runner, [file], {}, f.root), /assignment-required/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(readEnvironment(runner, [file], {}, f.root, abort.signal), /external-command-failed/);
});
test('release fallback keeps empty build selector offline and rejects special file modes', t => {
  const { releaseFallback } = require('../../dist/modules/host-lifecycle/lifecycle.service');
  const f = fixture(t), file = path.join(f.root, 'release');
  fs.writeFileSync(file, 'BOOTSTRAPPER_IMAGE=docker.io/example/system@sha256:' + 'a'.repeat(64) + '\nWIZARD_IMAGE=docker.io/example/wizard@sha256:' + 'b'.repeat(64) + '\n', { mode: 0o600 });
  assert.equal(releaseFallback(file, { SYSTEM_BOOTSTRAPPER_SKIP_BUILD: '' }).SYSTEM_BOOTSTRAPPER_SKIP_BUILD, '1');
  fs.chmodSync(file, 0o4600);
  assert.throws(() => releaseFallback(file, {}), /invalid-private-release/);
});

test('only immutable pre-Nest releases may use the historical stop entry', async t => {
  const old = fixture(t, true, false, {version:'1.2.0', cli:false});
  await old.service.execute('stop', old.root, {});
  assert(old.calls.some(c=>c[1].includes('/system/system/stop.sh')));
  const broken = fixture(t, true, false, {version:'2.0.0', cli:false});
  await assert.rejects(broken.service.execute('stop', broken.root, {}), /controller-lifecycle-cli-missing/);
  assert(!broken.calls.some(c=>c[1].at(-1)==='down'));
});
test('explicit developer build prepares source through CLI before Compose build', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-source-build-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'VERSION'),'2.0.0\n');
  const data=path.join(root,'data');
  fs.mkdirSync(path.join(data,'configuration'),{recursive:true});
  fs.writeFileSync(path.join(data,'configuration/.docker.env'),'');
  const calls=[];
  const env={PERSISTENT_DIR:data,PERSISTENCE_MODE:'local',PERSISTENT_MOUNT:'/',SEED_DIR:path.join(root,'seed'),SYSTEM_BOOTSTRAPPER_SKIP_BUILD:'0'};
  const processPort={async run(binary,args){calls.push({binary,args});return binary==='bash'?Object.entries(env).map(([k,v])=>k+'='+v).join('\0')+'\0':'';}};
  const service=new HostLifecycleService({async prepare(value){return value;}},processPort);
  await service.execute('start',root,env);
  const prepare=calls.findIndex(c=>c.args[0]?.endsWith('/dist/cli/main.js')&&c.args[1]==='source-prepare');
  const build=calls.findIndex(c=>c.args.includes('--build'));
  assert(prepare>=0&&build>prepare);
  assert.equal(calls[prepare].binary,process.execPath);
  assert.deepEqual(calls[prepare].args.slice(1),['source-prepare',root]);
  assert.equal(calls[build].binary,'docker');
  assert(calls[build].args.includes('compose'));
});
