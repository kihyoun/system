'use strict';
// Exercise actual HTTP authentication, shared maintenance guards and operation
// responses. Native side effects are replaced before the server is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {spawn} = require('node:child_process');
const entry = process.env.SYNC_ENTRY || path.resolve(__dirname, '../../sync/dist/index.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-api-'));
const state = path.join(root, 'state');
fs.mkdirSync(state);
const main = path.join(state, '.docker.env');
fs.writeFileSync(main, 'export SYSTEM_CREDENTIAL_PROJECT_PATHS="[]"\n');
const original = fs.readFileSync(main);
const id = 'a'.repeat(48), backupId = 'b'.repeat(32);
const code = `
  const fs = require('node:fs'), path = require('node:path');
  const directory = path.dirname(process.env.SYNC_ENTRY);
  const record = name => fs.appendFileSync(path.join(process.env.SYSTEM_CONFIG_DIR, 'calls'), name + '\\n');
  require(path.join(directory, 'DefaultWizard')).ensureDefaultWizard = async () => ({state:'complete'});
  const projects = require(path.join(directory, 'ProjectBootstrap'));
  projects.lookupJob = id => id === '${id}' ? {id,state:'running'} : undefined;
  const preview = require(path.join(directory, 'PreviewSetup'));
  preview.previewSetupStatus = () => ({state:'not-configured', phase:'preflight'});
  preview.preflightPreviewSetup = async () => { record('preflight'); return {state:'complete',previewHash:'fixture'}; };
  preview.applyPreviewSetup = () => { record('apply'); fs.mkdirSync(path.join(process.env.SYSTEM_CONFIG_DIR, '.storage-operation-lock')); return {id:'${id}',state:'running'}; };
  const backup = require(path.join(directory, 'BackupWorkflow'));
  backup.startBackupWorkflow = () => { record('backup'); return {id:'${backupId}',state:'working'}; };
  backup.backupWorkflowStatus = id => { if (id !== '${backupId}') throw Error('private fixture error'); return {id,state:'failed',phase:'harvest',error:'native-harvest-failed',configuration:{status:'unavailable'}}; };
  backup.backupWorkflowDownload = () => { throw Error('private fixture path'); };
  require(process.env.SYNC_ENTRY);
`;
const child = spawn(process.execPath, ['-e', code], {
  cwd: root, stdio: ['ignore', 'ignore', 'pipe'],
  env: {...process.env, SYNC_ENTRY: entry, SYSTEM_CONFIG_DIR: state, SYNC_USER: 'fixture', SYNC_PASS: 'fixture-password'}
});
const closed = new Promise(resolve => child.once('exit', resolve));
let serverErrors = '';
child.stderr.on('data', part => { serverErrors = (serverErrors + part).slice(-4000); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function request(route, method = 'GET', token, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({hostname:'127.0.0.1', port:8071, path:route, method,
      headers:{'Content-Type':'application/json', Connection:'close', ...(data ? {'Content-Length':Buffer.byteLength(data)} : {}), ...(token ? {Authorization:'Bearer ' + token} : {})}}, res => {
      let raw = '';
      res.on('data', part => raw += part);
      res.on('end', () => resolve({status:res.statusCode, body:raw}));
    });
    req.on('error', error => reject(Object.assign(error, {route, method}))); req.end(data);
  });
}
(async () => {
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await request('/status'); ready = true; break; } catch { await pause(50); }
    }
    assert(ready, 'isolated Sync listener did not become ready');
    const routes = [
      ['/projects/wizard/preview-setup','GET'], ['/projects/wizard/preview-setup/preflight','POST'],
      ['/projects/wizard/preview-setup/apply','POST'], ['/command/backup','POST'],
      ['/backup/' + backupId,'GET'], ['/backup/' + backupId + '/download','GET'],
      ['/operations/credentials','GET'], ['/diagnostics','GET'],
      ['/diagnostics/connection','POST'], ['/diagnostics/pull','POST']
    ];
    for (const [route, method] of routes) assert.equal((await request(route, method, undefined, method === 'POST' ? {} : undefined)).status, 401, route);
    assert(!fs.existsSync(path.join(state, 'calls')), 'unauthenticated requests started an operation');
    const login = await request('/login','POST',undefined,{username:'fixture',password:'fixture-password'});
    const token = JSON.parse(login.body).accessToken;
    assert(token);
    const credentials = await request('/operations/credentials', 'GET', token);
    assert.equal(credentials.status,200);
    assert.equal(JSON.parse(credentials.body).readOnly,true);
    assert.deepEqual(JSON.parse(credentials.body).credentials,[]);
    assert(!fs.existsSync(path.join(state, 'calls')), 'read-only overview started an operation');
    assert.equal((await request('/projects/wizard/preview-setup/preflight','POST',token,{})).status,200);
    assert.equal((await request('/projects/wizard/preview-setup/apply','POST',token,{})).status,202);
    assert.equal((await request('/projects/jobs/' + id,'GET')).status,401, 'local polling must remain authenticated during a lease');
    assert.equal((await request('/projects/wizard/preview-setup','GET')).status,401);
    assert.equal(JSON.parse((await request('/projects/jobs/' + id,'GET',token)).body).state,'running');
    assert.equal((await request('/projects/wizard/preview-setup','GET',token)).status,200);
    assert.equal((await request('/projects/jobs/' + 'c'.repeat(48),'GET',token)).status,404);
    for (const [route, method] of [['/command/backup','POST'], ['/projects/wizard/preview-setup/preflight','POST'], ['/projects/wizard/preview-setup/apply','POST'], ['/projects/namespaces','GET'], ['/config/main','DELETE'], ['/diagnostics/pull','POST']]) {
      assert.equal((await request(route,method,token,method === 'GET' ? undefined : {})).status,409,route + ' bypassed the storage lease');
    }
    assert.equal(fs.readFileSync(path.join(state,'calls'),'utf8'),'preflight\napply\n');
    fs.rmdirSync(path.join(state,'.storage-operation-lock'));
    assert.equal((await request('/command/backup','POST',token,{})).status,202);
    assert.equal((await request('/command/backup','POST',token,{})).status,409, 'asynchronous backup must hold the in-process guard before native lease acquisition');
    const failed = await request('/backup/' + backupId,'GET',token);
    assert.equal(failed.status,200);
    assert.equal(JSON.parse(failed.body).state,'failed', 'a failed native backup must remain readable');
    const missing = await request('/backup/' + 'c'.repeat(32),'GET',token);
    assert.equal(missing.status,404); assert(!missing.body.includes('private'));
    const download = await request('/backup/' + backupId + '/download','GET',token);
    assert.equal(download.status,409); assert(!download.body.includes('private'));
    assert.deepEqual(fs.readFileSync(main),original,'reads and rejected operations changed saved configuration');
    assert.equal(fs.readFileSync(path.join(state,'calls'),'utf8'),'preflight\napply\nbackup\n');
    console.log('PASS: operational routes enforce authentication and shared leases; local job/status polling and native backup failures stay readable without leaking private errors.');
  } finally {
    child.kill(); await closed; fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error => { console.error(error, serverErrors); process.exitCode = 1; });
