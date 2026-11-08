'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {publish, isolatedEnvironment} = require('../../gitlab/publish-wizard-source');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-source-publication-test-'));
const base = {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'};
function git(cwd, ...args) {
  const result = spawnSync('git', args, {cwd, env: base, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
let count = 0;
function fixture() {
  const root = path.join(directory, String(++count)); fs.mkdirSync(root);
  const wizard = path.join(root, 'wizard'), primary = path.join(root, 'primary.git');
  const publicWizard = path.join(root, 'public-wizard.git'), system = path.join(root, 'system');
  git(root, 'init', '-q', '--bare', primary); git(root, 'init', '-q', '--bare', publicWizard);
  git(root, 'init', '-q', '-b', 'master', wizard);
  fs.writeFileSync(path.join(wizard, 'README.md'), 'Original Wizard\n');
  git(wizard, 'add', '.'); git(wizard, 'commit', '-qm', 'Original');
  const old = git(wizard, 'rev-parse', 'HEAD');
  git(wizard, 'push', '-q', publicWizard, 'HEAD:master');
  git(wizard, 'push', '-q', primary, 'HEAD:master');
  fs.writeFileSync(path.join(wizard, 'README.md'), 'Reviewed Wizard update\n');
  git(wizard, 'commit', '-qam', 'Update');
  const sha = git(wizard, 'rev-parse', 'HEAD');
  git(wizard, 'push', '-q', primary, 'HEAD:dependency');
  git(root, 'init', '-q', '-b', 'master', system);
  fs.writeFileSync(path.join(system, '.gitmodules'), '[submodule "wizard"]\n path = wizard\n url = https://github.com/example/wizard.git\n');
  git(system, 'add', '.gitmodules'); git(system, 'update-index', '--add', '--cacheinfo', '160000', sha, 'wizard');
  git(system, 'commit', '-qm', 'System with exact Wizard');
  const env = {...base, GITLAB_CI: 'true', GITHUB_BACKUP_ENABLED: 'true',
    WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED: 'true', CI_PIPELINE_SOURCE: 'push',
    CI_COMMIT_TAG: '', CI_COMMIT_REF_PROTECTED: 'true', CI_DEFAULT_BRANCH: 'master',
    CI_COMMIT_BRANCH: 'master', CI_PROJECT_PATH: 'example/system', GITHUB_BACKUP_SOURCE_PROJECT: 'example/system',
    CI_PROJECT_ID: '4', CI_PIPELINE_ID: '200', CI_JOB_ID: '900', CI_COMMIT_SHA: git(system, 'rev-parse', 'HEAD'),
    CI_SERVER_URL: 'https://gitlab.example.test', CI_JOB_TOKEN: 'PRIVATE_FIXTURE_TOKEN',
    WIZARD_PRIMARY_REPOSITORY_URL: 'https://gitlab.example.test/example/wizard.git',
    WIZARD_GITHUB_BACKUP_REMOTE: 'git@github.com:example/wizard.git'};
  const calls = [];
  async function transport(args, environment) {
    calls.push({args, environment});
    const privateSource = args.includes(env.WIZARD_PRIMARY_REPOSITORY_URL);
    assert.equal(Object.values(environment).some(v => typeof v === 'string' && v.startsWith('Authorization: Basic ')), privateSource);
    const mapped = args.map(arg => arg === env.WIZARD_PRIMARY_REPOSITORY_URL ? primary :
      ['https://github.com/example/wizard.git', env.WIZARD_GITHUB_BACKUP_REMOTE].includes(arg) ? publicWizard : arg);
    const result = spawnSync('git', ['-c', 'protocol.file.allow=always', ...mapped],
      {cwd: system, env: isolatedEnvironment(base), encoding: 'utf8'});
    return result.status;
  }
  const run = (extra = {}, selectedTransport = transport) => publish({...env, ...extra}, system, undefined, selectedTransport);
  const tip = ref => git(root, '--git-dir=' + publicWizard, 'rev-parse', ref);
  return {root, system, primary, wizard, publicWizard, env, old, sha, calls, run, transport, tip};
}

async function main() {
  const clean = isolatedEnvironment({...base, GIT_ASKPASS: '/unrelated/credential-helper',
    SSH_ASKPASS: '/unrelated/ssh-helper', SSH_ASKPASS_REQUIRE: 'force'});
  assert.equal(clean.GIT_ASKPASS, undefined);
  assert.equal(clean.SSH_ASKPASS, undefined);
  assert.equal(clean.SSH_ASKPASS_REQUIRE, undefined);
  let f = fixture();
  const receipt = await f.run();
  assert.equal(receipt.wizardRevision, f.sha);
  assert.equal(receipt.ref, 'refs/heads/system-release/' + f.sha);
  assert.equal(f.tip(receipt.ref), f.sha);
  assert.equal(f.tip('master'), f.old, 'Wizard public master must stay unchanged');
  assert.equal(git(f.root, '--git-dir=' + f.primary, 'rev-parse', 'master'), f.old, 'Wizard primary master must stay unchanged');
  const pushes = f.calls.filter(c => c.args.includes('push'));
  assert.equal(pushes.length, 1);
  assert(pushes[0].args.includes('--force-with-lease=' + receipt.ref + ':'));
  f.calls.length = 0;
  assert.deepEqual(await f.run(), receipt);
  assert(!f.calls.some(c => c.args.includes('push')), 'Retry must verify an existing exact ref');

  // Public source survives a completely fresh recursive System checkout.
  const mirror = path.join(f.root, 'system-mirror.git'), fresh = path.join(f.root, 'fresh');
  git(f.root, 'init', '-q', '--bare', mirror); git(f.system, 'push', '-q', mirror, 'HEAD:master');
  git(f.root, 'clone', '-q', mirror, fresh);
  git(fresh, '-c', 'protocol.file.allow=always', '-c', 'submodule.wizard.url=' + f.publicWizard,
    'submodule', 'update', '--init', '--', 'wizard');
  assert.equal(git(path.join(fresh, 'wizard'), 'rev-parse', 'HEAD'), f.sha);

  for (const changed of [
    {CI_PIPELINE_SOURCE: 'merge_request_event'}, {CI_PIPELINE_SOURCE: 'web'}, {CI_COMMIT_REF_PROTECTED: 'false'},
    {CI_COMMIT_BRANCH: 'feature'}, {CI_PROJECT_PATH: 'other/system'}, {CI_COMMIT_SHA: 'a'.repeat(40)},
    {WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED: 'false'}, {CI_JOB_TOKEN: ''}, {CI_JOB_ID: '0'},
    {WIZARD_PRIMARY_REPOSITORY_URL: 'https://outside.example.test/other/wizard.git'},
    {WIZARD_GITHUB_BACKUP_REMOTE: 'git@github.com:other/wizard.git'},
  ]) {
    f.calls.length = 0;
    await assert.rejects(f.run(changed));
    assert.equal(f.calls.length, 0, 'Invalid contexts must not contact a remote');
  }

  f = fixture();
  const ref = 'refs/heads/system-release/' + f.sha;
  git(f.wizard, 'push', '-q', f.publicWizard, f.old + ':' + ref);
  await assert.rejects(f.run(), /conflicts/);
  assert.equal(f.tip(ref), f.old, 'Even an ancestor under an immutable ref must not advance');

  f = fixture();
  let interrupted = false;
  await f.run({}, async (args, env) => {
    const status = await f.transport(args, env);
    if (args.includes('push') && !interrupted) { interrupted = true; return 1; }
    return status;
  });
  assert(interrupted, 'Lost successful push response must be exercised');
  assert.equal(f.tip('refs/heads/system-release/' + f.sha), f.sha);

  f = fixture();
  await assert.rejects(f.run({}, async (args, env) => args.includes('https://github.com/example/wizard.git') ? 1 : f.transport(args, env)), /Anonymous/);
  assert(!fs.existsSync(path.join(f.system, 'test-results/github/wizard-source.json')), 'Unverified public access must not publish a receipt');
  console.log('Wizard dependency publication: gates, exact immutable refs, retries, isolated auth and fresh recursive checkout passed.');
}
main().finally(() => fs.rmSync(directory, {recursive: true, force: true})).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
