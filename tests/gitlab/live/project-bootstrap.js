// Explicit local integration test. Run inside the bootstrapper with SYNC_USER,
// SYNC_PASS and a payload exported by the Wizard generator in PROJECT_PAYLOAD.
// Leaves the private bootstrapdemo repository and routing available for review.
const fs = require('fs');
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const path = require('path');
function request(route, token, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: 8071, path: route, method: data ? 'POST' : 'GET',
      headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}}, response => {
      let body = ''; response.on('data', chunk => body += chunk);
      response.on('end', () => { try { resolve({status: response.statusCode, data: JSON.parse(body)}); } catch (_) { reject(new Error('Unexpected API response (HTTP ' + response.statusCode + ')')); } });
    });
    req.on('error', reject); req.end(data ? JSON.stringify(data) : undefined);
  });
}
async function poll(job, token) {
  for (let attempt = 0; job.state === 'running' && attempt < 240; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const result = await request('/projects/jobs/' + job.id, token);
    assert.equal(result.status, 200); job = result.data;
  }
  assert.equal(job.state, 'complete', job.message || 'Timed out');
  return job;
}
(async () => {
  const login = await request('/login', null, {username: process.env.SYNC_USER, password: process.env.SYNC_PASS});
  assert.equal(login.status, 200);
  const token = login.data.accessToken;
  const namespaces = await poll((await request('/projects/namespaces', token)).data, token);
  const namespace = namespaces.namespaces.find(item => item.path === 'root');
  assert(namespace);
  const input = JSON.parse(fs.readFileSync(process.env.PROJECT_PAYLOAD, 'utf8'));
  input.namespaceId = String(namespace.id);
  assert.equal((await request('/projects', token, {...input, projectKey: 'Invalid-Key'})).status, 400);
  const check = await poll((await request('/projects/availability?projectKey=' + input.projectKey + '&namespaceId=' + input.namespaceId, token)).data, token);
  assert(['available', 'occupied'].includes(check.availability));
  console.log('Live namespace and availability verified:', namespace.path, check.availability);
  const accepted = await request('/projects', token, input);
  assert.equal(accepted.status, 202);
  const concurrent = await request('/projects', token, input);
  assert.equal(concurrent.data.id, accepted.data.id);
  const result = await poll(accepted.data, token);
  assert.equal(result.repository.path, namespace.path + '/' + input.projectKey);
  assert(result.repository.defaultBranch);
  assert.equal(result.repository.deploymentState, 'awaiting-source');
  const repeated = await request('/projects', token, input);
  assert.equal(repeated.data.id, accepted.data.id);
  assert.equal(repeated.data.repository.id, result.repository.id);
  const fetched = await request('/config/projects', token);
  const config = fetched.data.find(item => item.filename === '.' + input.projectKey + '.env');
  assert.equal(config.repository.id, result.repository.id);
  assert.equal(config.data.substr(807, 1), '$');
  assert.equal(crypto.createHash('md5').update(config.data.substr(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
  // A different operation must never acquire even this known test repository.
  const ruby = "BOOTSTRAPPER_INPUT = '" + Buffer.from(JSON.stringify({...input, action: 'create', operation: 'unrelated-operation'})).toString('base64') + "'\n" + fs.readFileSync(path.resolve(__dirname, '../../../project-bootstrap/provision.rb'), 'utf8');
  const refused = spawnSync('docker', ['exec', '-i', 'system_gitlab_1', 'gitlab-rails', 'runner', '-'], {input: ruby, encoding: 'utf8', timeout: 240000});
  assert.equal(refused.status, 0, 'Local Rails check failed');
  const conflict = JSON.parse(refused.stdout.trim().split('\n').pop());
  assert.equal(conflict.conflict, true);
  console.log('Live private repository, managed CI, default branch, concurrent/repeated Save, foreign-operation refusal and authenticated Fetch signature passed:', result.repository.webUrl);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
