'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {initializeState} = require('../../system/persistence-init');
const {fields, defaults, publicSettings, requireMountedDirectory, publish} = require('../../system/wizard-public');
const cube = fs.readFileSync(path.join(__dirname, '../../system/.docker.env.example'), 'utf8').slice(0, 1184);
const quote = value => '"' + String(value).replace(/[\\"$`]/g, '\\$&') + '"';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-persistence-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const runtime = path.join(root, 'runtime');
  const state = path.join(root, 'state');
  fs.mkdirSync(runtime); fs.mkdirSync(state);
  return {runtime, state};
}

test('imports legacy configuration and receipts once and applies private modes', t => {
  const {runtime, state} = fixture(t);
  fs.writeFileSync(path.join(runtime, '.docker.env'), 'legacy');
  fs.mkdirSync(path.join(runtime, '.projects.env'));
  fs.writeFileSync(path.join(runtime, '.projects.env/.wizard.env'), 'receipt');
  initializeState(state, runtime);
  assert.equal(fs.readFileSync(path.join(state, '.docker.env'), 'utf8'), 'legacy');
  assert.equal(fs.readFileSync(path.join(runtime, '.projects.env/.wizard.env'), 'utf8'), 'receipt');
  assert.equal(fs.statSync(state).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(state, '.docker.env')).mode & 0o777, 0o600);
  initializeState(state, runtime);
});

test('saved volume configuration wins over a new container image', t => {
  const {runtime, state} = fixture(t);
  fs.writeFileSync(path.join(runtime, '.docker.env'), 'stale image');
  fs.writeFileSync(path.join(state, '.docker.env'), 'saved state');
  initializeState(state, runtime);
  assert.equal(fs.readFileSync(path.join(runtime, '.docker.env'), 'utf8'), 'saved state');
});

test('canonical reset and recreation survives controller replacement', t => {
  const {runtime, state} = fixture(t);
  initializeState(state, runtime);
  assert.equal(fs.lstatSync(path.join(runtime, '.docker.env')).isSymbolicLink(), true);
  fs.writeFileSync(path.join(state, '.docker.env'), 'one');
  fs.unlinkSync(path.join(state, '.docker.env'));
  initializeState(state, runtime);
  fs.writeFileSync(path.join(state, '.docker.env'), 'two');
  const freshRuntime = path.join(path.dirname(runtime), 'fresh');
  fs.mkdirSync(freshRuntime);
  fs.writeFileSync(path.join(freshRuntime, '.docker.env'), 'stale baked configuration');
  fs.unlinkSync(path.join(state, '.docker.env'));
  initializeState(state, freshRuntime);
  assert.equal(fs.existsSync(path.join(state, '.docker.env')), false);
  fs.writeFileSync(path.join(state, '.docker.env'), 'three');
  assert.equal(fs.readFileSync(path.join(freshRuntime, '.docker.env'), 'utf8'), 'three');
});

