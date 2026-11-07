'use strict';
// Real authenticated routes and filesystem state; all service transports are forbidden.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const source = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-alias-api-'));
fs.mkdirSync(path.join(root, 'sync'));
fs.mkdirSync(path.join(root, 'system/.projects.env'), {recursive: true});
process.chdir(path.join(root, 'sync'));
const express = require(require.resolve('express', {paths: [path.join(source, 'sync')]}));
const listen = express.application.listen;
let server;
express.application.listen = function (_, callback) { server = listen.call(this, 0, '127.0.0.1', callback); return server; };
let transports = 0;
const child = require('node:child_process');
child.execSync = child.execFile = child.spawn = () => { transports++; throw Error('Alias rejection must not start service work.'); };
process.env.SYNC_USER = 'fixture'; process.env.SYNC_PASS = 'fixture-password';
delete process.env.SYSTEM_CONFIG_DIR;
const log = console.log; console.log = () => {};
const cube = fs.readFileSync(path.join(source, 'system/.docker.env.example'), 'utf8').slice(0, 1184);
const main = cube + '\nWIZARD_ENABLE="true"\nWIZARD_HOST="wizard.example.test"\nWIZARD_DOMAIN_MODE="2"\n' +
  'WIZARD_SSL="/ssl/example/cert.pem"\nWIZARD_SSL_KEY="/ssl/example/key.pem"\n' +
  'WIZARD_ALIASES="example.test"\nGITLAB_HOST="gitlab.example.test"\nGITLAB_DOMAIN_MODE="2"\n';
const project = cube + '\nPROJECT_NAME="aliasowner"\nPROJECT_TEMPLATE="empty"\n' +
  'USE_PROD_HOST="true"\nPROD_HOST="example.test"\nPROD_DOMAIN_MODE="2"\nPROD_DEPLOY_MODE="0"\n' +
  'USE_BETA_HOST="false"\nUSE_REVIEW_HOST="false"\n';
require(path.join(source, 'sync/dist/index'));
(async () => {
  try {
    while (!server.listening) await new Promise(resolve => setTimeout(resolve, 5));
    const base = 'http://127.0.0.1:' + server.address().port;
    const login = await fetch(base + '/login', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: 'fixture', password: 'fixture-password'})});
    const token = (await login.json()).accessToken;
    assert(token);
    const authorization = {Authorization: 'Bearer ' + token};
    const jsonHeaders = {...authorization, 'Content-Type': 'application/json'};
    while ((await (await fetch(base + '/status', {headers: authorization})).json()).defaultWizardSetupInProgress)
      await new Promise(resolve => setTimeout(resolve, 5));
    const mainFile = path.join(root, 'system/.docker.env');
    fs.writeFileSync(mainFile, main);
    for (const [route, body] of [
      ['/config/project', {projectKey: 'aliasowner', data: project}],
      ['/projects', {projectKey: 'aliasowner', namespaceId: 1, template: 'empty', data: project, ci: 'CI_DEFAULT_BRANCH'}]
    ]) {
      const response = await fetch(base + route, {method: 'POST', headers: jsonHeaders, body: JSON.stringify(body)});
      assert.equal(response.status, 400, route);
      assert.match((await response.json()).message, /project host/);
      assert.equal(transports, 0, route + ' must reject before service or GitLab work');
      assert.deepEqual(fs.readdirSync(path.join(root, 'system/.projects.env')), []);
      assert.equal(fs.readFileSync(mainFile, 'utf8'), main);
    }
    const upload = new FormData();
    upload.append('.docker.env', new Blob([main.replace('WIZARD_ALIASES="example.test"', 'WIZARD_ALIASES="gitlab.example.test"')]), '.docker.env');
    const response = await fetch(base + '/config/main', {method: 'POST', headers: authorization, body: upload});
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /platform host/);
    assert.equal(transports, 0, 'invalid main Push must reject before stopping services');
    assert.equal(fs.readFileSync(mainFile, 'utf8'), main);
    const fetched = await (await fetch(base + '/config/main', {headers: authorization})).json();
    assert.equal(fetched.data, main, 'authenticated Fetch preserves the complete alias configuration and Cube');
    log('PASS: authenticated project creation, legacy project update and main Push reject alias conflicts before service calls or saved-state changes.');
  } finally {
    console.log = log;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
