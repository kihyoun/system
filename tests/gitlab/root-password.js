const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const prepare = require('../../gitlab/prepare-root-password');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrapper-password-'));
try {
  const config = path.join(tmp, 'config');
  const data = path.join(tmp, 'data');
  const secret = path.join(config, 'bootstrapper_initial_root_password');
  assert.equal(prepare(config, data), 'created');
  const generated = fs.readFileSync(secret, 'utf8');
  assert.match(generated, /^[a-f0-9]{48}$/);
  assert.equal(fs.statSync(secret).mode & 0o777, 0o600);
  assert.equal(prepare(config, data, 'a-different-password'), 'retained');
  assert.equal(fs.readFileSync(secret, 'utf8'), generated);
  const custom = path.join(tmp, 'custom');
  const literal = 'test-only-\'"$\\-password';
  prepare(custom, data, literal);
  assert.equal(fs.readFileSync(path.join(custom, path.basename(secret)), 'utf8'), literal);
  assert.throws(() => prepare(path.join(tmp, 'invalid'), data, 'short'));
  assert.throws(() => prepare(path.join(tmp, 'invalid'), data, 'long-but\ninvalid-password'));
  fs.mkdirSync(path.join(data, 'postgresql'), { recursive: true });
  const existing = path.join(tmp, 'existing');
  assert.equal(prepare(existing, data, 'do-not-reset-password'), 'existing-database');
  assert.equal(fs.existsSync(existing), false);
  console.log('PASS: random generation, permissions, persistence, literal custom password, validation, existing database');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
