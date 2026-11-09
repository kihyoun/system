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
assert(policy.ignorePaths.includes('wizard/**'));
assert(policy.ignorePaths.includes('**/security-release.json'));
const custom = policy.customManagers[0];
assert.equal(custom.managerFilePatterns[0], '/^system/Dockerfile$/');
const pin = fs.readFileSync(path.join(root, 'system/Dockerfile'), 'utf8');
const matches = [...pin.matchAll(new RegExp(custom.matchStrings[0], 'g'))];
assert.equal(matches.length, 1, 'custom manager extracts only the supported ARG pin');
assert.equal(matches[0].groups.depName, 'node');
assert.match(matches[0].groups.currentDigest, /^sha256:[a-f0-9]{64}$/);
for (const [index, files] of [[1, ['gitlab-runner/register.sh']], [2, ['project-bootstrap/wizard-build/modern/build.sh', 'project-bootstrap/wizard-build/modern/verify.sh']]]) {
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
  for (const repos of ['[]', '["example/system"]', '["example/system","example/system"]', '["example/system","https://unexpected.example/repo"]']) {
    delete require.cache[require.resolve(globalPath)];
    process.env.RENOVATE_REPOSITORIES = repos;
    assert.throws(() => require(globalPath), /exactly/);
  }
} finally {
  for (const key of ['CI_API_V4_URL','RENOVATE_TOKEN','RENOVATE_REPOSITORIES']) {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
}
console.log('PASS: explicit repository allowlist, approval safety policy and supported custom pin extraction');
