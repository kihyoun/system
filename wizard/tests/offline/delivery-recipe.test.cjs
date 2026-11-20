const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');

const recipe = path.resolve(__dirname, '../../.system-bootstrapper/build-v1');
const revision = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const registryImage = 'registry.example.test/team/wizard';
const imageRef = `${registryImage}@sha256:${digest}`;

// Exercise the shell lifecycle without a Docker daemon, credentials or public
// network. Native CI separately builds and checks the real immutable image.
function runBuild(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-delivery-'));
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(directory, '.system-bootstrapper'), {recursive: true});
  fs.cpSync(recipe, path.join(directory, '.system-bootstrapper/build-v1'), {recursive: true});
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_COMMANDS, JSON.stringify(args) + '\\n');
if (args[0] === 'login') fs.readFileSync(0);
if (args[0] === 'inspect') console.log(process.env.TEST_IMAGE_REF);
if (args[0] === 'image' && args[1] === 'ls')
  console.log(process.env.CI_REGISTRY_IMAGE + ':wizard-' + process.env.CI_COMMIT_SHA + '-' + process.env.CI_PIPELINE_ID);
if (args[0] === 'buildx' && args[1] === 'ls')
  console.log('wizard-build-' + process.env.CI_PROJECT_ID + '-' + process.env.CI_JOB_ID);
if (args[0] === 'image' && args[1] === 'rm' && process.env.FAIL_IMAGE_CLEANUP === 'true') process.exit(42);
`);
  fs.chmodSync(path.join(bin, 'docker'), 0o700);
  const commands = path.join(directory, 'docker.jsonl');
  const result = spawnSync('sh', ['.system-bootstrapper/build-v1/build.sh'], {
    cwd: directory,
    encoding: 'utf8',
    env: {...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_COMMANDS: commands,
      CI_COMMIT_SHA: revision, CI_PIPELINE_ID: '101', CI_PROJECT_ID: '7', CI_JOB_ID: '202',
      CI_REGISTRY: 'registry.example.test', CI_REGISTRY_IMAGE: registryImage,
      CI_REGISTRY_USER: 'job-user', CI_REGISTRY_PASSWORD: 'test-only-password',
      TEST_IMAGE_REF: imageRef, ...options},
  });
  return {
    result,
    json: name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')),
    text: name => fs.readFileSync(path.join(directory, name), 'utf8'),
    commands: () => fs.existsSync(commands)
      ? fs.readFileSync(commands, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [],
    remove: () => fs.rmSync(directory, {recursive: true, force: true}),
  };
}

test('successful image build binds immutable evidence and removes only its job resources', () => {
  const run = runBuild();
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.deepEqual(run.json('build-evidence.json'), {
      version: 1, sourceCommit: revision, pipelineId: 101, imageRef,
      unitTests: true, testRunner: 'vitest', lint: true, typecheck: true, productionBuild: true,
    });
    assert.equal(run.text('image.env'), `WIZARD_IMAGE_REF=${imageRef}\n`);
    assert.deepEqual(run.json('cleanup.json'), {builder: 'wizard-build-7-202', status: 'passed'});
    const commands = run.commands();
    assert(commands.some(args => args[0] === 'push'));
    assert(commands.some(args => args.join(' ') === 'buildx rm -f wizard-build-7-202'));
    assert(commands.some(args => args.join(' ') === `image rm ${registryImage}:wizard-${revision}-101`));
    assert(!commands.some(args => args.includes('prune')));
    assert(!commands.some(args => args.includes('system_wizard_1')));
  } finally { run.remove(); }
});

test('registry output without the exact image digest fails before recording build evidence', () => {
  const run = runBuild({TEST_IMAGE_REF: 'other.example.test/team/wizard@sha256:' + digest});
  try {
    assert.notEqual(run.result.status, 0);
    assert.throws(() => run.json('build-evidence.json'), {code: 'ENOENT'});
    assert.equal(run.json('cleanup.json').status, 'passed');
  } finally { run.remove(); }
});

test('failed owned-resource cleanup fails the otherwise successful build', () => {
  const run = runBuild({FAIL_IMAGE_CLEANUP: 'true'});
  try {
    assert.notEqual(run.result.status, 0);
    assert.equal(run.json('cleanup.json').status, 'failed');
    assert.equal(run.json('build-evidence.json').sourceCommit, revision);
  } finally { run.remove(); }
});

test('an expected-commit mismatch cannot contact Docker or publish an image', () => {
  const run = runBuild({SYSTEM_WIZARD_EXPECTED_SHA: 'c'.repeat(40)});
  try {
    assert.notEqual(run.result.status, 0);
    assert.deepEqual(run.commands(), []);
    assert.throws(() => run.json('build-evidence.json'), {code: 'ENOENT'});
  } finally { run.remove(); }
});
