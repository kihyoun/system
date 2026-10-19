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
} finally { process.chdir(previous); fs.rmSync(directory, {recursive: true, force: true}); }
console.log('PASS: public fallback, same-instance authenticated selector, secret-free argv and exact gitlink checkout');
