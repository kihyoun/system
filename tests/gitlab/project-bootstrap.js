// Isolated contract tests: real Sync operations, disposable files and a Docker
// transport double. The separate live test exercises the real Rails/API bridge.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const vm = require('vm');
const {spawn} = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-'));
const sync = path.resolve(__dirname, '../../sync/dist');
fs.mkdirSync(path.join(root, 'sync'));
fs.mkdirSync(path.join(root, 'bin'));
fs.mkdirSync(path.join(root, 'project-bootstrap'));
fs.writeFileSync(path.join(root, 'project-bootstrap/apply.sh'), 'exit 0\n');
const mock = `#!${process.execPath}
let text = ''; process.stdin.on('data', chunk => text += chunk);
process.stdin.on('end', () => {
 const input = JSON.parse(Buffer.from(/BOOTSTRAPPER_INPUT = '([^']+)'/.exec(text)[1], 'base64'));
 require('fs').appendFileSync(${JSON.stringify(path.join(root, 'docker-requests.jsonl'))}, JSON.stringify(input) + '\\n');
 const result = input.action === 'pipeline' ? {pipeline: {id: 123, webUrl: 'http://gitlab.localhost/pipeline', status: 'pending'}} :
 input.action === 'namespaces' ? {namespaces: [{id: 1, path: 'root'}]} :
 input.action === 'availability' ? {availability: input.projectKey === 'occupied' ? 'occupied' : 'available'} :
 input.projectKey === 'race' ? {state: 'failed', conflict: true, message: 'Repository already exists'} :
 {repository: {id: 42, namespaceId: Number(input.namespaceId), path: 'root/' + input.projectKey, defaultBranch: 'main', webUrl: 'http://gitlab.localhost/root/' + input.projectKey}};
 setTimeout(() => console.log(JSON.stringify(result)), 100);
});
`;
fs.writeFileSync(path.join(root, 'bin/docker'), mock, {mode: 0o755});
process.env.PATH = path.join(root, 'bin') + ':' + process.env.PATH;
process.chdir(path.join(root, 'sync'));
const bootstrap = require(path.join(sync, 'ProjectBootstrap'));
const logo = require(path.join(sync, 'Helper')).default.textLogo;
// Use the exact pinned Wizard Fetch parser and ProjectConfig serializer. Only
// browser/storage dependencies and MobX observation are inert in this fixture.
const snapshot = require('../../project-bootstrap/wizard-source/package').validate(JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../project-bootstrap/wizard-source/snapshot.json'), 'utf8')));
const ts = require('../../sync/node_modules/typescript');
const wizardModules = new Map();
const wizardStubs = {
  'file-saver': {}, jszip: {}, mobx: {makeAutoObservable: () => {}, observable: value => value, runInAction: operation => operation()},
  uuid: {v4: () => 'fixture-wizard'}, md5: {__esModule: true, default: require('../../sync/node_modules/md5')},
  './MainConfig': {__esModule: true, default: class {}}, './SyncServer': {__esModule: true, default: class {}}, './Recovery': {}, './PreviewSetupIntent': {}
};
function wizardModule(name) {
  if (wizardModules.has(name)) return wizardModules.get(name);
  const entry = snapshot.files.find(file => file.path === 'src/api/' + name + '.tsx' || file.path === 'src/api/' + name + '.ts');
  assert(entry, 'Pinned Wizard model source is required: ' + name);
  const exports = {}; wizardModules.set(name, exports);
  const compiled = ts.transpileModule(Buffer.from(entry.content, 'base64').toString('utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  vm.runInNewContext(compiled, {exports, require: dependency => {
    if (Object.hasOwn(wizardStubs, dependency)) return wizardStubs[dependency];
    assert(/^\.\/(Main|ProjectConfig|Environment|Helper)$/.test(dependency), 'Unexpected Wizard dependency: ' + dependency);
    return wizardModule(dependency.slice(2));
  }});
  return exports;
}
const WizardMain = wizardModule('Main').default;
const WizardProject = wizardModule('ProjectConfig').default;
const wizardInput = project => ({projectKey: project.projectKey, namespaceId: project.namespaceId,
  template: project.template, data: project.content, ci: project.gitlabCi});
