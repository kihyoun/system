// Run in a disposable container after compiling sync; uses local port 8071.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suggestions-api-'));
fs.mkdirSync(path.join(tmp, 'config/system'),{recursive:true});
const startCode = `const path=require('node:path');const paths=require(path.join(path.dirname(process.argv[1]),'../common/runtime/installation-paths'));const fixture=process.argv[2];paths.checkoutRoot=()=>fixture;paths.checkoutPath=(...parts)=>path.join(fixture,...parts);paths.cliArguments=(command,args)=>[path.join(fixture,'dist/cli/main.js'),command,...args];require(process.argv[1]).bootstrap().catch(()=>{process.exitCode=1;});`;
const child = spawn(process.execPath,
  ['-e', startCode, process.env.SYNC_ENTRY || path.resolve(__dirname, '../../dist/api/index.js'), tmp], {
    cwd: tmp, stdio: 'ignore',
    env: { ...process.env, SYSTEM_CONFIG_DIR: path.join(tmp, 'config/system'), SYNC_USER: 'test-user', SYNC_PASS: 'test-only-password' }
  });
function request(route, token, data, method) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 8071, path: route,
      method: method || (data ? 'POST' : 'GET'), headers: {
        Host: 'sync.localhost', 'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      } }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
    req.on('error', reject);
    req.end(data ? JSON.stringify(data) : undefined);
  });
}
(async () => {
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { await request('/status'); ready = true; break; } catch (_) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    assert(ready, 'isolated sync server did not start');
    assert.equal((await request('/config/suggestions')).status, 401);
    const login = await request('/login', null, { username: 'test-user', password: 'test-only-password' });
    const token = JSON.parse(login.body).accessToken;
    assert(token);
    assert.equal((await request('/config/main', token)).status, 404);
    const suggestions = await request('/config/suggestions', token);
    assert.equal(suggestions.status, 200);
    assert.equal(suggestions.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(suggestions.body).source, 'derived');
    assert.equal(JSON.parse(suggestions.body).config.gitlabHost, 'gitlab.localhost');
    const main = path.join(tmp, 'config/system', '.docker.env');
    assert.equal(fs.existsSync(main), false, 'suggestions must not create config');
    const saved = 'export GITLAB_HOST=gitlab.saved.test\n';
    fs.writeFileSync(main, saved);
    const fetched = await request('/config/main', token);
    assert.equal(fetched.status, 200);
    assert.equal(JSON.parse(fetched.body).data, saved);
    assert.equal((await request('/config/suggestions', token)).status, 409);
    assert.equal(fs.readFileSync(main, 'utf8'), saved);
        fs.mkdirSync(path.join(tmp,'dist/cli'),{recursive:true});
    const runnerScript = path.join(tmp, 'dist/cli/main.js');
    fs.writeFileSync(runnerScript, 'require("node:assert/strict").deepEqual(process.argv.slice(2,4),["lifecycle","runner-start"]);setTimeout(()=>console.log("Runner registered."),1000);\n');
    assert.equal((await request('/command/runners/register', null, null, 'PATCH')).status, 401);
    const setup = request('/command/runners/register', token, null, 'PATCH');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal((await request('/status', token)).status, 200, 'setup must not block Sync');
    assert.equal((await request('/config/main', token, {})).status, 409, 'Push must wait for setup');
    assert.equal((await setup).status, 200);
    fs.writeFileSync(runnerScript, 'console.error("private-test-credential");process.exit(1);\n');
    const failedSetup = await request('/command/runners/register', token, null, 'PATCH');
    assert.equal(failedSetup.status, 500);
    assert(!failedSetup.body.includes('private-test-credential'), 'errors must not relay credential output');
    assert.equal(JSON.parse((await request('/status', token)).body).runnerSetupInProgress, false);
    console.log('PASS: authenticated API, missing config fallback, no writes, no-store and saved config precedence');
    console.log('PASS: authenticated asynchronous runner setup, config write guard and redacted errors');
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
