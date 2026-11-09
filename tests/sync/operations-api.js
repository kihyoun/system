'use strict';
// Exercise actual HTTP authentication, shared maintenance guards and operation
// responses. Native side effects are replaced before the server is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const nativeBackup = require('../../system/coordinated-backup');
const {spawn} = require('node:child_process');
const entry = process.env.SYNC_ENTRY || path.resolve(__dirname, '../../sync/dist/index.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-api-'));
const state = path.join(root, 'state');
fs.mkdirSync(state);
const main = path.join(state, '.docker.env');
fs.writeFileSync(main, 'export SYSTEM_CREDENTIAL_PROJECT_PATHS="[]"\n');
const original = fs.readFileSync(main);
const id = 'a'.repeat(48), backupId = 'b'.repeat(32), readyId = 'd'.repeat(32);
const privateBackups = path.join(state, '.coordinated-backups');
fs.mkdirSync(privateBackups, {mode: 0o700});
const archiveDirectory = nativeBackup.directory(state, readyId);
fs.mkdirSync(archiveDirectory, {mode: 0o700});
const archive = path.join(archiveDirectory, 'bootstrapper.zip');
// An actual empty ZIP, retained privately beneath the native hidden directory.
const zip = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');
fs.writeFileSync(archive, zip, {mode: 0o600});
const zipHash = crypto.createHash('sha256').update(zip).digest('hex');
const readyBackup = {id: readyId, state: 'ready', configuration: {status: 'ready', sha256: zipHash}};
nativeBackup.writeStatus(archiveDirectory, readyBackup);
assert.equal(fs.statSync(privateBackups).mode & 0o777, 0o700);
assert.equal(fs.statSync(archive).mode & 0o777, 0o600);
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
  const nativeBackupStatus = backup.backupWorkflowStatus;
  backup.backupWorkflowStatus = id => id === '${backupId}' ? {id,state:'failed',phase:'harvest',error:'native-harvest-failed',configuration:{status:'unavailable'}} : nativeBackupStatus(id);
  // Download authorization, completion and checksum checks stay real.
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
      const chunks = [];
      res.on('data', part => chunks.push(part));
      res.on('end', () => { const bytes = Buffer.concat(chunks); resolve({status:res.statusCode, body:bytes.toString(), bytes, headers:res.headers}); });
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
      ['/backup/' + readyId,'GET'], ['/backup/' + readyId + '/download','GET'],
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
    assert.equal((await request('/backup/' + readyId + '/download', 'GET', 'invalid-fixture-token')).status, 403);
    assert.equal((await request('/backup/' + readyId + '/download', 'GET', token)).status, 409,
      'Ready bytes cannot download before native helper completion');
    const completedBackup = {...readyBackup, helperCompletedAt: new Date().toISOString()};
    nativeBackup.writeStatus(archiveDirectory, {...completedBackup, state: 'failed'});
    assert.equal((await request('/backup/' + readyId + '/download', 'GET', token)).status, 409,
      'An existing archive cannot bypass a failed backup status');
    nativeBackup.writeStatus(archiveDirectory, {...completedBackup, configuration: {status: 'unavailable', sha256: zipHash}});
    assert.equal((await request('/backup/' + readyId + '/download', 'GET', token)).status, 409,
      'A matching hash cannot bypass unavailable configuration status');
    nativeBackup.writeStatus(archiveDirectory, completedBackup);
    assert.equal(JSON.parse((await request('/backup/' + readyId, 'GET', token)).body).state, 'ready');
    const saved = await request('/backup/' + readyId + '/download', 'GET', token);
    assert.equal(saved.status, 200, 'A completed native ZIP under the private hidden directory must download');
    assert.deepEqual(saved.bytes, zip);
    assert.equal(crypto.createHash('sha256').update(saved.bytes).digest('hex'), zipHash);
    assert.match(saved.headers['content-disposition'], /^attachment; filename=(?:bootstrapper\.zip|"bootstrapper\.zip")$/);
    assert.equal(saved.headers['cache-control'], 'no-store');
    assert.equal(saved.headers['content-type'], 'application/zip');
    assert.equal((await request('/.coordinated-backups/' + readyId + '/bootstrapper.zip', 'GET', token)).status, 404,
      'The authenticated download must not expose a static backup directory');
    const invalid = await request('/backup/..%2Foutside/download', 'GET', token);
    assert.equal(invalid.status, 409); assert(!invalid.body.includes(root));
    fs.appendFileSync(archive, 'tamper');
    assert.equal((await request('/backup/' + readyId + '/download', 'GET', token)).status, 409,
      'A mismatched archive hash must remain unavailable over HTTP');
    fs.unlinkSync(archive); fs.symlinkSync(main, archive);
    assert.equal((await request('/backup/' + readyId + '/download', 'GET', token)).status, 409,
      'A symlink must not turn the narrow dotfile exception into another file download');
    assert.deepEqual(fs.readFileSync(main),original,'reads and rejected operations changed saved configuration');
    assert.equal(fs.readFileSync(path.join(state,'calls'),'utf8'),'preflight\napply\nbackup\n');
    console.log('PASS: operational routes enforce authentication and shared leases; local job/status polling and native backup failures stay readable; completed private hidden-directory ZIPs download exactly while helper/hash/path/auth guards remain enforced.');
  } finally {
    child.kill(); await closed; fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error => { console.error(error, serverErrors); process.exitCode = 1; });
