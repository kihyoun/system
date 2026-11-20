#!/usr/bin/env node
'use strict';

// Explicit tiny local-Docker acceptance of cold stop and never-started rollback.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {join} = require('node:path');
const {setTimeout: sleep} = require('node:timers/promises');
const {replaceController} = require('../e2e/public-upgrade');

const IMAGE = 'node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f';

function command(args, {input, env} = {}) {
  return execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    input, env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout: 45000,
  });
}

function inspect(name) {
  return JSON.parse(command(['inspect', name]).toString())[0];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node tests/bootstrapper/paused-controller-docker.js --allow-local-daemon\n' +
      'Explicitly permit one labeled disposable container on the local Docker socket.');
    return;
  }
  assert.deepEqual(args, ['--allow-local-daemon'],
    'Explicit --allow-local-daemon is required to use the local Docker socket.');
  const operation = randomUUID().replaceAll('-', '');
  const name = 'system-paused-controller-test-' + operation;
  const project = 'system-paused-test-' + operation;
  const compose = ['compose', '--compatibility', '--env-file', '/dev/null', '-p', project, '-f', '-'];
  const heartbeatCommand = 'trap "exit 0" TERM INT; while :; do printf "heartbeat\\n"; sleep 0.05; done';
  const fixture = JSON.stringify({services: {bootstrapper: {
    image: IMAGE, container_name: name,
    labels: {'org.system-bootstrapper.pause-test': operation},
    network_mode: 'none', read_only: true, mem_limit: '64m', cpus: 0.1, pids_limit: 16,
    restart: 'always', entrypoint: '/bin/sh',
    command: ['-c', heartbeatCommand],
  }}});
  let owned = false;
  try {
    // Do not silently pull a different or moving test base.
    command(['image', 'inspect', IMAGE]);
    // Omitting dependency traversal control is safe only while the actual
    // controller service has no Compose dependencies. Config does not create
    // resources or inspect any operator's saved configuration.
    const actual = JSON.parse(command(['compose', '--env-file', '/dev/null', '-p', project,
      '-f', join(__dirname, '../../system/docker-compose.yml'), 'config', '--format', 'json'], {
      env: {...process.env, PERSISTENT_DIR: '/system-paused-test-unmounted'},
    }).toString());
    assert.deepEqual(Object.keys(actual.services.bootstrapper.depends_on || {}), []);
    command([...compose, 'create', '--no-build', '--pull', 'never', 'bootstrapper'], {input: fixture});
    owned = true;
    assert.equal(inspect(name).State.Status, 'created');
    command(['start', name]);
    await sleep(300);
    const before = inspect(name);
    assert.equal(before.HostConfig.RestartPolicy.Name, 'always');
    assert.equal(before.State.Running, true);
    assert.ok(command(['logs', name]).length);
    command(['update', '--restart=no', name]);
    command(['pause', name]);
    const frozen = inspect(name);
    assert.equal(frozen.State.Paused, true);
    assert.equal(frozen.State.Running, true);
    const heartbeat = command(['logs', name]);
    await sleep(300);
    assert.deepEqual(command(['logs', name]), heartbeat);
    // SIGKILL is delivered to the frozen process before any daemon thaw.
    // Never explicitly unpause the old controller and allow old code to run.
    command(['kill', name]);
    const stopped = inspect(name);
    assert.equal(stopped.State.Running, false);
    assert.equal(stopped.State.Paused, false);
    assert.equal(stopped.State.ExitCode, 137);
    assert.equal(stopped.State.OOMKilled, false);
    assert.equal(stopped.HostConfig.RestartPolicy.Name, 'no');
    assert.ok(stopped.ExecIDs == null || stopped.ExecIDs.length === 0);
    await sleep(500);
    const final = inspect(name);
    assert.equal(final.State.Running, false);
    assert.equal(final.RestartCount, before.RestartCount);
    assert.deepEqual(command(['logs', name]), heartbeat);
    // Exercise the native Compose create CLI used by stopped rollback. Unlike
    // `up`, it must replace the container without ever executing the old code.
    // Reuse this fixture's one owned container, with no networks or volumes.
    command([...compose, 'create', '--force-recreate', '--no-build', '--pull', 'never', 'bootstrapper'],
      {input: fixture});
    const created = inspect(name);
    assert.notEqual(created.Id, stopped.Id);
    assert.equal(created.State.Status, 'created');
    assert.equal(created.State.Pid, 0);
    assert.equal(created.State.Running, false);
    assert.equal(created.Config.Labels['com.docker.compose.project'], project);
    assert.equal(created.Config.Labels['com.docker.compose.service'], 'bootstrapper');
    command(['update', '--restart=no', name]);
    await sleep(300);
    const retained = inspect(name);
    assert.equal(retained.State.Status, 'created');
    assert.equal(retained.State.Pid, 0);
    assert.equal(retained.State.Running, false);
    assert.equal(retained.HostConfig.RestartPolicy.Name, 'no');
    assert.equal(retained.RestartCount, 0);
    assert.equal(command(['logs', name]).length, 0);
    // Use the real fixture replacement with the restored platform's missing
    // Compose metadata. Adapt only its fixed candidate identity and tiny CMD.
    const candidate = {inner: async input => {
      const args = input.map(value => value === 'system_bootstrapper_1' ? name :
        value === 'com.docker.compose.project=system' ? 'com.docker.compose.project=' + project : value);
      if (args[0] === 'create') {
        args.splice(1, 0, '--label', 'org.system-bootstrapper.pause-test=' + operation,
          '--network', 'none', '--read-only', '--memory', '64m', '--cpus', '0.1', '--pids-limit', '16',
          '--entrypoint', '/bin/sh');
        args.push('-c', heartbeatCommand);
      }
      return command(args).toString();
    }};
    const restored = structuredClone(retained);
    delete restored.Config.Labels;
    await replaceController(candidate, restored, IMAGE);
    const replaced = inspect(name);
    assert.equal(replaced.State.Running, true);
    assert.match(replaced.Config.Labels['com.docker.compose.config-hash'], /^[a-f0-9]{64}$/);
    assert.equal(replaced.Config.Labels['com.docker.compose.container-number'], '1');
    assert.equal(replaced.Config.Labels['com.docker.compose.image'], undefined);
    command([...compose, 'up', '--no-build', '--no-deps', '--pull', 'never', '-d', 'bootstrapper'], {input: fixture});
    const upgraded = inspect(name);
    assert.notEqual(upgraded.Id, replaced.Id);
    assert.equal(upgraded.State.Running, true);
    assert.notEqual(upgraded.Config.Labels['com.docker.compose.config-hash'], replaced.Config.Labels['com.docker.compose.config-hash']);
    // The final reset also retains discovery while discarding stale image IDs.
    await replaceController(candidate, retained, IMAGE);
    const reset = inspect(name);
    assert.equal(reset.State.Running, true);
    assert.equal(reset.Config.Labels['com.docker.compose.config-hash'], retained.Config.Labels['com.docker.compose.config-hash']);
    assert.equal(reset.Config.Labels['com.docker.compose.image'], undefined);
    command([...compose, 'up', '--no-build', '--no-deps', '--pull', 'never', '-d', 'bootstrapper'], {input: fixture});
    assert.notEqual(inspect(name).Id, reset.Id);
    assert.equal(inspect(name).State.Running, true);
    console.log(JSON.stringify({
      passed: true,
      engine: command(['version', '--format', '{{.Server.Version}}']).toString().trim(),
      pausedHeartbeatFrozen: true,
      killedWithoutExplicitUnpause: true,
      restartPolicyDisabled: true,
      oldCodeDidNotResumeOrRestart: true,
      composeCreateRollbackNeverStarted: true,
      manualReplacementDiscoveredAndRecreated: true,
      finalResetDiscoveredAndRecreated: true,
    }));
  } finally {
    if (owned) {
      const current = inspect(name);
      assert.equal(current.Config.Labels?.['org.system-bootstrapper.pause-test'], operation,
        'Refusing to clean a container with changed ownership.');
      command(['rm', '--force', name]);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
