'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {run, request, WORK_BUDGET, CLEANUP_BUDGET} = require('../../project-bootstrap/system-review/run');
const {environmentHash} = require('../../project-bootstrap/system-review/binding');
const copy = value => JSON.parse(JSON.stringify(value));
const image = char => 'sha256:' + char.repeat(64);
const operation = 'a'.repeat(48), sourceCommit = 'b'.repeat(40), containerId = 'c'.repeat(64);
const environment = {version: 1, phase: 'ready', managementMode: 'source-primary', operation,
  helperImage: image('d'), controller: 'system_bootstrapper_1', settings: {review: {enabled: true, host: 'review.example.test'}}, deployments: {}};
const binding = {version: 1, operation, projectId: 4, namespaceId: 6, projectPath: 'example/system', defaultBranch: 'master',
  mrIid: 19, pipelineId: 140, candidateJobId: 806, sourceCommit, helperImage: image('e'), wizardImageId: image('f'),
  wizardRevision: '1'.repeat(40), wizardProjectId: 5, wizardProjectPath: 'example/wizard', wizardDefaultBranch: 'master',
  wizardImageRef: 'registry.example.test/example/system/successor-wizard@' + image('2'), environmentHash: environmentHash(environment)};
const context = {systemReviewBinding: binding, receipt: {repository: {id: 5, namespaceId: 6, path: 'example/wizard', defaultBranch: 'master'},
  wizardWorkflow: {environments: environment}}};
const release = {sourceRevision: sourceCommit, projectId: 4, pipelineId: 140, imageId: binding.helperImage,
  registryReference: 'registry.example.test/example/system/successor@' + image('3'), wizardRegistryReference: binding.wizardImageRef};
const env = {CI_PROJECT_ID: '4', CI_PIPELINE_ID: '140', CI_JOB_ID: '808', CI_MERGE_REQUEST_IID: '19', CI_COMMIT_SHA: sourceCommit,
  SYSTEM_REVIEW_OPERATION: operation, WIZARD_REVIEW_HOST: 'review.example.test', CI_REGISTRY: 'registry.example.test',
  CI_REGISTRY_IMAGE: 'registry.example.test/example/system', CI_REGISTRY_USER: 'job-user', CI_REGISTRY_PASSWORD: 'private-fixture-password'};
let checks = 0;

