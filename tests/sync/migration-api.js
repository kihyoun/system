// Run in the isolated component container after compiling Sync. No live stack.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const cube = fs.readFileSync(path.resolve(__dirname, '../../config/system/.docker.env.example'), 'utf8').slice(0, 1184);
const configuration = index => cube + '\nexport MIGRATION_FIXTURE="configuration-' + index + '"\n';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-migration-'));
for (const name of ['config/system', 'state']) fs.mkdirSync(path.join(root, name),{recursive:true});
fs.mkdirSync(path.join(root,'dist/cli'),{recursive:true});
fs.writeFileSync(path.join(root,'dist/cli/main.js'),'require("node:assert/strict").deepEqual(process.argv.slice(2,4),["lifecycle","stop-intermediate"]);process.exit(0);\n');
const startCode = `const path=require('node:path');const paths=require(path.join(path.dirname(process.argv[1]),'../common/runtime/installation-paths'));const fixture=process.argv[2];paths.checkoutRoot=()=>fixture;paths.checkoutPath=(...parts)=>path.join(fixture,...parts);paths.cliArguments=(command,args)=>[path.join(fixture,'dist/cli/main.js'),command,...args];require(process.argv[1]).bootstrap().catch(()=>{process.exitCode=1;});`;
const entry = path.resolve(__dirname, '../../dist/api/index.js');
const child = spawn(process.execPath, ['-e', startCode, entry, root], {cwd: root,
  env: {...process.env, SYSTEM_CONFIG_DIR: path.join(root, 'state'), SYNC_USER: 'migration-test', SYNC_PASS: 'test-only'}, stdio: ['ignore','pipe','pipe']});
let logs='';
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{logs=(logs+chunk.toString()).slice(-65536);});
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
  for (let i = 0; i < count; i++) body += `--sync-migration\r\nContent-Disposition: form-data; name="${field}"; filename="${field}"\r\nContent-Type: application/octet-stream\r\n\r\n${configuration(i)}\r\n`;
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
    const unauthorized = await request('/status', 'GET');
    assert.equal(unauthorized.status, 401); assert.equal(unauthorized.text, 'Unauthorized');
    const denied = await request('/login', 'POST', JSON.stringify({username: 'migration-test', password: 'wrong'}));
    assert.equal(denied.status, 401); assert.equal(denied.text, 'Username or Password incorrect');
    const login = await request('/login', 'POST', JSON.stringify({username: 'migration-test', password: 'test-only'}));
    assert.equal(login.status, 200);
    const {accessToken, refreshToken} = JSON.parse(login.text);
    assert(accessToken && refreshToken);
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
    assert.equal(payload.username, 'migration-test');
    assert.equal(payload.exp - payload.iat, 20 * 60, 'existing clients rely on the 20 minute access-token lifetime');
    const forbidden = await request('/status', 'GET', undefined, 'invalid');
    assert.equal(forbidden.status, 403); assert.equal(forbidden.text, 'Forbidden');
    const missingRefresh = await request('/token', 'POST', '{}');
    assert.equal(missingRefresh.status, 401); assert.equal(missingRefresh.text, 'Unauthorized');

    assert.equal((await request('/status', 'GET', undefined, accessToken)).status, 200);
    const refreshed = await request('/token', 'POST', JSON.stringify({token: refreshToken}));
    assert.equal(refreshed.status, 200);
    assert.equal((await request('/status', 'GET', undefined, JSON.parse(refreshed.text).accessToken)).status, 200);
    assert.equal((await request('/token', 'POST', JSON.stringify({token: 'invalid'}))).status, 403);
    const type = 'multipart/form-data; boundary=sync-migration';
    assert.equal((await request('/config/main', 'POST', multipart('.docker.env', 2), accessToken, type)).status, 400);
    assert.equal((await request('/config/main', 'POST', multipart('.docker.env', 3), accessToken, type)).status, 400);
    const mixed = multipart('.docker.env', 1).replace('--sync-migration--\r\n', '') + multipart('unexpected.txt', 1);
    assert.equal((await request('/config/main', 'POST', mixed, accessToken, type)).status, 400);
    assert.equal((await request('/config/zip', 'POST', multipart('bootstrapper.zip', 2), accessToken, type)).status, 400);
    assert(!fs.existsSync(path.join(root, 'state/.docker.env')));
    assert.equal((await request('/config/main', 'POST', multipart('.docker.env', 1), accessToken, type)).status, 200);
    const fetched = await request('/config/main', 'GET', undefined, accessToken);
    assert.equal(fetched.status, 200);
    assert.equal(JSON.parse(fetched.text).data, configuration(0));
    assert(!fs.existsSync(path.join(root, 'config/system/.docker.env')), 'writes must use the mounted configuration directory');
    assert.equal((await request('/config/main', 'DELETE', undefined, accessToken)).status, 200);
    assert(!fs.existsSync(path.join(root, 'state/.docker.env')));
    assert.equal((await request('/config/main', 'GET', undefined, accessToken)).status, 404);
    assert.equal((await request('/config/main', 'POST', multipart('.docker.env', 1), accessToken, type)).status, 200);
    assert.equal(JSON.parse((await request('/config/main', 'GET', undefined, accessToken)).text).data, configuration(0));
    const logout = await request('/logout', 'POST', '{}', accessToken);
    assert.equal(logout.status, 200); assert.equal(logout.text, 'Logout successful');
    await new Promise(resolve=>setImmediate(resolve));
    assert(logs.includes('Sync authentication is configured.'),'Startup must confirm configured authentication without values.');
    for(const secret of ['migration-test','test-only',accessToken,refreshToken]) {
      assert(!logs.includes(secret),'Sync stdout/stderr must not contain configured credentials or issued tokens.');
    }
    console.log('Sync migration: login/refresh/auth, credential-safe output, multipart array rejection and single-file Push/Fetch passed.');
  } finally {
    child.kill();
    fs.rmSync(root, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
