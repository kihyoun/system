'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
test('targeted proxy setup prepares only the selected application without recreating images or removing siblings', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-proxy-scope-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const directory of ['nginx-proxy/.projects', 'system/.projects.env', 'bin']) fs.mkdirSync(path.join(root, directory), {recursive: true});
  fs.copyFileSync(path.join(__dirname, '../../nginx-proxy/start.sh'), path.join(root, 'nginx-proxy/start.sh'));
  fs.writeFileSync(path.join(root, 'system/.docker.env'), 'NGINX_PROXY_IMAGE="operator-proxy@sha256:' + 'a'.repeat(64) + '"\n');
  for (const key of ['selected', 'unrelated']) fs.writeFileSync(path.join(root, 'system/.projects.env/.' + key + '.env'),
    'PROJECT_NAME=' + key + '\nUSE_PROD_HOST=true\nUSE_BETA_HOST=false\nUSE_REVIEW_HOST=true\n');
  fs.writeFileSync(path.join(root, 'nginx-proxy/.projects/.unrelated.env'), 'unchanged sibling');
  const bin = path.join(root, 'bin'), trace = path.join(root, 'trace');
  fs.writeFileSync(path.join(bin, 'docker-compose'), '#!/bin/sh\nprintf "%s %s\\n" "$NGINX_PROXY_IMAGE" "$*" >> "$TRACE"\n', {mode: 0o755});
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TRACE"\nprintf "172.20.0.2\\n"\n', {mode: 0o755});
  const result = spawnSync('bash', ['start.sh', 'selected'], {cwd: path.join(root, 'nginx-proxy'), encoding: 'utf8', env: {...process.env, PATH: bin + ':' + process.env.PATH, TRACE: trace}});
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(trace, 'utf8');
  assert.match(commands, /-p selected up --no-recreate --no-build -d prod/);
  assert.match(commands, /-p selected up --no-recreate --no-build -d review/);
  assert.match(commands, /operator-proxy@sha256:/);
  assert.doesNotMatch(commands, /unrelated|beta|--remove-orphans|--force-recreate|gitlab|stop|restart/);
  assert.equal(fs.readFileSync(path.join(root, 'nginx-proxy/.projects/.unrelated.env'), 'utf8'), 'unchanged sibling');
  assert.equal(fs.readFileSync(path.join(root, 'nginx-proxy/.projects/.selected.env'), 'utf8'), 'PROD_PROXY=172.20.0.2\nREVIEW_PROXY=172.20.0.2\n');
});

test('failed native apply restores previous proxy address records', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-proxy-rollback-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const directory of ['project-bootstrap', 'nginx-proxy/.projects', 'nginx']) fs.mkdirSync(path.join(root, directory), {recursive: true});
  fs.copyFileSync(path.join(__dirname, '../../project-bootstrap/apply.sh'), path.join(root, 'project-bootstrap/apply.sh'));
  fs.writeFileSync(path.join(root, 'nginx-proxy/.projects/.sample.env'), 'previous addresses');
  fs.writeFileSync(path.join(root, 'nginx-proxy/start.sh'), 'printf changed > .projects/.sample.env\n');
  fs.writeFileSync(path.join(root, 'nginx/start.sh'), 'exit 23\n');
  const result = spawnSync('bash', ['apply.sh', 'sample'], {cwd: path.join(root, 'project-bootstrap'), encoding: 'utf8'});
  assert.equal(result.status, 23);
  assert.equal(fs.readFileSync(path.join(root, 'nginx-proxy/.projects/.sample.env'), 'utf8'), 'previous addresses');
});
