// Run in a disposable container after compiling sync; uses local port 8071.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suggestions-api-'));
fs.mkdirSync(path.join(tmp, 'sync'));
fs.mkdirSync(path.join(tmp, 'system'));
const child = spawn(process.execPath,
  [process.env.SYNC_ENTRY || path.resolve(__dirname, '../sync/dist/index.js')], {
    cwd: path.join(tmp, 'sync'), stdio: 'ignore',
    env: { ...process.env, SYNC_USER: 'test-user', SYNC_PASS: 'test-only-password' }
  });
function request(route, token, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 8071, path: route,
      method: data ? 'POST' : 'GET', headers: {
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
    const main = path.join(tmp, 'system', '.docker.env');
    assert.equal(fs.existsSync(main), false, 'suggestions must not create config');
    const saved = 'export GITLAB_HOST=gitlab.saved.test\n';
    fs.writeFileSync(main, saved);
    const fetched = await request('/config/main', token);
    assert.equal(fetched.status, 200);
    assert.equal(JSON.parse(fetched.body).data, saved);
    assert.equal((await request('/config/suggestions', token)).status, 409);
    assert.equal(fs.readFileSync(main, 'utf8'), saved);
    console.log('PASS: authenticated API, missing config fallback, no writes, no-store and saved config precedence');
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
