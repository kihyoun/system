'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
if (process.env.SYSTEM_TEST_ISOLATED !== '1' || fs.existsSync('/var/run/docker.sock')) {
  throw new Error('Run only in a disposable isolated test container without a Docker socket.');
}
const root = path.resolve(__dirname, '../..');
const example = fs.readFileSync(path.join(root, 'system/.docker.env.example'), 'utf8');
const cube = example.slice(0, 1184);
fs.mkdirSync('/synctemplates', {recursive: true});

function fixture(t, configured = false, reset = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-start-test-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const relative of ['system', 'bootstrapper', 'sync', 'wizard', 'nginx/.templates', 'bin', 'mounted/platform/configuration']) {
    fs.mkdirSync(path.join(dir, relative), {recursive: true});
  }
  for (const relative of ['start.sh', 'sync/start.sh', 'bootstrapper/persistence.sh', 'system/.docker.env.example', 'system/.seed.env']) {
    fs.copyFileSync(path.join(root, relative), path.join(dir, relative));
  }
  const mount = path.join(dir, 'mounted'), persistent = path.join(mount, 'platform');
  const hostSeed = path.join(mount, 'seed'), savedSeed = path.join(mount, 'saved-seed');
  const canonical = path.join(persistent, 'configuration/.docker.env');
  if (configured) fs.writeFileSync(canonical, cube + '\nexport SYNC_ENABLE=true\nexport SEED_DIR=' + savedSeed + '\n');
  if (configured || reset) fs.symlinkSync(canonical, path.join(dir, 'system/.docker.env'));
  fs.writeFileSync(path.join(dir, 'selector.env'), `PERSISTENT_MOUNT=${mount}\nPERSISTENT_DIR=${persistent}\nSEED_DIR=${hostSeed}\nNGINX_IMAGE=nginx:selector-test\n`);
  fs.writeFileSync(path.join(dir, '.docker.env'), cube + '\nexport BOOTSTRAPPER_IP=127.0.0.1\n');
  fs.writeFileSync(path.join(dir, 'wizard/.docker.env'), cube + '\nexport WIZARD_IP=127.0.0.2\n');
  fs.writeFileSync(path.join(dir, 'nginx/.templates/default.sync.template'), '${SYNC_IP} ${WIZARD_IP}\n');
  const command = (name, text) => fs.writeFileSync(path.join(dir, 'bin', name), '#!/bin/sh\n' + text, {mode: 0o755});
  command('mountpoint', 'exit 0\n');
  command('findmnt', 'for last; do :; done\ncase "$*" in\n*MAJ:MIN*) if [ "$last" = / ]; then echo root-device; else echo data-device; fi;;\n*) printf "%s\\n" "$PERSISTENT_MOUNT";;\nesac\n');
  for (const name of ['docker-compose', 'npm']) {
    command(name, `printf '${name}:%s\\n' "$SEED_DIR" >> "$START_CAPTURE"\nprintf '%s' "\${NGINX_IMAGE-unset}" > "$START_IMAGE_CAPTURE"\n`);
  }
  const capture = path.join(dir, 'capture');
  const env = {...process.env, PATH: path.join(dir, 'bin') + ':' + process.env.PATH,
    PERSISTENCE_ENV_FILE: path.join(dir, 'selector.env'), SYSTEM_BOOTSTRAPPER_SKIP_BUILD: '1',
    PERSISTENT_MOUNT: mount, PERSISTENT_DIR: persistent, SEED_DIR: hostSeed, START_CAPTURE: capture,
    START_IMAGE_CAPTURE: path.join(dir, 'image-capture')};
  const run = sync => spawnSync('bash', [path.join(dir, sync ? 'sync/start.sh' : 'start.sh')], {
    cwd: sync ? path.join(dir, 'sync') : dir, env, encoding: 'utf8'
  });
  return {run, hostSeed, savedSeed, capture, canonical, imageCapture: env.START_IMAGE_CAPTURE};
}

for (const reset of [false, true]) {
  test(`host startup preserves attached-volume seed during ${reset ? 'reset' : 'fresh'} defaults`, t => {
    const f = fixture(t, false, reset), result = f.run(false);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(f.capture, 'utf8'), `docker-compose:${f.hostSeed}\n`);
    assert.equal(fs.readFileSync(f.imageCapture, 'utf8'), 'nginx:selector-test', 'bare host selectors must be exported to Compose');
    assert.equal(fs.existsSync(f.canonical), false, 'defaults must not save main configuration');
  });
  test(`Sync startup preserves Compose seed during ${reset ? 'reset' : 'fresh'} defaults`, t => {
    const f = fixture(t, false, reset), result = f.run(true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(f.capture, 'utf8'), `docker-compose:${f.hostSeed}\nnpm:${f.hostSeed}\n`);
    assert.equal(fs.existsSync(f.canonical), false);
  });
}

test('host startup retains the saved main configuration seed behavior', t => {
  const f = fixture(t, true), result = f.run(false);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(f.capture, 'utf8'), `docker-compose:${f.savedSeed}\n`);
});
test('configured Sync retains the saved main configuration seed behavior', t => {
  const f = fixture(t, true), result = f.run(true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(f.capture, 'utf8'), `npm:${f.savedSeed}\n`);
});
