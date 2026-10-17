// Run in the isolated component container after compiling Sync. No live stack.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-migration-'));
for (const name of ['sync', 'system']) fs.mkdirSync(path.join(root, name));
fs.writeFileSync(path.join(root, 'system/stop-intermediate.sh'), 'exit 0\n');
const entry = path.resolve(__dirname, '../../sync/dist/index.js');
const child = spawn(process.execPath, [entry], {cwd: path.join(root, 'sync'),
  env: {...process.env, SYNC_USER: 'migration-test', SYNC_PASS: 'test-only'}, stdio: 'ignore'});
function request(route, method, body, token, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: 8071, path: route, method,
      headers: {'Content-Type': contentType, ...(token ? {Authorization: `Bearer ${token}`} : {})}}, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({status: res.statusCode, text}));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function multipart(field, count) {
  let body = '';
  for (let i = 0; i < count; i++) body += `--sync-migration\r\nContent-Disposition: form-data; name="${field}"; filename="${field}"\r\nContent-Type: application/octet-stream\r\n\r\nconfiguration-${i}\r\n`;
  return body + '--sync-migration--\r\n';
}
(async () => {
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await request('/status', 'GET'); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert(ready, 'candidate Sync did not start');
    assert.equal((await request('/status', 'GET')).status, 401);
    assert.equal((await request('/login', 'POST', JSON.stringify({username: 'migration-test', password: 'wrong'}))).status, 401);
    const login = await request('/login', 'POST', JSON.stringify({username: 'migration-test', password: 'test-only'}));
    assert.equal(login.status, 200);
    const {accessToken, refreshToken} = JSON.parse(login.text);
    assert(accessToken && refreshToken);
    assert.equal((await request('/status', 'GET', undefined, accessToken)).status, 200);
    const refreshed = await request('/token', 'POST', JSON.stringify({token: refreshToken}));
    assert.equal(refreshed.status, 200);
    assert.equal((await request('/status', 'GET', undefined, JSON.parse(refreshed.text).accessToken)).status, 200);
    assert.equal((await request('/token', 'POST', JSON.stringify({token: 'invalid'}))).status, 403);
    const type = 'multipart/form-data; boundary=sync-migration';
    assert.equal((await request('/config/main', 'POST', multipart('.docker.env', 2), accessToken, type)).status, 400);
    assert.equal((await request('/config/zip', 'POST', multipart('bootstrapper.zip', 2), accessToken, type)).status, 400);
    assert(!fs.existsSync(path.join(root, 'system/.docker.env')));
    assert.equal((await request('/config/main', 'POST', multipart('.docker.env', 1), accessToken, type)).status, 200);
    const fetched = await request('/config/main', 'GET', undefined, accessToken);
    assert.equal(fetched.status, 200);
    assert.equal(JSON.parse(fetched.text).data, 'configuration-0');
    assert.equal((await request('/logout', 'POST', '{}', accessToken)).status, 200);
    console.log('Sync migration: login/refresh/auth, multipart array rejection and single-file Push/Fetch passed.');
  } finally {
    child.kill();
    fs.rmSync(root, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
