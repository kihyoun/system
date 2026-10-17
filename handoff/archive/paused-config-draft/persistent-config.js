const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const prepare = require('../system/prepare-config');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrapper-config-'));
try {
  const state = path.join(tmp, 'state');
  const first = path.join(tmp, 'first');
  fs.mkdirSync(first);
  prepare(first, state);
  const main = path.join(first, '.docker.env');
  assert.equal(fs.existsSync(main), false); // Fresh bootstrap still has no config.
  fs.writeFileSync(main, 'GITLAB_HOST=gitlab.localhost\n');
  fs.writeFileSync(path.join(first, '.projects.env', '.ui.env'), 'PROJECT_NAME=ui\n');
  const second = path.join(tmp, 'replacement-container');
  fs.mkdirSync(second);
  fs.writeFileSync(path.join(second, '.docker.env'), 'GITLAB_HOST=gitlab.example.com\n');
  prepare(second, state);
  assert.equal(fs.readFileSync(path.join(second, '.docker.env'), 'utf8'), 'GITLAB_HOST=gitlab.localhost\n');
  assert.equal(fs.readFileSync(path.join(second, '.projects.env', '.ui.env'), 'utf8'), 'PROJECT_NAME=ui\n');
  assert.equal(fs.statSync(path.join(state, '.docker.env')).mode & 0o777, 0o600);
  // Exercise the same copy operation used by push.sh, followed by a restart.
  const upload = path.join(tmp, 'upload.env');
  fs.writeFileSync(upload, 'GITLAB_HOST=updated.localhost\n');
  require('child_process').execFileSync('cp', [upload, path.join(second, '.docker.env')]);
  prepare(second, state);
  assert.equal(fs.readFileSync(main, 'utf8'), 'GITLAB_HOST=updated.localhost\n');
  fs.unlinkSync(fs.realpathSync(main)); // Same reset semantics as the API.
  assert.equal(fs.existsSync(main), false);
  fs.writeFileSync(main, 'GITLAB_HOST=after-reset.localhost\n');
  assert.equal(fs.readFileSync(path.join(second, '.docker.env'), 'utf8'), 'GITLAB_HOST=after-reset.localhost\n');
  const migration = path.join(tmp, 'migration');
  fs.mkdirSync(migration);
  fs.writeFileSync(path.join(migration, '.docker.env'), 'existing-config\n');
  prepare(migration, path.join(tmp, 'migrated-state'));
  assert.equal(fs.readFileSync(path.join(migration, '.docker.env'), 'utf8'), 'existing-config\n');
  console.log('PASS: first boot, migration, upload, restart, replacement container, projects and reset');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
