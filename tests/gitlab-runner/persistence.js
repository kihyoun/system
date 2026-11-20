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
  assert.deepStrictEqual(multi.services.docker_1.logging, {driver: 'json-file', options: {
    'max-size': '${SYSTEM_LOG_MAX_SIZE:-10m}', 'max-file': '${SYSTEM_LOG_MAX_FILES:-3}'}});
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
  for (const name of ['compose.js', 'docker-compose.yml', 'provision.js']) {
    fs.copyFileSync(path.join(root, 'gitlab-runner', name), path.join(fixture, 'gitlab-runner', name));
  }
  fs.symlinkSync(path.join(root,'operations'),path.join(fixture,'operations'),'dir');
  fs.copyFileSync(path.join(root,'gitlab/security-release.json'),path.join(fixture,'gitlab/security-release.json'));
  const log = path.join(fixture, 'compose-log.jsonl');
  fs.writeFileSync(path.join(fixture,'bin/docker'),'#!'+process.execPath+'\nconst fs=require("fs"),args=process.argv.slice(2);if(args.includes("compose")){fs.appendFileSync(process.env.COMPOSE_LOG,JSON.stringify({args,definition:JSON.parse(fs.readFileSync(args[args.indexOf("-f")+1],"utf8"))})+"\\n");}else{process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({token:"glrt-persisted_test"})));}\n',{mode:0o755});
  fs.writeFileSync(path.join(fixture, 'gitlab/.docker.env'), 'export GITLAB_HOST=gitlab.example.com\nexport GITLAB_REGISTRY_HOST=registry.example.com\n');
  fs.symlinkSync(path.join(fixture, 'project-state'), path.join(fixture, 'system/.projects.env'));
  fs.writeFileSync(path.join(fixture, 'project-state/.project.env'), 'PROJECT_NAME=project\nPROJECT_TEMPLATE=web\nGITLAB_RUNNER_SCALE=2\n');
  fs.writeFileSync(path.join(fixture, 'project-state/.wizard.env'), 'PROJECT_NAME=wizard\nPROJECT_TEMPLATE=wizard\nGITLAB_RUNNER_SCALE=2\n');
  const env = {...process.env, PATH: path.join(fixture, 'bin') + ':' + process.env.PATH, COMPOSE_LOG: log, SYSTEM_CONFIG_DIR:path.join(fixture,'system')};
  const writeMain = scale => fs.writeFileSync(path.join(fixture, 'system/.docker.env'), `export PERSISTENT_DIR='${persistent}'\nexport GITLAB_RUNNER_SCALE=${scale}\nexport GITLAB_RUNNER_TOKEN=glrt-persisted_test\n`);
  // Leave mktemp unmocked: run this lifecycle test in the Alpine controller
  // image as well as the component image. BusyBox rejects GNU's suffix form
  // (XXXXXXXX.json); start/stop must work with the runtime's real utility.
  const invoke = (script, argument) => {
    const result = spawnSync(process.execPath, [path.join(root,'operations/dist/lifecycle/entry.js'),'runner-'+script.replace('.sh',''),fixture,...(argument ? [argument] : [])], {cwd: path.join(fixture, 'gitlab-runner'), env, encoding: 'utf8'});
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
  assert.deepStrictEqual(calls.map(call => call.args[call.args.indexOf('-p')+1]), ['runner', 'project_runner', 'runner', 'runner', 'project_runner', 'runner', 'runner']);
  assert.deepStrictEqual(calls.map(call => call.args[call.args.indexOf('-f')+2]), ['up', 'up', 'up', 'down', 'down', 'up', 'down']);
  assert.deepStrictEqual(Object.keys(calls[0].definition.services), ['docker_1', 'docker_2']);
  assert.deepStrictEqual(Object.keys(calls[2].definition.services), ['docker_1']);
  assert.deepStrictEqual(calls[5].definition.services, calls[0].definition.services);
  for (const call of calls) {
    assert.deepEqual(call.args.slice(0,3),['--host=unix:///var/run/docker.sock','compose','--compatibility']);
    assert(call.args.includes('--remove-orphans'));
    assert(!fs.existsSync(call.args[call.args.indexOf('-f')+1]), 'generated temporary definition must be cleaned');
  }

  // Atomic runner-token writes must target /state rather than replace the
  // legacy main-config symlink with a new file on the controller root disk.
  const state = path.join(fixture, 'state'); fs.mkdirSync(state);
  const config = path.join(state, '.docker.env');
  const original = fs.readFileSync(path.join(root, 'system/.docker.env.example'), 'utf8');
  fs.writeFileSync(config, original);
  fs.unlinkSync(path.join(fixture, 'system/.docker.env'));
  fs.symlinkSync(config, path.join(fixture, 'system/.docker.env'));
  const provision = spawnSync(process.execPath, ['-e', `
    const {RunnerLifecycleService}=require(${JSON.stringify(path.join(root,'operations/dist/lifecycle/runner.service'))});
    const service=new RunnerLifecycleService({}, {}, {current:async options=>{if(options.checkout!==${JSON.stringify(fixture)})throw Error('wrong checkout');return {id:12,token:'glrt-persisted_test'};}});
    service.provisionToken({root:${JSON.stringify(fixture)},state:${JSON.stringify(state)},environment:{PERSISTENT_DIR:${JSON.stringify(persistent)}}}).catch(error=>{console.error(error);process.exitCode=1;});
  `], {cwd: path.join(fixture, 'gitlab-runner'), env, encoding: 'utf8'});
  assert.equal(provision.status, 0, provision.stderr);
  assert(fs.lstatSync(path.join(fixture, 'system/.docker.env')).isSymbolicLink());
  const updated = fs.readFileSync(config, 'utf8');
  assert.equal(updated.slice(0, 1184), original.slice(0, 1184));
  assert(updated.includes("GITLAB_RUNNER_TOKEN='glrt-persisted_test'"));
  console.log('PASS: persistent isolated runner managers, scale/shrink/restart/zero, symlinked project discovery and atomic persistent token configuration.');
} finally {
  fs.rmSync(fixture, {recursive: true, force: true});
}