async function exercise(scenario = {}, action = 'deploy') {
  const calls = [], directories = new Set(), listeners = ['SIGTERM', 'SIGINT'].map(signal => process.listeners(signal));
  let runtime, elapsed = 0;
  class FakeRuntime {
    constructor(selected) {
      runtime = this; this.request = selected; this.helperName = 'wizard-environment-4-808';
      this.created = false; this.cancelled = false; this.pulls = 0;
      assert.deepEqual(selected, request(action, {...env, ...scenario.env}));
    }
    async canonical(command) {
      calls.push({kind: 'canonical', command}); assert.equal(command, 'read');
      const value = copy(context); if (scenario.context) scenario.context(value);
      return value;
    }
    async inspected(name, type = 'container', cleanup = false) {
      calls.push({kind: 'inspected', name, type, cleanup});
      assert.equal(name, this.helperName); assert.equal(type, 'container');
      if (!cleanup) return scenario.preexisting ? {image: image('0'), labels: {'system.wizard.environments.helper': 'foreign'}} : null;
      if (!this.created) return null;
      return {image: scenario.foreignRecovery ? image('0') : binding.helperImage,
        labels: {'system.wizard.environments.helper': scenario.foreignRecovery ? 'foreign' : operation}};
    }
    async json(args, input = '', options = {}) {
      calls.push({kind: 'json', args, input, options}); this.bounded(options);
      if (args[0] === 'image') {
        assert.deepEqual(args, ['image', 'inspect', binding.helperImage]);
        return [{Id: scenario.wrongHelperImage ? image('0') : binding.helperImage}];
      }
      assert.equal(args[0], 'container'); assert.equal(args[1], 'inspect');
      assert([containerId, this.helperName].includes(args[2]), 'Inspect only the exact helper name or full ID');
      assert.equal(options.cleanup, true); assert.equal(options.timeout, 15000);
      return [{Id: scenario.changedId ? '0'.repeat(64) : containerId,
        Image: scenario.changedImage ? image('0') : binding.helperImage,
        Config: {Labels: {'system.wizard.environments.helper': scenario.changedOwner ? 'foreign' : operation}}}];
    }
    bounded(options) {
      const timeout = options.timeout === undefined ? 180000 : options.timeout;
      assert(Number.isFinite(timeout) && timeout > 0 && timeout <= 480000, 'Every Docker operation needs a finite timeout');
    }
    cancel() { this.cancelled = true; calls.push({kind: 'cancel'}); }
    async command(args, input = '', options = {}) {
      calls.push({kind: 'command', args, input, options}); this.bounded(options);
      let command = args;
      if (args[0] === '--config') {
        const directory = args[1]; directories.add(directory);
        assert(fs.statSync(directory).isDirectory()); assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
        command = args.slice(2);
        if (command[0] === 'create') {
          assert.equal(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'), '{}\n');
          assert(directory.includes('system-review-client-'));
        } else assert(directory.includes('system-review-registry-'));
      }
      switch (command[0]) {
        case 'login':
          assert.equal(input, env.CI_REGISTRY_PASSWORD);
          assert.deepEqual(command, ['login', '--username', env.CI_REGISTRY_USER, '--password-stdin', env.CI_REGISTRY]);
          fs.writeFileSync(path.join(args[1], 'config.json'), JSON.stringify({auths: {fixture: input}}));
          if (scenario.failLogin) throw Error('fixture login failure');
          return '';
        case 'pull':
          assert.equal(input, ''); this.pulls += 1;
          elapsed += scenario.pullMilliseconds || 0;
          if (scenario.failPull === this.pulls) throw Error('fixture pull failure');
          return '';
        case 'create':
          assert.equal(input, ''); this.created = true;
          if (scenario.lostCreateResponse) throw Error('fixture create response lost');
          return containerId;
        case 'start':
          assert.deepEqual(command, ['start', '--attach', containerId]);
          if (scenario.signal) { process.emit(scenario.signal); assert(this.cancelled); throw Error('fixture cancellation'); }
          if (scenario.failAttach) throw Error('fixture attach failure');
          return 'fixture helper completed';
        case 'stop':
          assert.deepEqual(command, ['stop', '--time', '120', containerId]);
          assert.deepEqual(options, {cleanup: true, timeout: 130000, release: true});
          return '';
        case 'rm':
          assert.deepEqual(command, ['rm', '-f', containerId]);
          assert.deepEqual(options, {cleanup: true, timeout: 15000, release: true});
          this.created = false; return '';
        default: throw Error('Unexpected fake Docker command: ' + command[0]);
      }
    }
  }
  let error;
  const makeDirectory = fs.mkdtempSync;
  fs.mkdtempSync = function(prefix, ...options) {
    const directory = makeDirectory.call(this, prefix, ...options);
    if (String(prefix).includes('system-review-')) directories.add(directory);
    return directory;
  };
  const log = console.log; console.log = () => {};
  try {
    const options = {Runtime: FakeRuntime, now: () => elapsed};
    if (action === 'deploy') options.release = {...release, ...scenario.release};
    else Object.defineProperty(options, 'release', {get() { throw Error('Stop read a release artifact'); }});
    await run(action, {...env, ...scenario.env}, options);
  } catch (caught) { error = caught; }
  finally { console.log = log; fs.mkdtempSync = makeDirectory; }
  for (const directory of directories) assert(!fs.existsSync(directory), 'Private Docker directory survives completion: ' + directory);
  ['SIGTERM', 'SIGINT'].forEach((signal, index) => assert.deepEqual(process.listeners(signal), listeners[index], 'Signal listener leaked: ' + signal));
  for (const call of calls.filter(value => value.args)) {
    assert(!call.args.includes(env.CI_REGISTRY_PASSWORD), 'Password appeared in Docker arguments');
    const configured = call.args[0] === '--config' ? call.args.slice(2) : call.args;
    if (configured[0] !== 'login') assert(!call.input.includes(env.CI_REGISTRY_PASSWORD), 'Password crossed the login boundary');
  }
  checks += 1;
  return {calls, error, runtime, directories};
}
const commands = result => result.calls.filter(call => call.kind === 'command').map(call => ({...call,
  command: call.args[0] === '--config' ? call.args.slice(2) : call.args}));
const removals = result => commands(result).filter(call => ['stop', 'rm'].includes(call.command[0]));

(async () => {
  let result = await exercise(); assert.ifError(result.error);
  assert(WORK_BUDGET + CLEANUP_BUDGET + 120000 < 12 * 60000, 'CI script budget must reserve installation and owned cleanup.');
  result = await exercise({pullMilliseconds: 100000}); assert.ifError(result.error);
  assert.equal(commands(result).find(call => call.command[0] === 'start').options.timeout, WORK_BUDGET - 200000,
    'Attach must receive only the remaining overall work budget.');
  result = await exercise({pullMilliseconds: 200000}); assert.match(result.error.message, /reserved time budget/);
  assert(!commands(result).some(call => call.command[0] === 'create'), 'Expired preload must not create or launch a helper.');
  result = await exercise(); assert.ifError(result.error);
  const deploy = commands(result), pulls = deploy.filter(call => call.command[0] === 'pull');
  assert.deepEqual(pulls.map(call => call.command), [['pull', release.registryReference], ['pull', binding.wizardImageRef]], 'Pull exactly the two accepted digests');
  const login = deploy.find(call => call.command[0] === 'login');
  assert(pulls.every(call => call.args[1] === login.args[1]), 'Pulls must use the temporary authenticated Docker client');
  const created = deploy.find(call => call.command[0] === 'create');
  assert.notEqual(created.args[1], login.args[1], 'Helper create must use a separate empty client config');
  const args = created.command;
  for (const [flag, value] of [['--name', 'wizard-environment-4-808'], ['--network', 'none'], ['--memory', '256m'], ['--cpus', '1'], ['--pids-limit', '128'], ['--entrypoint', 'node']])
    assert.equal(args[args.indexOf(flag) + 1], value);
  assert(args.includes('--read-only')); assert(!args.some(arg => ['--env', '-e', '--env-file', '--privileged'].includes(arg)));
  assert.deepEqual(args.flatMap((arg, index) => arg === '--mount' ? [args[index + 1]] : []), [
    'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
    'type=volume,source=system_templates,target=/templates', 'type=volume,source=system_ssl,target=/ssl,readonly']);
  assert.equal(args[args.indexOf('--entrypoint') + 2], binding.helperImage);
  assert.deepEqual(removals(result).map(call => call.command[0]), ['stop', 'rm']); assert(!result.runtime.created);

  result = await exercise({env: {CI_REGISTRY: undefined, CI_REGISTRY_IMAGE: undefined, CI_REGISTRY_USER: undefined, CI_REGISTRY_PASSWORD: undefined}}, 'stop');
  assert.ifError(result.error);
  assert(!commands(result).some(call => ['login', 'pull'].includes(call.command[0])), 'Stop needs retained helper only');
  assert(commands(result).find(call => call.command[0] === 'create').command.includes('stop'));
  assert.equal(result.directories.size, 1, 'Stop creates only an empty client directory');

  for (const scenario of [{failLogin: true}, {failPull: 1}, {failPull: 2}]) {
    result = await exercise(scenario); assert(result.error);
    assert(!commands(result).some(call => call.command[0] === 'create')); assert.equal(removals(result).length, 0);
    assert.equal(result.directories.size, 1);
  }
  result = await exercise({failAttach: true}); assert.match(result.error.message, /attach failure/);
  assert.deepEqual(removals(result).map(call => call.command[0]), ['stop', 'rm']); assert(!result.runtime.created);

  result = await exercise({lostCreateResponse: true}); assert.match(result.error.message, /create response lost/);
  assert(result.calls.some(call => call.kind === 'inspected' && call.cleanup && call.name === 'wizard-environment-4-808'));
  assert(result.calls.some(call => call.kind === 'json' && call.args[2] === 'wizard-environment-4-808'));
  assert.deepEqual(removals(result).map(call => call.command), [['stop', '--time', '120', containerId], ['rm', '-f', containerId]]);
  assert(!result.runtime.created);

  result = await exercise({preexisting: true}); assert.match(result.error.message, /already exists/);
  assert(!commands(result).some(call => call.command[0] === 'create')); assert.equal(removals(result).length, 0);
  assert(!result.calls.some(call => call.kind === 'inspected' && call.cleanup), 'A preexisting name must never become a cleanup target');

  for (const scenario of [{changedOwner: true}, {changedImage: true}, {changedId: true}, {lostCreateResponse: true, foreignRecovery: true}]) {
    result = await exercise(scenario); assert.match(result.error.message, /ownership changed|another owner/);
    assert.equal(removals(result).length, 0, 'Changed ownership cannot authorize stop or removal');
  }
  result = await exercise({wrongHelperImage: true}); assert.match(result.error.message, /exact reviewed helper image/);
  assert(!commands(result).some(call => call.command[0] === 'create'));

  for (const signal of ['SIGTERM', 'SIGINT']) {
    result = await exercise({signal}); assert.match(result.error.message, /cancellation/);
    assert.equal(result.calls.filter(call => call.kind === 'cancel').length, 1);
    assert.deepEqual(removals(result).map(call => call.command[0]), ['stop', 'rm']);
  }
  for (const scenario of [{env: {WIZARD_REVIEW_HOST: 'other.example.test'}}, {release: {pipelineId: 141}},
    {release: {registryReference: 'foreign.example.test/example/system/successor@' + image('3')}}]) {
    result = await exercise(scenario); assert(result.error); assert.equal(result.directories.size, 0);
    assert.equal(commands(result).length, 0, 'Reject input before touching Docker');
  }
  assert.throws(() => request('promote', env));
  assert.throws(() => request('deploy', {...env, CI_JOB_ID: 'invalid'}));
  console.log(`System Review launcher: ${checks} scenarios passed; private two-image preload, offline helper, retained Stop, bounded owned cleanup, response loss, cancellation and credential cleanup.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