const fetchedWizardProject = (data, receipt) => {
  const main = new WizardMain(); main.importProjectEnvData(data);
  const project = main.projects.get('resume');
  project.repository = receipt.repository;
  project.namespaceId = project.repository.namespaceId;
  project.bootstrapPending = receipt.state !== 'complete'; project.template = receipt.template;
  return project;
};
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
  assert.throws(() => bootstrap.createProject({...data, ci: '# changed CI_DEFAULT_BRANCH\n'}), /already exists locally/);
  const receipt = bootstrap.readReceipt(fs.readFileSync(path.join(root, 'system/.projects.env/.example.env'), 'utf8'));
  assert.equal(receipt.repository.id, 42);
  assert.equal(receipt.repository.defaultBranch, 'main');
  assert.equal((await wait(bootstrap.createProject(input('race')))).state, 'failed');
  assert(!fs.existsSync(path.join(root, 'system/.projects.env/.race.env')), 'collision does not claim foreign repository locally');
  assert.equal((await wait(bootstrap.queryGitlab({action: 'availability', projectKey: 'occupied', namespaceId: 1}))).availability, 'occupied');
  fs.writeFileSync(path.join(root, 'project-bootstrap/apply.sh'), 'exit 1\n');
  const model = new WizardProject(new WizardMain(), {projectKey: 'resume', namespaceId: '1', template: 'angular',
    useProdHost: 'false', useBetaHost: 'false', useReviewHost: 'false', prodDomainMode: 0, betaDomainMode: 0,
    reviewDomainMode: 1, prodDeployMode: 1, betaDeployMode: 1, reviewDeployMode: 1, gitlabRunnerToken: 'fixture', gitlabRunnerScale: 1});
  const original = wizardInput(model);
  const interrupted = bootstrap.createProject(original);
  assert.equal((await wait(interrupted)).state, 'failed');
  const resumeFile = path.join(root, 'system/.projects.env/.resume.env');
  const pending = bootstrap.readReceipt(fs.readFileSync(resumeFile, 'utf8'));
  assert.equal(pending.state, 'pending'); assert.equal(pending.repository.id, 42);
  const fetchedModel = fetchedWizardProject(fs.readFileSync(resumeFile, 'utf8'), pending);
  const saved = wizardInput(fetchedModel);
  assert(saved.data.indexOf('# BOOTSTRAPPER_PROJECT=') < saved.data.indexOf('# created on '));
  assert.equal(saved.data.slice(0, 1184), logo.slice(0, 1184));
  assert.throws(() => bootstrap.createProject({...saved, namespaceId: '2'}), /already exists locally/);
  assert.throws(() => bootstrap.createProject({...saved, data: saved.data.replace('GITLAB_RUNNER_SCALE="1"', 'GITLAB_RUNNER_SCALE="2"')}), /already exists locally/);
  assert.throws(() => bootstrap.createProject({...saved, template: 'react', data: saved.data.replace('PROJECT_TEMPLATE="angular"', 'PROJECT_TEMPLATE="react"')}), /already exists locally/);
  fs.writeFileSync(path.join(root, 'project-bootstrap/apply.sh'), 'exit 0\n');
  delete require.cache[require.resolve(path.join(sync, 'ProjectBootstrap'))];
  const restarted = require(path.join(sync, 'ProjectBootstrap'));
  const resumed = restarted.createProject({...saved, resumeRepository: {id: 999}});
  assert.equal(resumed.id, interrupted.id, 'restart resumes the durable operation');
  assert.equal((await wait(resumed)).state, 'complete');
  const completedData = fs.readFileSync(resumeFile, 'utf8');
  const completed = restarted.readReceipt(completedData);
  assert.equal(completed.fingerprint, pending.fingerprint, 'unchanged Wizard serialization preserves the original fingerprint');
  assert.equal(completed.operation, pending.operation); assert.equal(completed.repository.id, pending.repository.id);
  assert.equal(completed.state, 'complete');
  assert.equal(completedData.split('\n').filter(line => line.startsWith('# BOOTSTRAPPER_PROJECT=')).length, 1);
  const forged = Buffer.from(JSON.stringify({...pending, operation: 'f'.repeat(48), state: 'complete', repository: {id: 999}})).toString('base64');
  const hostileRetry = {...saved, data: saved.data.replace(/^# BOOTSTRAPPER_PROJECT=.*$/m, '# BOOTSTRAPPER_PROJECT=' + forged), resumeRepository: {id: 999}};
  assert.equal(restarted.createProject(hostileRetry).id, pending.operation, 'client metadata cannot replace the authoritative receipt');
  assert.equal(restarted.readReceipt(fs.readFileSync(resumeFile, 'utf8')).repository.id, 42);
  const requests = fs.readFileSync(path.join(root, 'docker-requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const resumedCreates = requests.filter(request => request.action === 'create' && request.projectKey === 'resume');
  assert.equal(resumedCreates.length, 2); assert.equal(resumedCreates[1].operation, pending.operation);
  assert.deepEqual(resumedCreates[1].resumeRepository, pending.repository, 'only the retained server repository binds resumed provisioning');
  assert(!resumedCreates[1].data.includes('# BOOTSTRAPPER_PROJECT='), 'client receipt metadata is not forwarded to provisioning');
  const newForged = input('forged');
  newForged.data += '# BOOTSTRAPPER_PROJECT=' + forged + '\n'; newForged.resumeRepository = {id: 999};
  const reserved = restarted.createProject(newForged);
  const forgedFile = path.join(root, 'system/.projects.env/.forged.env');
  assert.equal(restarted.readReceipt(fs.readFileSync(forgedFile, 'utf8')).operation, reserved.id, 'initial reservation is server-owned');
  assert.equal((await wait(reserved)).state, 'complete');
  const forgedData = fs.readFileSync(forgedFile, 'utf8');
  assert.equal(restarted.readReceipt(forgedData).repository.id, 42);
  assert.equal(forgedData.split('\n').filter(line => line.startsWith('# BOOTSTRAPPER_PROJECT=')).length, 1);
  const newCreate = fs.readFileSync(path.join(root, 'docker-requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    .find(request => request.action === 'create' && request.projectKey === 'forged');
  assert(!Object.hasOwn(newCreate, 'resumeRepository'), 'new provisioning never accepts a client repository binding');
  const rewritten = path.join(root, 'receipt-rewrite.env');
  restarted.writeReceipt(rewritten, completedData + '# BOOTSTRAPPER_PROJECT=' + forged + '\n', completed);
  const rewrittenData = fs.readFileSync(rewritten, 'utf8');
  assert.equal(rewrittenData.split('\n').filter(line => line.startsWith('# BOOTSTRAPPER_PROJECT=')).length, 1);
  assert.deepEqual(restarted.readReceipt(rewrittenData), completed);
  assert.equal(rewrittenData.slice(0, 1184), original.data.slice(0, 1184));
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
