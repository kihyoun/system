const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const source = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-build-api-'));
fs.mkdirSync(path.join(root, 'sync'));
fs.mkdirSync(path.join(root, 'system/.projects.env'), {recursive: true});
process.chdir(path.join(root, 'sync'));
const syncRequire = name => require(require.resolve(name, {paths: [path.join(source, 'sync')]}));
const express = syncRequire('express');
const originalListen = express.application.listen;
let server;
express.application.listen = function (_, callback) { server = originalListen.call(this, 0, '127.0.0.1', callback); return server; };
const child = require('child_process');
child.execSync = child.execFile = child.spawn = () => { throw Error('Build API fixture forbids shell/container calls'); };
process.env.SYNC_USER = 'fixture'; process.env.SYNC_PASS = 'fixture-password';
const bootstrap = require(path.join(source, 'sync/dist/ProjectBootstrap'));
const Helper = require(path.join(source, 'sync/dist/Helper')).default;
const {wizardConfiguration, wizardCi} = require(path.join(source, 'sync/dist/DefaultWizard'));
const file = path.join(root, 'system/.projects.env/.wizard.env');
fs.writeFileSync(path.join(root, 'system/.docker.env'), Helper.textLogo + 'GITLAB_REGISTRY_URL=http://registry.localhost:5050\n');
bootstrap.writeReceipt(file, wizardConfiguration({WIZARD_HOST: 'localhost'}), {
  operation: 'registration', namespaceId: 1, defaultProject: true, template: 'wizard', state: 'complete',
  repository: {id: 99, path: 'root/wizard', defaultBranch: 'main', systemProject: true,
    ciPath: '.system-bootstrapper/ci.yml', generatedCi: wizardCi()},
  wizardWorkflow: {version: 1, operation: 'source-operation', sourceRevision: 'c'.repeat(40), manifestHash: 'd'.repeat(64),
    importCommit: 'a'.repeat(40), phase: 'source-imported'}
});
let calls = 0, finish, input;
bootstrap.rails = value => { calls++; input = value; return new Promise(resolve => { finish = resolve; }); };
const log = console.log; console.log = () => {};
require(path.join(source, 'sync/dist/index'));
const wait = async job => { while (job.state === 'running') await new Promise(resolve => setTimeout(resolve, 5)); };
(async () => {
  while (!server.listening) await new Promise(resolve => setTimeout(resolve, 5));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (route, options) => fetch(base + route, options);
  for (const route of ['/projects/wizard/build', '/projects/wizard/build/status']) assert.equal((await request(route)).status, 401);
  assert.equal((await request('/projects/wizard/build', {method: 'POST', headers: {Authorization: 'Bearer invalid'}})).status, 403);
  assert.equal(calls, 0);
  const login = await request('/login', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username: 'fixture', password: 'fixture-password'})});
  const headers = {Authorization: 'Bearer ' + (await login.json()).accessToken, 'Content-Type': 'application/json'};
  const previewResponse = await request('/projects/wizard/build', {headers});
  assert.equal(previewResponse.status, 200); assert.equal(previewResponse.headers.get('cache-control'), 'no-store');
  const preview = await previewResponse.json(); assert.equal(preview.importCommit, 'a'.repeat(40));
  assert.equal(calls, 0, 'preview must not activate or query GitLab');
  const idle = await request('/projects/wizard/build/status', {headers});
  assert.equal(idle.status, 200); assert.equal((await idle.json()).state, 'not-activated');
  assert.equal((await request('/projects/wizard/build', {method: 'POST', headers, body: JSON.stringify({recipeHash: 'stale'})})).status, 409);
  assert.equal(calls, 0);
  let release;
  const other = bootstrap.withProjectLock('other-project', () => bootstrap.startJob('other-project',
    () => new Promise(resolve => { release = () => resolve({}); })));
  const activate = () => request('/projects/wizard/build', {method: 'POST', headers,
    body: JSON.stringify({recipeHash: preview.recipeHash})});
  assert.equal((await activate()).status, 409, 'another project owns the mutation lock');
  release(); await wait(other);
  const started = await activate(); assert.equal(started.status, 202); const job = await started.json();
  assert.equal(job.state, 'running'); assert.equal(calls, 1); assert.equal(input.action, 'wizard-build');
  assert.equal((await (await activate()).json()).id, job.id, 'own running activation deduplicates');
  const activeStatus = await request('/projects/wizard/build/status', {headers});
  assert.equal(activeStatus.status, 202); assert.equal((await activeStatus.json()).id, job.id); assert.equal(calls, 1);
  assert.equal((await request('/config/project', {method: 'POST', headers, body: '{}'})).status, 409);
  assert.equal((await request('/projects', {method: 'POST', headers, body: '{}'})).status, 409);
  assert.equal((await request('/command/restart', {method: 'PATCH', headers})).status, 409);
  finish({build: {...input.build, phase: 'requires-reconciliation', activationCommit: 'b'.repeat(40)}, message: 'Inspect the recorded pipeline intent.'});
  const poll = async id => {
    let result;
    do { result = await (await request('/projects/jobs/' + id, {headers})).json(); } while (result.state === 'running');
    return result;
  };
  const result = await poll(job.id); assert.equal(result.build.phase, 'requires-reconciliation');
  assert.equal(result.message, 'Inspect the recorded pipeline intent.');
  const operation = result.build.operation;
  bootstrap.rails = async value => { assert.equal(value.action, 'wizard-build-status'); throw Error('Fixture verification failure'); };
  const refresh = await request('/projects/wizard/build/status', {headers}); assert.equal(refresh.status, 202);
  const failed = await poll((await refresh.json()).id); assert.equal(failed.state, 'failed');
  const failedPreview = await (await request('/projects/wizard/build', {headers})).json();
  assert.equal(failedPreview.build.phase, 'verification-failed'); assert.equal(failedPreview.build.operation, operation);
  assert.equal(failedPreview.build.artifact, undefined);
  const saved = fs.readFileSync(file, 'utf8');
  assert.equal(bootstrap.readReceipt(saved).wizardWorkflow.phase, 'source-imported');
  assert.equal(saved[807], '$');
  assert.equal(crypto.createHash('md5').update(saved.slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
  log('Wizard build API: authentication, read-only preview, explicit recipe confirmation, own-job deduplication, global mutation lock and honest failure status passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  console.log = log; server.close(); process.chdir(source); fs.rmSync(root, {recursive: true, force: true});
});