test('first-setup Sync authentication remains stable and private', t => {
  const {runtime, state} = fixture(t);
  initializeState(state, runtime);
  const file = path.join(state, 'sync-auth.env');
  const initial = fs.readFileSync(file, 'utf8');
  assert.match(initial, /^export SYNC_USER=bootstrapper_[a-f0-9]{16}\nexport SYNC_PASS=[A-Za-z0-9_-]{43}\n$/);
  initializeState(state, runtime);
  assert.equal(fs.readFileSync(file, 'utf8'), initial);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('atomic receipt replacement remains on the persistent directory', t => {
  const {runtime, state} = fixture(t);
  initializeState(state, runtime);
  const temporary = path.join(runtime, '.projects.env/.wizard.env.tmp');
  fs.writeFileSync(temporary, 'atomic receipt');
  fs.renameSync(temporary, path.join(runtime, '.projects.env/.wizard.env'));
  assert.equal(fs.readFileSync(path.join(state, '.projects.env/.wizard.env'), 'utf8'), 'atomic receipt');
});

test('rejects unexpected runtime and persistent configuration symlinks', t => {
  const {runtime, state} = fixture(t);
  fs.symlinkSync('/tmp/unrelated', path.join(runtime, '.docker.env'));
  assert.throws(() => initializeState(state, runtime), /Unexpected configuration link/);
  fs.unlinkSync(path.join(runtime, '.docker.env'));
  fs.symlinkSync('/tmp/unrelated', path.join(state, '.docker.env'));
  assert.throws(() => initializeState(state, runtime), /Unsafe configuration destination/);
});

test('public settings whitelist excludes credentials and values inside private multiline assignments', () => {
  const source = cube + '\nexport SYNC_PASS="private-password"\n' +
    'export GITLAB_INITIAL_ROOT_PASSWORD="root-password"\n' +
    'export PRIVATE_VALUE="hidden\nWIZARD_OPERATOR_NAME=must-never-be-public\nend"\n' +
    'export WIZARD_OPERATOR_EMAIL="public@example.test"\n';
  const output = publicSettings(source);
  assert.deepEqual(Object.keys(output).sort(), Object.values(fields).sort());
  assert.equal(output.operatorName, defaults.operatorName);
  assert.equal(output.contactEmail, 'public@example.test');
  assert.doesNotMatch(JSON.stringify(output), /private-password|root-password|must-never-be-public|PRIVATE_VALUE|SYNC_PASS/);
});

test('public settings retain literal quotes, newlines and shell characters without expansion', () => {
  const address = 'Example "Office"\nStraße \\ 2\n$HOME `id` $(touch /tmp/never-execute-public)';
  const privacy = "Operator's text\n<script>alert('plain text')</script>";
  const source = cube + '\nexport WIZARD_OPERATOR_ADDRESS=' + quote(address) + '\n' +
    'export WIZARD_PRIVACY_TEXT=' + quote(privacy) + '\n' +
    "export WIZARD_OPERATOR_NAME='First'\\''Last'\n";
  const output = publicSettings(source);
  assert.equal(output.operatorAddress, address);
  assert.equal(output.additionalPrivacyText, privacy);
  assert.equal(output.operatorName, "First'Last");
  for (const unsafe of ['$(id)', '`id`', 'plain; id', '"$HOME"'])
    assert.throws(() => publicSettings(cube + '\nexport WIZARD_OPERATOR_NAME=' + unsafe + '\n'), /Shell|Unexpected/);
});

test('missing public settings use clear examples while explicitly saved empty values remain cleared', () => {
  assert.deepEqual(publicSettings(null), defaults);
  assert.deepEqual(publicSettings(cube), defaults);
  const cleared = publicSettings(cube + '\n' + Object.keys(fields).map(key => 'export ' + key + '=""').join('\n') + '\n');
  assert.deepEqual(cleared, Object.fromEntries(Object.values(fields).map(key => [key, ''])));
  assert.equal(publicSettings(cube + '\nWIZARD_OPERATOR_NAME="first"\nWIZARD_OPERATOR_NAME="last"\n').operatorName, 'last');
});

test('public JSON replacement remains visible through its directory and exposes no private files', t => {
  const {runtime, state} = fixture(t), publicDir = path.join(runtime, 'public');
  fs.mkdirSync(publicDir, {mode: 0o755});
  const config = path.join(state, '.docker.env'), target = path.join(publicDir, 'privacy-instance.json');
  fs.writeFileSync(config, cube + '\nWIZARD_OPERATOR_NAME="Before"\nSYNC_PASS="secret"\n', {mode: 0o600});
  const oldMask = process.umask(0o077);
  try { publish(config, publicDir); } finally { process.umask(oldMask); }
  const old = fs.openSync(target, 'r'); t.after(() => fs.closeSync(old));
  fs.writeFileSync(config, cube + '\nWIZARD_OPERATOR_NAME="After"\nSYNC_PASS="secret"\n');
  publish(config, publicDir);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).operatorName, 'After');
  assert.equal(JSON.parse(fs.readFileSync(old, 'utf8')).operatorName, 'Before', 'Readers of the old inode must see a complete previous JSON');
  assert.equal(fs.statSync(target).mode & 0o777, 0o644, 'NGINX can read only the intentionally public output');
  assert.deepEqual(fs.readdirSync(publicDir), ['privacy-instance.json']);
  assert.equal(fs.statSync(config).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(target, 'utf8'), /secret|SYNC_PASS/);
});

test('invalid signatures and unsafe destinations fail before replacing public JSON', t => {
  const {runtime, state} = fixture(t), config = path.join(state, '.docker.env');
  const target = path.join(runtime, 'privacy-instance.json');
  fs.writeFileSync(target, '{"unchanged":true}\n');
  fs.writeFileSync(config, 'unsigned\nWIZARD_OPERATOR_NAME="Unsafe"\n');
  assert.throws(() => publish(config, runtime), /signature/);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"unchanged":true}\n');
  fs.writeFileSync(config, cube + '\nWIZARD_OPERATOR_NAME="Valid"\n');
  fs.unlinkSync(target); fs.symlinkSync(config, target);
  assert.throws(() => publish(config, runtime), /destination/);
  fs.unlinkSync(target); fs.unlinkSync(config); fs.symlinkSync(path.join(runtime, 'unrelated'), config);
  assert.throws(() => publish(config, runtime), /configuration/);
  assert.deepEqual(fs.readdirSync(runtime), []);
});

test('public generator requires exact dedicated mounts rather than root-disk fallback', t => {
  const {runtime, state} = fixture(t);
  assert.throws(() => requireMountedDirectory(state, '1 0 1:1 / / rw - ext4 root rw\n'), /persistent mounts/);
  assert.equal(requireMountedDirectory(state, '2 1 1:2 / ' + state + ' rw - ext4 volume rw\n'), state);
  const link = path.join(runtime, 'linked'); fs.symlinkSync(state, link);
  assert.throws(() => requireMountedDirectory(link, '2 1 1:2 / ' + link + ' rw - ext4 volume rw\n'), /persistent mounts/);
  const compose = fs.readFileSync(path.join(__dirname, '../../system/docker-compose.yml'), 'utf8');
  assert.match(compose, /wizardPublic:\/wizard-public/);
  assert.match(compose, /wizardPublic:\/usr\/share\/nginx\/wizard-public:ro/);
  assert.match(compose, /device: "\$\{PERSISTENT_DIR:\?PERSISTENT_DIR must be set\}\/wizard-public"/);
  const start = fs.readFileSync(path.join(__dirname, '../../system/start.sh'), 'utf8');
  assert(start.indexOf('node ./persistence-init.js') < start.indexOf('node ./wizard-public.js'));
  assert(start.indexOf('node ./wizard-public.js') < start.indexOf('source .docker.env'));
});
