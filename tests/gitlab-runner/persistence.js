'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '../..');
const {definition} = require(path.join(root, 'gitlab-runner/compose'));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-persistence-'));

try {
  const persistent = path.join(fixture, 'persistent data');
  const multi = definition('runner', 2, persistent);
  assert.deepStrictEqual(Object.keys(multi.services), ['docker_1', 'docker_2']);
  assert.equal(multi.services.docker_1.container_name, 'runner_docker_1');
  assert.equal(multi.services.docker_2.container_name, 'runner_docker_2');
  const mounts = Object.values(multi.services).flatMap(service => service.volumes.slice(1));
  assert.equal(new Set(mounts.map(mount => mount.source)).size, 4);
  for (const mount of mounts) {
    assert.equal(mount.type, 'bind');
    assert(mount.source.startsWith(persistent + '/runners/runner/'));
  }
  assert.deepStrictEqual(definition('runner', 1, persistent).services.docker_1, multi.services.docker_1);
  assert.deepStrictEqual(definition('runner', 2, persistent), multi);
  assert.equal(Object.keys(definition('runner', 0, persistent).services).length, 0);
  assert.equal(Object.keys(definition('runner', 50, persistent).services).length, 50);
  assert.equal(definition('project_runner', 1, persistent).services.docker_1.container_name, 'project_runner_docker_1');
  assert.notEqual(definition('project_runner', 1, persistent).services.docker_1.volumes[1].source, multi.services.docker_1.volumes[1].source);
  for (const count of [-1, 51, '1.5', '01', 'x']) assert.throws(() => definition('runner', count, persistent));
  for (const name of ['../runner', 'runner/x', 'bad name', '']) assert.throws(() => definition(name, 1, persistent));
  for (const directory of ['', '.', 'relative', '/tmp/$HOME']) assert.throws(() => definition('runner', 1, directory));

  for (const directory of ['gitlab-runner', 'system', 'gitlab', 'bin', 'project-state']) fs.mkdirSync(path.join(fixture, directory));
  for (const name of ['start.sh', 'stop.sh', 'pool.sh', 'compose.js', 'docker-compose.yml', 'provision.js', 'provision.rb']) {
    fs.copyFileSync(path.join(root, 'gitlab-runner', name), path.join(fixture, 'gitlab-runner', name));
  }
  const log = path.join(fixture, 'compose-log.jsonl');
  fs.writeFileSync(path.join(fixture, 'bin/docker-compose'), `#!/usr/bin/env node\nconst fs=require('fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.COMPOSE_LOG, JSON.stringify({args,definition:JSON.parse(fs.readFileSync(args[args.indexOf('-f')+1],'utf8'))})+'\\n');\n`, {mode: 0o755});
  fs.writeFileSync(path.join(fixture, 'bin/docker'), '#!/bin/sh\ncat >/dev/null\nprintf \'{"token":"glrt-persisted_test"}\\n\'\n', {mode: 0o755});
  fs.writeFileSync(path.join(fixture, 'gitlab-runner/register.sh'), 'exit 0\n');
  fs.writeFileSync(path.join(fixture, 'gitlab-runner/unregister.sh'), 'exit 99\n');
  fs.writeFileSync(path.join(fixture, 'gitlab/.docker.env'), 'export GITLAB_HOST=gitlab.example.com\nexport GITLAB_REGISTRY_HOST=registry.example.com\n');
  fs.symlinkSync(path.join(fixture, 'project-state'), path.join(fixture, 'system/.projects.env'));
  fs.writeFileSync(path.join(fixture, 'project-state/.project.env'), 'PROJECT_NAME=project\nPROJECT_TEMPLATE=web\nGITLAB_RUNNER_SCALE=2\n');
  fs.writeFileSync(path.join(fixture, 'project-state/.wizard.env'), 'PROJECT_NAME=wizard\nPROJECT_TEMPLATE=wizard\nGITLAB_RUNNER_SCALE=2\n');
  const env = {...process.env, PATH: path.join(fixture, 'bin') + ':' + process.env.PATH, COMPOSE_LOG: log};
  const writeMain = scale => fs.writeFileSync(path.join(fixture, 'system/.docker.env'), `export PERSISTENT_DIR='${persistent}'\nexport GITLAB_RUNNER_SCALE=${scale}\n`);
  // Leave mktemp unmocked: run this lifecycle test in the Alpine controller
  // image as well as the component image. BusyBox rejects GNU's suffix form
  // (XXXXXXXX.json); start/stop must work with the runtime's real utility.
  const invoke = (script, argument) => {
    const result = spawnSync('bash', [script, ...(argument ? [argument] : [])], {cwd: path.join(fixture, 'gitlab-runner'), env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr + result.stdout);
  };
  writeMain(2); invoke('start.sh');
  const marker = path.join(persistent, 'runners/runner/2/config/.runner_system_id');
  fs.writeFileSync(marker, 'manager-two-stable');
  writeMain(1); invoke('start.sh', 'main');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'manager-two-stable');
  invoke('stop.sh');
  writeMain(2); invoke('start.sh', 'main');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'manager-two-stable');
  writeMain(0); invoke('start.sh', 'main');
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepStrictEqual(calls.map(call => call.args[1]), ['runner', 'project_runner', 'runner', 'runner', 'project_runner', 'runner', 'runner']);
  assert.deepStrictEqual(calls.map(call => call.args[4]), ['up', 'up', 'up', 'down', 'down', 'up', 'down']);
  assert.deepStrictEqual(Object.keys(calls[0].definition.services), ['docker_1', 'docker_2']);
  assert.deepStrictEqual(Object.keys(calls[2].definition.services), ['docker_1']);
  assert.deepStrictEqual(calls[5].definition.services, calls[0].definition.services);
  for (const call of calls) {
    assert(call.args.includes('--remove-orphans'));
    assert(!fs.existsSync(call.args[3]), 'generated temporary definition must be cleaned');
  }

  // Atomic runner-token writes must target /state rather than replace the
  // legacy main-config symlink with a new file on the controller root disk.
  const state = path.join(fixture, 'state'); fs.mkdirSync(state);
  const config = path.join(state, '.docker.env');
  const original = fs.readFileSync(path.join(root, 'system/.docker.env.example'), 'utf8');
  fs.writeFileSync(config, original);
  fs.unlinkSync(path.join(fixture, 'system/.docker.env'));
  fs.symlinkSync(config, path.join(fixture, 'system/.docker.env'));
  const provision = spawnSync(process.execPath, ['provision.js'], {cwd: path.join(fixture, 'gitlab-runner'), env: {...env, SYSTEM_CONFIG_DIR: state, GITLAB_RUNNER_TOKEN: ''}, encoding: 'utf8'});
  assert.equal(provision.status, 0, provision.stderr);
  assert(fs.lstatSync(path.join(fixture, 'system/.docker.env')).isSymbolicLink());
  const updated = fs.readFileSync(config, 'utf8');
  assert.equal(updated.slice(0, 1184), original.slice(0, 1184));
  assert(updated.includes("GITLAB_RUNNER_TOKEN='glrt-persisted_test'"));
  console.log('PASS: persistent isolated runner managers, scale/shrink/restart/zero, symlinked project discovery and atomic persistent token configuration.');
} finally {
  fs.rmSync(fixture, {recursive: true, force: true});
}
