const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const source = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-api-'));
fs.mkdirSync(path.join(root, 'sync'));
fs.mkdirSync(path.join(root, 'system/.projects.env'), {recursive: true});
process.chdir(path.join(root, 'sync'));
const syncRequire = name => require(require.resolve(name, {paths: [path.join(source, 'sync')]}));
const express = syncRequire('express');
const originalListen = express.application.listen;
let server;
express.application.listen = function (_, callback) { server = originalListen.call(this, 0, '127.0.0.1', callback); return server; };
const child = require('child_process');
child.execSync = child.execFile = child.spawn = () => { throw Error('API fixture forbids shell/container calls'); };
process.env.SYNC_USER = 'fixture'; process.env.SYNC_PASS = 'fixture-password';
const bootstrap = require(path.join(source, 'sync/dist/ProjectBootstrap'));
const {wizardConfiguration, wizardCi} = require(path.join(source, 'sync/dist/DefaultWizard'));
const repository = {id: 99, path: 'root/wizard', defaultBranch: 'main', systemProject: true,
  ciPath: '.system-bootstrapper/ci.yml', generatedCi: wizardCi()};
bootstrap.writeReceipt(path.join(root, 'system/.projects.env/.wizard.env'), wizardConfiguration({WIZARD_HOST: 'localhost'}),
  {operation: 'registration', namespaceId: 1, defaultProject: true, template: 'wizard', state: 'complete', repository});
let finish; let calls = 0;
bootstrap.rails = () => { calls++; return new Promise(resolve => { finish = () => resolve({importCommit: 'imported'}); }); };
const log = console.log; console.log = () => {}; // Existing startup logs include fixture credentials.
require(path.join(source, 'sync/dist/index'));
(async () => {
  while (!server.listening) await new Promise(resolve => setTimeout(resolve, 5));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (route, options) => fetch(base + route, options);
  assert.equal((await request('/projects/wizard/source')).status, 401);
  assert.equal((await request('/projects/wizard/source', {method: 'POST', headers: {Authorization: 'Bearer invalid'}})).status, 403);
  assert.equal(calls, 0);
  const login = await request('/login', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username: 'fixture', password: 'fixture-password'})});
  const headers = {Authorization: 'Bearer ' + (await login.json()).accessToken, 'Content-Type': 'application/json'};
  const preview = await (await request('/projects/wizard/source', {headers})).json();
  assert.equal(calls, 0, 'preview performed a mutation'); assert.equal(preview.repository.id, 99);
  assert.equal((await request('/projects/wizard/source', {method: 'POST', headers, body: JSON.stringify({manifestHash: 'stale'})})).status, 409);
  const start = await request('/projects/wizard/source', {method: 'POST', headers, body: JSON.stringify({manifestHash: preview.manifestHash})});
  assert.equal(start.status, 202); const job = await start.json(); assert.equal(job.state, 'running'); assert.equal(calls, 1);
  assert.equal((await request('/config/project', {method: 'POST', headers, body: '{}'})).status, 409);
  assert.equal((await request('/projects', {method: 'POST', headers, body: '{}'})).status, 409);
  assert.equal((await request('/command/restart', {method: 'PATCH', headers})).status, 409);
  finish();
  let result;
  do { result = await (await request('/projects/jobs/' + job.id, {headers})).json(); } while (result.state === 'running');
  assert.equal(result.workflow.phase, 'source-imported'); assert.equal(result.workflow.importCommit, 'imported');
  log('Wizard source API: authentication, read-only preview, manifest confirmation, job polling and configuration/command mutation guards passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  console.log = log; server.close(); process.chdir(source); fs.rmSync(root, {recursive: true, force: true});
});
