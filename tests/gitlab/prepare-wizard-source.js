'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const {selection, prepare} = require('../../gitlab/prepare-wizard-source');
const base = {CI_SERVER_URL: 'https://gitlab.example.test', CI_JOB_TOKEN: 'fixture-token'};
assert.equal(selection(base), null, 'public checkout remains the portable fallback');
for (const url of ['http://gitlab.example.test/team/wizard.git', 'https://other.example/team/wizard.git',
  'https://user:password@gitlab.example.test/team/wizard.git', 'https://gitlab.example.test/team/wizard.git?token=secret'])
  assert.throws(() => selection({...base, WIZARD_PRIMARY_REPOSITORY_URL: url}), /same-instance/);
assert.throws(() => selection({CI_SERVER_URL: base.CI_SERVER_URL, WIZARD_PRIMARY_REPOSITORY_URL: 'https://gitlab.example.test/team/wizard.git'}), /same-instance/);
const sha = 'a'.repeat(40), calls = [];
const run = (command, args, options) => {
  calls.push({command, args, options});
  if (args.includes('ls-tree')) return '160000 commit ' + sha + '\twizard\n';
  if (args.includes('--get')) return 'wizard\n';
  if (args.includes('rev-parse')) return sha + '\n';
  return '';
};
const env = {...base, WIZARD_PRIMARY_REPOSITORY_URL: 'https://gitlab.example.test/group/wizard.git'};
assert.equal(prepare(env, run), sha);
const checkout = calls.find(call => call.args.includes('update'));
assert(checkout.args.includes('submodule.wizard.url=' + env.WIZARD_PRIMARY_REPOSITORY_URL));
assert(!JSON.stringify(checkout.args).includes(base.CI_JOB_TOKEN), 'authentication is not passed in argv');
assert.equal(checkout.options.env.GIT_CONFIG_VALUE_0, '');
assert.equal(checkout.options.env.GIT_CONFIG_KEY_1, 'http.https://gitlab.example.test/.extraHeader');
assert.equal(checkout.options.env.GIT_CONFIG_VALUE_1, 'Authorization: Basic ' + Buffer.from('gitlab-ci-token:fixture-token').toString('base64'));
assert.equal(checkout.options.env.GIT_CONFIG_KEY_2, 'http.followRedirects');
assert.equal(checkout.options.env.GIT_CONFIG_VALUE_2, 'false', 'an authenticated clone cannot follow a redirect elsewhere');
assert.throws(() => prepare(env, (...args) => args[1].includes('rev-parse') ? 'b'.repeat(40) : run(...args)), /exact gitlink/);

// Exercise the real fallback against owned, offline Git repositories.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-primary-source-'));
const previous = process.cwd();
try {
  const wizard = path.join(directory, 'wizard-origin'), system = path.join(directory, 'system');
  fs.mkdirSync(wizard); fs.mkdirSync(system);
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  for (const repo of [wizard, system]) {
    git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.name', 'Fixture'); git(repo, 'config', 'user.email', 'fixture@example.test');
  }
  fs.writeFileSync(path.join(wizard, 'source.txt'), 'exact source'); git(wizard, 'add', '.'); git(wizard, 'commit', '-qm', 'Source');
  const revision = git(wizard, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(system, '.gitmodules'), '[submodule "wizard"]\n path = wizard\n url = ' + wizard.replace(/\\/g, '/') + '\n');
  git(system, 'add', '.gitmodules'); git(system, 'update-index', '--add', '--cacheinfo', '160000,' + revision + ',wizard'); git(system, 'commit', '-qm', 'Pin source');
  process.chdir(system);
  assert.equal(prepare({...process.env, WIZARD_PRIMARY_REPOSITORY_URL: '', GIT_ALLOW_PROTOCOL: 'file'}), revision);
  assert.equal(fs.readFileSync(path.join(system, 'wizard/source.txt'), 'utf8'), 'exact source');

  const primary = path.join(directory, 'wizard-primary');
  git(directory, 'clone', '-q', wizard, primary);
  git(primary, 'config', 'user.name', 'Fixture'); git(primary, 'config', 'user.email', 'fixture@example.test');
  fs.writeFileSync(path.join(primary, 'new-source.txt'), 'available only in the primary');
  git(primary, 'add', '.'); git(primary, 'commit', '-qm', 'Primary-only source');
  const advanced = git(primary, 'rev-parse', 'HEAD');
  git(system, 'remote', 'add', 'origin', 'https://gitlab.example.test/team/system.git');
  git(system, 'update-index', '--cacheinfo', '160000,' + advanced + ',wizard'); git(system, 'commit', '-qm', 'Advance exact Wizard pin');
  assert.throws(() => prepare({...process.env, WIZARD_PRIMARY_REPOSITORY_URL: '', GIT_ALLOW_PROTOCOL: 'file'}),
    'the old cached origin cannot supply the primary-only commit');
  git(path.join(system, 'wizard'), 'config', '--add', 'remote.origin.url', 'https://old-mirror.example.test/wizard.git');
  const internalUrl = 'https://gitlab.example.test/team/wizard.git', writes = [];
  // The adapter maps the selected HTTPS endpoint onto an owned file fixture;
  // actual Git still performs cache reconfiguration and fetches the exact pin.
  const offline = (command, args, options) => {
    if (args.includes('remote.origin.url')) writes.push([...args]);
    const mapped = args.map(arg => arg === internalUrl ? primary : arg === 'submodule.wizard.url=' + internalUrl ?
      'submodule.wizard.url=' + primary : arg);
    return execFileSync(command, mapped, options);
  };
  const selectedEnv = {...process.env, ...base, WIZARD_PRIMARY_REPOSITORY_URL: internalUrl, GIT_ALLOW_PROTOCOL: 'file'};
  assert.equal(prepare(selectedEnv, offline), advanced, 'reused checkout obtains a primary-only commit');
  assert.equal(git(system, 'remote', 'get-url', 'origin'), 'https://gitlab.example.test/team/system.git', 'superproject origin unchanged');
  assert.equal(git(path.join(system, 'wizard'), 'remote', 'get-url', 'origin'), primary);
  assert.equal(git(path.join(system, 'wizard'), 'config', '--get-all', 'remote.origin.url'), primary, 'all stale fetch URL values are replaced');
  assert(writes.some(args => args.includes('--replace-all') && args.includes(internalUrl)), 'old module origin explicitly replaced without credentials');
  assert(!JSON.stringify(writes).includes(base.CI_JOB_TOKEN));

  git(system, 'submodule', 'deinit', '-f', '--', 'wizard');
  const cache = git(system, 'rev-parse', '--git-path', 'modules/wizard');
  git(system, '--git-dir=' + cache, 'config', '--replace-all', 'remote.origin.url', wizard);
  assert.equal(prepare(selectedEnv, offline), advanced, 'deinitialized module cache is also reconciled before checkout');
  assert.equal(git(path.join(system, 'wizard'), 'remote', 'get-url', 'origin'), primary);
} finally { process.chdir(previous); fs.rmSync(directory, {recursive: true, force: true}); }
console.log('PASS: public fallback, internal authenticated selector, exact gitlink, reused/deinitialized caches and unchanged superproject origin');
