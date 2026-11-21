'use strict';
// Exercise the real Nest container without a listener, GitLab or native commands.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const child = require('node:child_process');
const source = path.resolve(__dirname, '../../dist/api');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-nest-'));
const previous = {...process.env};
process.env.SYSTEM_CONFIG_DIR = root;
process.env.SYNC_USER = 'nest-fixture';
process.env.SYNC_PASS = 'fixture-password';
const originals = {listen: net.Server.prototype.listen, log: console.log, error: console.error};
const commands = ['exec', 'execFile', 'execSync', 'execFileSync', 'spawn', 'spawnSync'];
for (const name of commands) { originals[name] = child[name]; child[name] = () => { throw Error('Native commands are forbidden in Nest initialization.'); }; }
net.Server.prototype.listen = () => { throw Error('Import, creation and initialization must not open a listener.'); };
const wizard = require(path.join(source, 'projects/default-wizard'));
const ensureDefaultWizard = wizard.ensureDefaultWizard;
let registrations = 0, complete;
wizard.ensureDefaultWizard = () => {
  registrations++;
  return new Promise(resolve => { complete = resolve; });
};
console.log = console.error = () => {};
const applications = [];
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  // Requiring the executable entry must be safe for embedding and test setup.
  const {createSyncApplication} = require(path.join(source, 'index'));
  assert.equal(typeof createSyncApplication, 'function');
  const modules = [['auth', 'auth'], ['configuration', 'config'], ['projects', 'projects'],
    ['operations', 'operations'], ['diagnostics', 'diagnostics'], ['runtime', 'runtime']];
  for (let generation = 0; generation < 2; generation++) {
    const application = await createSyncApplication(); applications.push(application);
    await application.init();
    assert.equal(application.getHttpServer().listening, false);
    for (const [name, directory] of modules) {
      const title = name[0].toUpperCase() + name.slice(1);
      const Module = require(path.join(source, directory, name + '.module'))[title + 'Module'];
      const Service = require(path.join(source, directory, name + '.service'))[title + 'Service'];
      const provider = application.select(Module).get(Service, {strict: true});
      assert(provider instanceof Service, name + ' must be constructed by its native Nest module');
      assert.equal(application.get(Service), provider, name + ' must resolve the same application-scoped provider');
      if (name !== 'runtime') {
        const Controller = require(path.join(source, directory, name + '.controller'))[title + 'Controller'];
        assert(application.select(Module).get(Controller, {strict: true}) instanceof Controller,
          name + ' routes must belong to a native Nest controller');
      }
    }
  }
  assert.equal(registrations, 0, 'Default Wizard registration must wait until the management listener is available');
  const {AuthService} = require(path.join(source, 'auth/auth.service'));
  const {JwtAuthGuard} = require(path.join(source, 'auth/jwt-auth.guard'));
  const {RuntimeService} = require(path.join(source, 'runtime/runtime.service'));
  const [first, second] = applications;
  const tokens = first.get(AuthService).login({username: 'nest-fixture', password: 'fixture-password'});
  const request = {headers: {authorization: 'Bearer ' + tokens.accessToken}};
  assert.equal(first.get(JwtAuthGuard).canActivate({switchToHttp: () => ({getRequest: () => request})}), true);
  assert.equal(request.user.username, 'nest-fixture', 'the native guard must receive the application AuthService');
  assert.throws(() => second.get(AuthService).authenticate(request.headers.authorization), 'a new application must have fresh JWT secrets');
  assert.throws(() => second.get(AuthService).refresh({token: tokens.refreshToken}), 'refresh sessions must belong to one application lifetime');
  const runtime = first.get(RuntimeService);
  runtime.status.harvestInProgress = true;
  assert.equal(runtime.operationBusy(), true);
  assert.equal(second.get(RuntimeService).operationBusy(), false, 'operation state must not leak into another application');
  runtime.status.harvestInProgress = false;
  runtime.startDefaultWizard(); runtime.startDefaultWizard();
  assert.equal(registrations, 1, 'startup registration must be idempotent');
  assert.equal(runtime.snapshot().defaultWizardSetupInProgress, true);
  complete({state: 'disabled'}); await tick();
  assert.equal(runtime.snapshot().defaultWizardSetupInProgress, false);
  assert.equal(runtime.snapshot().defaultWizardProject.state, 'disabled');
  originals.log('PASS: native Nest modules, guard injection, application-scoped authentication/status, deferred startup and clean no-listener lifecycle.');
})().catch(error => { originals.error(error); process.exitCode = 1; }).finally(async () => {
  try { for (const application of applications.reverse()) await application.close(); }
  finally {
    wizard.ensureDefaultWizard = ensureDefaultWizard;
    net.Server.prototype.listen = originals.listen;
    for (const name of commands) child[name] = originals[name];
    console.log = originals.log; console.error = originals.error;
    for (const name of ['SYSTEM_CONFIG_DIR', 'SYNC_USER', 'SYNC_PASS']) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
    fs.rmSync(root, {recursive: true, force: true});
  }
});
