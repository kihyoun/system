// Explicit acceptance against a candidate controller using a copied configuration.
// This imports managed source and enables its CI, but never calls deployment APIs.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');

assert.equal(process.env.SYSTEM_WIZARD_LIVE_ACCEPTANCE, 'true', 'Explicit live acceptance opt-in required');
const expectedProject = Number(process.env.SYSTEM_WIZARD_EXPECTED_PROJECT);
assert(Number.isSafeInteger(expectedProject) && expectedProject > 0, 'Set the intended managed project ID');
let token;
let refreshToken;
let refreshAt = 0;
const deadline = Date.now() + 65 * 60 * 1000;
function rawRequest(method, route, data) {
  assert(Date.now() < deadline, 'Managed Wizard acceptance exceeded its overall time budget');
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : undefined;
    const req = http.request({hostname: '127.0.0.1', port: 8071, method, path: route,
      headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}}, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        if (![200, 202].includes(response.statusCode)) {
          const error = new Error('Acceptance request failed: ' + method + ' ' + route + ' HTTP ' + response.statusCode);
          error.statusCode = response.statusCode;
          reject(error);
          return;
        }
        try { resolve(JSON.parse(text)); } catch (_) { reject(new Error('Invalid acceptance response')); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('Acceptance HTTP timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
async function renew() {
  assert(refreshToken, 'Acceptance refresh credential is missing');
  const session = await rawRequest('POST', '/token', {token: refreshToken});
  assert(session.accessToken, 'Acceptance token refresh failed');
  token = session.accessToken;
  // Sync grants twenty-minute tokens. Refresh before dispatch at eighteen
  // minutes, including before mutations; never replay a mutating request.
  refreshAt = Date.now() + 18 * 60 * 1000;
}
async function request(method, route, data) {
  if (token && Date.now() >= refreshAt) await renew();
  try { return await rawRequest(method, route, data); }
  catch (error) {
    if (method !== 'GET' || error.statusCode !== 401) throw error;
    // A read can be retried once after clock drift/expiry; source/build POSTs
    // may already have committed durable state and must never be retried here.
    await renew();
    return rawRequest(method, route, data);
  }
}
const sleep = () => new Promise(resolve => setTimeout(resolve, 2000));
function signature(text) {
  assert.equal(text[807], '$');
  assert.equal(crypto.createHash('md5').update(text.slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
}
async function finish(job) {
  for (let attempt = 0; job.state === 'running' && attempt < 180; attempt++) {
    await sleep();
    job = await request('GET', '/projects/jobs/' + job.id);
  }
  assert.equal(job.state, 'complete', 'Controller operation did not complete successfully');
  return job;
}
async function project() {
  const projects = await request('GET', '/config/projects');
  assert.equal(projects[0].filename, '.wizard.env');
  const wizard = projects[0];
  assert.equal(wizard.repository.id, expectedProject);
  assert.equal(wizard.repository.systemProject, true);
  signature(wizard.data);
  return wizard;
}
(async () => {
  const login = await request('POST', '/login', {username: process.env.SYNC_USER, password: process.env.SYNC_PASS});
  token = login.accessToken;
  refreshToken = login.refreshToken;
  assert(token && refreshToken);
  refreshAt = Date.now() + 18 * 60 * 1000;
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    const status = await request('GET', '/status');
    if (!status.defaultWizardSetupInProgress) { ready = true; break; }
    await sleep();
  }
  assert(ready, 'Candidate controller startup timed out');
  signature((await request('GET', '/config/main')).data);
  const before = await project();
  const production = before.data.match(/^PROD_HOST="([^"]+)"/m)?.[1];
  assert(production, 'Managed Production address is missing');
  const preview = await request('GET', '/projects/wizard/source');
  assert.equal(preview.repository.id, expectedProject);
  let imported;
  if (preview.workflow?.phase === 'source-imported') {
    // A resumed run may already have installed managed CI. Reimport would
    // correctly fail its source-scaffold guard; retain the existing receipt.
    imported = {workflow: preview.workflow};
  } else {
    imported = await finish(await request('POST', '/projects/wizard/source', {manifestHash: preview.manifestHash}));
    assert.equal(imported.workflow.phase, 'source-imported');
    const repeated = await finish(await request('POST', '/projects/wizard/source', {manifestHash: preview.manifestHash}));
    assert.equal(repeated.workflow.importCommit, imported.workflow.importCommit);
  }
  const buildPreview = await request('GET', '/projects/wizard/build');
  assert.equal(buildPreview.repository.id, expectedProject);
  let result = await finish(await request('POST', '/projects/wizard/build', {recipeHash: buildPreview.recipeHash}));
  while (Date.now() < deadline) {
    assert(result.build, 'Build receipt is missing');
    if (result.build.phase === 'candidate-verified') break;
    assert(!['checks-failed', 'verification-failed', 'requires-reconciliation'].includes(result.build.phase),
      'Managed build requires investigation: ' + result.build.phase);
    await sleep();
    result = await finish(await request('GET', '/projects/wizard/build/status'));
  }
  assert.equal(result.build.phase, 'candidate-verified', 'Managed pipeline did not verify its candidate');
  const pipelineId = result.build.pipeline.id;
  const again = await finish(await request('POST', '/projects/wizard/build', {recipeHash: buildPreview.recipeHash}));
  assert.equal(again.build.pipeline.id, pipelineId, 'Repeated activation created a different initial pipeline');
  assert.equal(again.build.artifact.imageRef, result.build.artifact.imageRef);
  const after = await project();
  assert.equal(after.repository.id, before.repository.id);
  assert.equal(after.data.match(/^PROD_HOST="([^"]+)"/m)?.[1], production);
  signature((await request('GET', '/config/main')).data);
  fs.writeFileSync('/tmp/wizard-build-live-evidence.json', JSON.stringify({projectId: expectedProject,
    sourceRevision: preview.sourceRevision, importCommit: imported.workflow.importCommit,
    recipeHash: buildPreview.recipeHash, build: again.build, unchangedProductionAddress: true}, null, 2), {mode: 0o600});
  console.log('Managed Wizard acceptance passed: stable source import, real pipeline/checks/digest, repeat activation, Fetch signature and Production address.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
