// Run after compiling Sync, in an isolated container without a Docker socket.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const {spawn} = require('child_process');
const entry = process.env.SYNC_ENTRY || path.resolve(__dirname, '../../sync/dist/index.js');
const pushScript = process.env.PUSH_SCRIPT || path.resolve(__dirname, '../../system/push.sh');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function scenario(validArchive) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'push-restart-'));
  for (const dir of ['sync', 'system', 'state', 'archive']) fs.mkdirSync(path.join(root, dir));
  fs.copyFileSync(pushScript, path.join(root, 'system/push.sh'));
  fs.writeFileSync(path.join(root, 'system/stop-intermediate.sh'), 'touch ../stopped\n');
  const saved = path.join(root, 'state/.docker.env');
  fs.writeFileSync(saved, 'export GITLAB_RUNNER_SCALE=1\n');
  // Stored ZIP fixture: .docker.env containing export GITLAB_RUNNER_SCALE=4.
  const archive = validArchive ? Buffer.from('UEsDBBQAAAAAAM94Ul29Zn2WHQAAAB0AAAALAAAALmRvY2tlci5lbnZleHBvcnQgR0lUTEFCX1JVTk5FUl9TQ0FMRT00ClBLAQIUAxQAAAAAAM94Ul29Zn2WHQAAAB0AAAALAAAAAAAAAAAAAACAAQAAAAAuZG9ja2VyLmVudlBLBQYAAAAAAQABADkAAABGAAAAAAA=', 'base64') : Buffer.from('invalid zip');
  const child = spawn(process.execPath, [entry], {
    cwd: path.join(root, 'sync'), stdio: 'ignore',
    env: {...process.env, SYSTEM_CONFIG_DIR: path.join(root, 'state'), SYNC_USER: 'fixture', SYNC_PASS: 'fixture-password'}
  });
  let exited = false;
  const completion = new Promise(resolve => child.once('exit', code => { exited = true; resolve(code); }));
  function request(route, body, token, multipart = false) {
    return new Promise((resolve, reject) => {
      const req = http.request({host: '127.0.0.1', port: 8071, path: route,
        method: body ? 'POST' : 'GET', headers: {
          'Content-Type': multipart ? 'multipart/form-data; boundary=fixture-boundary' : 'application/json',
          ...(token ? {Authorization: 'Bearer ' + token} : {})
        }}, res => {
        let text = '';
        res.on('data', part => text += part);
        res.on('end', () => resolve({status: res.statusCode, text}));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await request('/status');
        ready = true; break;
      } catch (_) { /* wait for listener */ }
      await pause(100);
    }
    assert(ready, 'Sync listener did not become ready');
    assert.equal((await request('/config/zip', '{}')).status, 401);
    const login = await request('/login', JSON.stringify({username: 'fixture', password: 'fixture-password'}));
    const token = JSON.parse(login.text).accessToken;
    assert(token);
    for (let i = 0; i < 100; i++) {
      if (!JSON.parse((await request('/status', null, token)).text).defaultWizardSetupInProgress) break;
      await pause(100);
    }
    assert.equal((await request('/config/zip', '{}', token)).status, 400);
    assert(!exited, 'rejected requests must not restart Sync');
    const body = Buffer.concat([
      Buffer.from('--fixture-boundary\r\nContent-Disposition: form-data; name="bootstrapper.zip"; filename="bootstrapper.zip"\r\nContent-Type: application/zip\r\n\r\n'),
      archive, Buffer.from('\r\n--fixture-boundary--\r\n')
    ]);
    const result = await request('/config/zip', body, token, true);
    assert(!fs.existsSync(path.join(root, 'stopped')), 'Push must not stop services before completing its response');
    if (validArchive) {
      assert.equal(result.status, 200);
      assert.equal(JSON.parse(result.text).message, 'Config written. Restarting system.');
      assert.equal(fs.readFileSync(saved, 'utf8'), 'export GITLAB_RUNNER_SCALE=4\n');
      assert.equal(await Promise.race([completion, pause(3000).then(() => 'timeout')]), 0,
        'successful Push must exit Sync so the controller restarts');
    } else {
      assert.equal(result.status, 500);
      await pause(100);
      assert(!exited, 'failed import must leave Sync available');
      assert.equal((await request('/status', null, token)).status, 200);
      assert.equal(fs.readFileSync(saved, 'utf8'), 'export GITLAB_RUNNER_SCALE=1\n');
    }
  } finally {
    if (!exited) { child.kill(); await completion; }
    fs.rmSync(root, {recursive: true, force: true});
  }
}
(async () => {
  await scenario(false);
  await scenario(true);
  console.log('PASS: rejected and failed Push preserve availability; successful ZIP import responds before triggering restart');
})().catch(error => { console.error(error); process.exitCode = 1; });
