const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const source = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-environments-api-'));
fs.mkdirSync(path.join(root, 'sync')); fs.mkdirSync(path.join(root, 'system/.projects.env'), {recursive: true});
process.chdir(path.join(root, 'sync'));
const syncRequire = name => require(require.resolve(name, {paths: [path.join(source, 'sync')]}));
const express = syncRequire('express');
const listen = express.application.listen;
let server;
express.application.listen = function (_, callback) {server = listen.call(this, 0, '127.0.0.1', callback); return server;};
const child = require('child_process');
child.execSync = child.execFile = child.spawn = () => {throw Error('Environment API fixture forbids shell calls');};
process.env.SYNC_USER = 'fixture'; process.env.SYNC_PASS = 'fixture-password';
process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE = 'sha256:' + 'f'.repeat(64);
const bootstrap = require(path.join(source, 'sync/dist/ProjectBootstrap'));
const Helper = require(path.join(source, 'sync/dist/Helper')).default;
const {wizardConfiguration, wizardCi} = require(path.join(source, 'sync/dist/DefaultWizard'));
const env = require(path.join(source, 'sync/dist/WizardEnvironments'));
const legacy = require(path.join(source, 'project-bootstrap/wizard-build/recipe')).generate(Helper.textLogo);
const file = path.join(root, 'system/.projects.env/.wizard.env');
fs.writeFileSync(path.join(root, 'system/.docker.env'), Helper.textLogo + 'WIZARD_HOST="production.example"\nWIZARD_ENABLE="false"\nGITLAB_REGISTRY_URL="https://registry.example"\nGITLAB_REGISTRY_DOMAIN_MODE="2"\n');
bootstrap.writeReceipt(file, wizardConfiguration({WIZARD_HOST: 'production.example'}), {
  operation: 'registration', namespaceId: 1, defaultProject: true, template: 'wizard', state: 'complete',
  repository: {id: 99, path: 'root/wizard', defaultBranch: 'main', systemProject: true, ciPath: '.system-bootstrapper/ci.yml', generatedCi: wizardCi()},
  wizardWorkflow: {version: 1, operation: 'source', sourceRevision: 'c'.repeat(40), manifestHash: 'd'.repeat(64),
    importCommit: 'a'.repeat(40), phase: 'source-imported', build: {version: 1, operation: 'b'.repeat(48), recipeHash: legacy.recipeHash,
      phase: 'candidate-verified', activationCommit: 'b'.repeat(40), pipeline: {id: 8, sha: 'b'.repeat(40), status: 'success'},
      artifact: {imageRef: 'registry.example/root/wizard@sha256:' + 'e'.repeat(64), sourceCommit: 'b'.repeat(40), pipelineId: 8}}}
});
let calls = 0, input, finish, applied = 0;
env.environmentAdapters.recipe = (_, value) => ({version: 1, recipeHash: require('crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex'), ci: 'fixture CI', files: []});
env.environmentAdapters.resolve = async () => ['203.0.113.1'];
env.environmentAdapters.certificate = async () => {};
env.environmentAdapters.applyRoutes = async () => {applied++;};
bootstrap.rails = value => {calls++; input = value; return new Promise(resolve => {finish = resolve;});};
const log = console.log; console.log = () => {};
require(path.join(source, 'sync/dist/index'));
const tick = () => new Promise(resolve => setTimeout(resolve, 3));
(async () => {
  while (!server.listening) await tick();
  await tick();
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (route, options) => fetch(base + route, options);
  for (const route of ['/projects/wizard/environments', '/projects/wizard/environments/status']) assert.equal((await request(route)).status, 401);
  assert.equal((await request('/projects/wizard/environments', {method: 'POST'})).status, 401);
  assert.equal((await request('/projects/wizard/environments', {method: 'POST', headers: {Authorization: 'Bearer invalid'}})).status, 403);
  assert.equal(calls, 0);
  const login = await request('/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'fixture', password: 'fixture-password'})});
  const headers = {Authorization: 'Bearer ' + (await login.json()).accessToken, 'Content-Type': 'application/json'};
  const response = await request('/projects/wizard/environments', {headers}); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const preview = await response.json(); assert(preview.capabilities.canActivate);
  const idle = await request('/projects/wizard/environments/status', {headers}); assert.equal(idle.status, 200); assert.equal((await idle.json()).state, 'not-activated'); assert.equal(calls, 0);
  const settings = preview.settings; settings.review.enabled = true;
  settings.beta = {enabled: false, host: '', domainMode: 2, ssl: '', sslKey: ''};
  const post = body => request('/projects/wizard/environments', {method: 'POST', headers, body: JSON.stringify(body)});
  assert.equal((await post({previewHash: 'stale', settings})).status, 409);
  let release;
  const other = bootstrap.withProjectLock('other', () => bootstrap.startJob('other', () => new Promise(resolve => {release = resolve;})));
  assert.equal((await post({previewHash: preview.previewHash, settings})).status, 409);
  release({}); while (other.state === 'running') await tick();
  const started = await post({previewHash: preview.previewHash, settings}); assert.equal(started.status, 202);
  const job = await started.json(); while (calls < 1) await tick();
  assert.equal((await (await post({previewHash: preview.previewHash, settings})).json()).id, job.id);
  const running = await request('/projects/wizard/environments/status', {headers}); assert.equal(running.status, 202); assert.equal((await running.json()).id, job.id); assert.equal(calls, 1);
  for (const [route, method] of [['/projects','POST'],['/config/project','POST'],['/command/restart','PATCH']]) assert.equal((await request(route, {method, headers, body:'{}'})).status, 409);
  finish({environments: {...input.environments, phase: 'recipe-installed', activationCommit: '9'.repeat(40)}, message: 'No pipeline started'});
  const poll = async id => {let result; do {result = await (await request('/projects/jobs/' + id, {headers})).json(); await tick();} while(result.state === 'running'); return result;};
  const result = await poll(job.id); assert.equal(result.state, 'complete'); assert.equal(result.environments.phase, 'ready'); assert.equal(applied, 0); assert.equal(calls, 1);
  bootstrap.rails = async value => {calls++; assert.equal(value.action, 'wizard-environments-status'); return {environments: {...value.environments, phase: 'recipe-installed'}, message: 'Read-only status'};};
  const status = await request('/projects/wizard/environments/status', {headers}); assert.equal(status.status, 202); assert.equal((await poll((await status.json()).id)).environments.phase, 'ready'); assert.equal(applied, 0);
  const historical = await request('/projects/wizard/build/status', {headers}); const history = await historical.json(); assert.equal(history.state, 'historical'); assert.match(history.build.message, /historical/); assert.equal(calls, 2);
  log('Wizard environments API: authentication, read-only preview, explicit confirmation, own-operation deduplication, mutation exclusion and safe status passed.');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {console.log = log; server.close(); process.chdir(source); fs.rmSync(root, {recursive: true, force: true});});

