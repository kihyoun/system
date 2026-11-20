const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'renovate.json')));
assert.equal(policy.dependencyDashboardApproval, true);
assert.equal(policy.automerge, false);
assert.equal(policy.ignoreUnstable, true);
assert(policy.enabledManagers.includes('npm'));
assert(policy.enabledManagers.includes('custom.regex'));
assert(!policy.ignorePaths.includes('wizard/**'), 'embedded Wizard dependencies must be discovered');
assert(policy.ignorePaths.includes('**/security-release.json'));
const custom = policy.customManagers[0];
assert.equal(custom.managerFilePatterns[0], '/^system/Dockerfile$/');
const pin = fs.readFileSync(path.join(root, 'system/Dockerfile'), 'utf8');
const matches = [...pin.matchAll(new RegExp(custom.matchStrings[0], 'g'))];
assert.equal(matches.length, 1, 'custom manager extracts only the supported ARG pin');
assert.equal(matches[0].groups.depName, 'node');
assert.match(matches[0].groups.currentDigest, /^sha256:[a-f0-9]{64}$/);
for (const [index, files] of [[1, ['operations/src/lifecycle/runner.service.ts']], [2, ['project-bootstrap/wizard-build/modern/build.sh', 'project-bootstrap/wizard-build/modern/verify.sh']]]) {
  const manager = policy.customManagers[index];
  for (const file of files) {
    assert(new RegExp(manager.managerFilePatterns[0].slice(1, -1)).test(file));
    const extracted = [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(new RegExp(manager.matchStrings[0], 'g'))];
    assert.equal(extracted.length, 1, file + ' has one supported custom image pin');
    assert.match(extracted[0].groups.currentDigest, /^sha256:[a-f0-9]{64}$/);
  }
}
const globalPath = path.join(root, 'gitlab/renovate/config.cjs');
const original = {...process.env};
try {
  process.env.CI_API_V4_URL = 'https://gitlab.example.com/api/v4';
  process.env.RENOVATE_TOKEN = 'fixture-token';
  process.env.RENOVATE_REPOSITORIES = '["example/system","example/wizard"]';
  const config = require(globalPath);
  assert.deepEqual(config.repositories, ['example/system', 'example/wizard']);
  assert.equal(config.autodiscover, false);
  assert.equal(config.onboarding, false);
  assert.equal(config.requireConfig, 'required');
  assert.equal(config.force.dependencyDashboardApproval, true);
  assert.equal(config.force.automerge, false);
  assert.equal(config.force.platformAutomerge, false);
  assert.equal(config.allowScripts, false);
  assert.deepEqual(config.allowedCommands, []);
  delete require.cache[require.resolve(globalPath)];
  process.env.RENOVATE_REPOSITORIES = '["example/system"]';
  assert.deepEqual(require(globalPath).repositories, ['example/system']);
  for (const repos of ['[]', '{}', 'null', '["example/system","example/wizard","example/other"]', '["example/system","example/system"]', '["example/system","https://unexpected.example/repo"]']) {
    delete require.cache[require.resolve(globalPath)];
    process.env.RENOVATE_REPOSITORIES = repos;
    assert.throws(() => require(globalPath), /must select/);
  }
} finally {
  for (const key of ['CI_API_V4_URL','RENOVATE_TOKEN','RENOVATE_REPOSITORIES']) {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
}
console.log('PASS: explicit repository allowlist, approval safety policy and supported custom pin extraction');

// Consolidated former Python discovery checks use the same native service as CLI.
(async () => {
  const {RenovateVerificationService} = require('../../operations/dist/renovate/verification.service');
  const {RenovateModule} = require('../../operations/dist/renovate/renovate.module');
  const {NestFactory} = require('../../operations/node_modules/@nestjs/core');
  const app = await NestFactory.createApplicationContext(RenovateModule, {logger:false});
  try {
    const service = app.get(RenovateVerificationService);
    let changed = false, extraJob = false;
    const api = {
      async all(route) {
        if (route.includes('/repository/branches')) return [{name:'main'}, ...(changed ? [{name:'renovate/unapproved'}] : [])];
        if (route.includes('/merge_requests?')) return [];
        if (route.includes('/issues?')) return [{title:'Dependency Dashboard',author:{id:9},iid:1}];
        if (route.endsWith('/jobs')) return [{name:'renovate:discover',status:'success'}, ...(extraJob ? [{name:'test:isolated',status:'success'}] : [])];
        throw Error('Unexpected read route');
      },
      async get() { return {last_pipeline:{id:42,status:'success'}}; },
    };
    const config = {project_ids:[10,11]}, state = {user_id:9,schedule_id:3};
    const baseline = {project_ids:[10,11],user_id:9,inventory:await service.inventory(api,[10,11])};
    assert.equal((await service.verify(api,config,state,baseline)).discovery,'dashboard-only');
    changed = true;
    await assert.rejects(service.verify(api,config,state,baseline),/inventories changed/);
    changed = false; extraJob = true;
    await assert.rejects(service.verify(api,config,state,baseline),/unexpected/);
    await assert.rejects(service.verify(api,config,state,{...baseline,user_id:99}),/another bot/);
    console.log('PASS: shared Nest discovery verifies dashboard-only run and rejects unrelated inventories/jobs');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
