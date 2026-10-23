#!/usr/bin/env node
'use strict';

// Explicit tiny local-Docker acceptance of the cold control-plane stop primitive.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {setTimeout: sleep} = require('node:timers/promises');

const IMAGE = 'node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f';

function command(args) {
  return execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 45000,
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
  let owned = false;
  try {
    // Do not silently pull a different or moving test base.
    command(['image', 'inspect', IMAGE]);
    command(['run', '-d', '--name', name, '--label', 'org.system-bootstrapper.pause-test=' + operation,
      '--network', 'none', '--read-only', '--memory', '64m', '--cpus', '0.1', '--pids-limit', '16',
      '--restart', 'always', '--entrypoint', '/bin/sh', IMAGE,
      '-c', 'while :; do printf "heartbeat\\n"; sleep 0.05; done']);
    owned = true;
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
    console.log(JSON.stringify({
      passed: true,
      engine: command(['version', '--format', '{{.Server.Version}}']).toString().trim(),
      pausedHeartbeatFrozen: true,
      killedWithoutExplicitUnpause: true,
      restartPolicyDisabled: true,
      oldCodeDidNotResumeOrRestart: true,
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
