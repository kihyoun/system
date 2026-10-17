// Isolated contract tests: real Sync operations, disposable files and a Docker
// transport double. The separate live test exercises the real Rails/API bridge.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const {spawn} = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-'));
const sync = path.resolve(__dirname, '../sync/dist');
fs.mkdirSync(path.join(root, 'sync'));
fs.mkdirSync(path.join(root, 'bin'));
fs.mkdirSync(path.join(root, 'project-bootstrap'));
fs.writeFileSync(path.join(root, 'project-bootstrap/apply.sh'), 'exit 0\n');
const mock = `#!${process.execPath}
let text = ''; process.stdin.on('data', chunk => text += chunk);
process.stdin.on('end', () => {
 const input = JSON.parse(Buffer.from(/BOOTSTRAPPER_INPUT = '([^']+)'/.exec(text)[1], 'base64'));
 const result = input.action === 'pipeline' ? {pipeline: {id: 123, webUrl: 'http://gitlab.localhost/pipeline', status: 'pending'}} :
 input.action === 'namespaces' ? {namespaces: [{id: 1, path: 'root'}]} :
 input.action === 'availability' ? {availability: input.projectKey === 'occupied' ? 'occupied' : 'available'} :
 input.projectKey === 'race' ? {state: 'failed', conflict: true, message: 'Repository already exists'} :
 {repository: {id: 42, namespaceId: input.namespaceId, path: 'root/' + input.projectKey, defaultBranch: 'main', webUrl: 'http://gitlab.localhost/root/' + input.projectKey}};
 setTimeout(() => console.log(JSON.stringify(result)), 100);
});
`;
fs.writeFileSync(path.join(root, 'bin/docker'), mock, {mode: 0o755});
process.env.PATH = path.join(root, 'bin') + ':' + process.env.PATH;
process.chdir(path.join(root, 'sync'));
const bootstrap = require(path.join(sync, 'ProjectBootstrap'));
const logo = require(path.join(sync, 'Helper')).default.textLogo;
const input = key => ({projectKey: key, namespaceId: '1', data: logo + '\nPROJECT_NAME="' + key + '"\nUSE_PROD_HOST="false"\nUSE_BETA_HOST="false"\nUSE_REVIEW_HOST="false"\n# created on first\n', ci: '# CI_DEFAULT_BRANCH\n'});
const wait = async job => {
  while (job.state === 'running') { await new Promise(resolve => setTimeout(resolve, 20)); }
  return job;
};
function request(route, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port: 8071, path: route,
      method: body ? 'POST' : 'GET', headers: {'Content-Type': 'application/json',
        ...(token ? {Authorization: 'Bearer ' + token} : {})}}, res => {
      let text = ''; res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({status: res.statusCode, data: text && /^[{[]/.test(text) ? JSON.parse(text) : text}));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
let child;
(async () => {
  for (const key of ['', 'A', 'a-b', 'ä', 'a b', '../x', null]) {
    assert(!bootstrap.validProjectKey(key));
    assert.throws(() => bootstrap.createProject(input(key)));
  }
  const hostile = input('hostile'); hostile.data += 'PROD_HOST="$(touch /tmp/unsafe)"\n';
  assert.throws(() => bootstrap.createProject(hostile));
  const signature = input('signature'); signature.data = 'not a configuration';
  assert.throws(() => bootstrap.createProject(signature));
  const data = input('example');
  const first = bootstrap.createProject(data);
  assert.equal(bootstrap.createProject(data).id, first.id, 'concurrent Saves share one operation');
  assert(bootstrap.projectBusy());
  assert.throws(() => bootstrap.createProject({...data, namespaceId: '2'}));
  assert.equal((await wait(first)).state, 'complete');
  assert(!bootstrap.projectBusy());
  assert.equal(bootstrap.createProject({...data, data: data.data.replace('created on first', 'created on later')}).id, first.id);
  const receipt = bootstrap.readReceipt(fs.readFileSync(path.join(root, 'system/.projects.env/.example.env'), 'utf8'));
  assert.equal(receipt.repository.id, 42);
  assert.equal(receipt.repository.defaultBranch, 'main');
  assert.equal((await wait(bootstrap.createProject(input('race')))).state, 'failed');
  assert(!fs.existsSync(path.join(root, 'system/.projects.env/.race.env')), 'collision does not claim foreign repository locally');
  assert.equal((await wait(bootstrap.queryGitlab({action: 'availability', projectKey: 'occupied', namespaceId: 1}))).availability, 'occupied');
  fs.writeFileSync(path.join(root, 'project-bootstrap/apply.sh'), 'exit 1\n');
  const interrupted = bootstrap.createProject(input('resume'));
  assert.equal((await wait(interrupted)).state, 'failed');
  fs.writeFileSync(path.join(root, 'project-bootstrap/apply.sh'), 'exit 0\n');
  delete require.cache[require.resolve(path.join(sync, 'ProjectBootstrap'))];
  const restarted = require(path.join(sync, 'ProjectBootstrap'));
  const resumed = restarted.createProject(input('resume'));
  assert.equal(resumed.id, interrupted.id, 'restart resumes the durable operation');
  assert.equal((await wait(resumed)).state, 'complete');
  const application = await wait(bootstrap.createProject({...input('reactapp'), template: 'react'}));
  assert.equal(application.state, 'complete');
  assert.equal(application.repository.initialPipeline.id, 123);
  assert.equal(application.repository.deploymentState, 'pipeline-started');
  child = spawn(process.execPath, [path.join(sync, 'index.js')], {cwd: path.join(root, 'sync'),
    env: {...process.env, SYNC_USER: 'test', SYNC_PASS: 'test-password'}, stdio: 'ignore'});
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await request('/status'); break; } catch (_) { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal((await request('/projects/namespaces')).status, 401);
  assert.equal((await request('/projects', null, input('unauthorized'))).status, 401);
  const login = await request('/login', null, {username: 'test', password: 'test-password'});
  const token = login.data.accessToken;
  assert.equal((await request('/projects/availability?projectKey=A&namespaceId=1', token)).status, 400);
  assert.equal((await request('/projects', token, input('Bad'))).status, 400);
  const accepted = await request('/projects', token, input('api'));
  assert.equal(accepted.status, 202);
  assert.equal((await request('/status', token)).status, 200, 'Sync remains responsive');
  assert.equal((await request('/config/main', token, {})).status, 409, 'Push cannot race provisioning');
  let job;
  do { await new Promise(resolve => setTimeout(resolve, 50)); job = await request('/projects/jobs/' + accepted.data.id, token); } while (job.data.state === 'running');
  assert.equal(job.data.state, 'complete');
  const fetched = await request('/config/projects', token);
  const project = fetched.data.find(file => file.filename === '.api.env');
  assert.equal(project.repository.id, 42);
  assert.equal(project.data.substr(807, 1), '$');
  assert.equal(require('crypto').createHash('md5').update(project.data.substr(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
  console.log('Project bootstrap validation, idempotency, namespace conflict, race, authentication, polling and Fetch tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (child) child.kill(); fs.rmdirSync(root, {recursive: true}); });
