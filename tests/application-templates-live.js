// Explicit local test against Sync; leaves three generated starters for review.
const fs = require('fs');
const http = require('http');
const assert = require('assert');
const crypto = require('crypto');
function request(route, token, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port: 8071, path: route, method: data ? 'POST' : 'GET',
      headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}}, res => {
      let body = ''; res.on('data', chunk => body += chunk);
      res.on('end', () => { try { resolve({status: res.statusCode, data: JSON.parse(body)}); } catch (_) { reject(new Error('Unexpected response')); } });
    });
    req.on('error', reject); req.end(data ? JSON.stringify(data) : undefined);
  });
}
(async () => {
  const login = await request('/login', null, {username: process.env.SYNC_USER, password: process.env.SYNC_PASS});
  assert.equal(login.status, 200);
  const token = login.data.accessToken;
  const inputs = JSON.parse(fs.readFileSync(process.env.PROJECT_PAYLOAD, 'utf8'));
  const results = [];
  for (const input of inputs) {
    const accepted = await request('/projects', token, input);
    assert.equal(accepted.status, 202, accepted.data.message);
    let result = accepted.data;
    for (let attempt = 0; result.state === 'running' && attempt < 240; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      result = (await request('/projects/jobs/' + result.id, token)).data;
    }
    assert.equal(result.state, 'complete', result.message);
    assert.equal(result.repository.template, input.template);
    assert.equal(result.repository.deploymentState, 'pipeline-started');
    assert(result.repository.initialPipeline.id);
    assert.equal((await request('/projects', token, input)).data.id, accepted.data.id);
    const fetched = await request('/config/projects', token);
    const config = fetched.data.find(item => item.filename === '.' + input.projectKey + '.env');
    assert.equal(config.template, input.template);
    assert.equal(config.repository.id, result.repository.id);
    assert.equal(crypto.createHash('md5').update(config.data.substr(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
    results.push(result.repository);
    fs.writeFileSync('/tmp/template-live-results.json', JSON.stringify(results));
    console.log(input.template + ' source, Dockerfile, CI, first pipeline, repeated Save and Fetch passed: ' + result.repository.webUrl);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
