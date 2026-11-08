'use strict';

// Publish an exact System gitlink before mirroring its parent commit. This is
// separate from the Wizard's default-branch publisher and never advances it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {startTransport} = require('./github-backup-transport');
const revision = value => /^[a-f0-9]{40}$/.test(value || '');
const number = value => /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));

function local(args, environment, cwd) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args],
    {cwd, env: environment, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024});
  if (result.error || result.status !== 0) throw Error('Source publication Git operation failed.');
  return result.stdout.trim();
}

function context(env, git) {
  if (env.WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED !== 'true' || env.GITHUB_BACKUP_ENABLED !== 'true' ||
      env.GITLAB_CI !== 'true' || env.CI_PIPELINE_SOURCE !== 'push' || env.CI_COMMIT_TAG ||
      !env.CI_DEFAULT_BRANCH || env.CI_COMMIT_BRANCH !== env.CI_DEFAULT_BRANCH ||
      env.CI_COMMIT_REF_PROTECTED !== 'true' || !env.CI_PROJECT_PATH ||
      env.CI_PROJECT_PATH !== env.GITHUB_BACKUP_SOURCE_PROJECT || !revision(env.CI_COMMIT_SHA) ||
      !['CI_PROJECT_ID', 'CI_PIPELINE_ID', 'CI_JOB_ID'].every(key => number(env[key])))
    throw Error('Wizard source publication requires an enabled protected System default-branch push.');
  if (git(['rev-parse', 'HEAD']) !== env.CI_COMMIT_SHA)
    throw Error('Source publication checkout does not match the pipeline.');
  const row = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(git(['ls-tree', 'HEAD', '--', 'wizard']));
  if (!row || git(['config', '--blob', 'HEAD:.gitmodules', '--get', 'submodule.wizard.path']) !== 'wizard')
    throw Error('An exact Wizard gitlink is required.');
  const repository = git(['config', '--blob', 'HEAD:.gitmodules', '--get', 'submodule.wizard.url']);
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)\.git$/.exec(repository);
  if (!match || ['.', '..'].includes(match[2]) ||
      env.WIZARD_GITHUB_BACKUP_REMOTE !== `git@github.com:${match[1]}/${match[2]}.git`)
    throw Error('The approved Wizard destination must match the public submodule mapping.');
  const origin = new URL(env.CI_SERVER_URL), source = new URL(env.WIZARD_PRIMARY_REPOSITORY_URL);
  if (origin.protocol !== 'https:' || source.protocol !== 'https:' || source.origin !== origin.origin ||
      source.username || source.password || source.search || source.hash ||
      !/^\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.git$/.test(source.pathname) ||
      source.pathname.split('/').some(part => ['.', '..'].includes(part)) ||
      typeof env.CI_JOB_TOKEN !== 'string' || !env.CI_JOB_TOKEN || /[\r\n]/.test(env.CI_JOB_TOKEN))
    throw Error('An approved same-instance Wizard source and job token are required.');
  return {format: 'system-wizard-source-publication-v1', projectId: Number(env.CI_PROJECT_ID),
    pipelineId: Number(env.CI_PIPELINE_ID), publicationJobId: Number(env.CI_JOB_ID),
    systemRevision: env.CI_COMMIT_SHA, wizardRevision: row[1], repository,
    ref: 'refs/heads/system-release/' + row[1]};
}

function isolatedEnvironment(env) {
  const result = {...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never'};
  for (const key of Object.keys(result))
    if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(key) ||
        ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_ASKPASS', 'SSH_ASKPASS',
          'SSH_ASKPASS_REQUIRE'].includes(key)) delete result[key];
  result.GIT_CONFIG_COUNT = '2';
  result.GIT_CONFIG_KEY_0 = 'credential.helper'; result.GIT_CONFIG_VALUE_0 = '';
  result.GIT_CONFIG_KEY_1 = 'http.followRedirects'; result.GIT_CONFIG_VALUE_1 = 'false';
  return result;
}

async function publish(env = process.env, cwd = process.cwd(), run = local,
    transport = async (args, environment) => startTransport(args, 30, environment).done) {
  const clean = isolatedEnvironment(env), git = args => run(args, clean, cwd);
  const receipt = context(env, git);
  const privateEnv = {...clean, GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_2: 'http.' + new URL(env.CI_SERVER_URL).origin + '/.extraHeader',
    GIT_CONFIG_VALUE_2: 'Authorization: Basic ' + Buffer.from('gitlab-ci-token:' + env.CI_JOB_TOKEN).toString('base64')};
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'system-wizard-source-'));
  fs.chmodSync(directory, 0o700);
  const bare = path.join(directory, 'source.git');
  const options = ['--git-dir=' + bare, '-c', 'protocol.allow=never'];
  try {
    run(['init', '--bare', bare], clean, cwd);
    if (await transport([...options, '-c', 'protocol.https.allow=always', 'fetch', '--quiet', '--no-tags',
        '--', env.WIZARD_PRIMARY_REPOSITORY_URL, receipt.wizardRevision], privateEnv) !== 0 ||
        run(['--git-dir=' + bare, 'rev-parse', 'FETCH_HEAD'], clean, cwd) !== receipt.wizardRevision ||
        run(['--git-dir=' + bare, 'cat-file', '-t', receipt.wizardRevision], clean, cwd) !== 'commit')
      throw Error('The exact Wizard source could not be read from the approved primary.');
    const target = 'refs/source-publication/public';
    const publicTip = async () => {
      run(['--git-dir=' + bare, 'update-ref', '-d', target], clean, cwd);
      if (await transport([...options, '-c', 'protocol.https.allow=always', 'fetch', '--quiet', '--no-tags',
          '--', receipt.repository, receipt.ref + ':' + target], clean) !== 0) return null;
      return run(['--git-dir=' + bare, 'rev-parse', target], clean, cwd);
    };
    let verified = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await publicTip();
      if (existing === receipt.wizardRevision) { verified = true; break; }
      if (existing) throw Error('The retained public Wizard ref conflicts; nothing was overwritten.');
      // An empty expected value is an atomic CREATE-ONLY lease. Even an
      // existing ancestor cannot be advanced by this publication attempt.
      await transport([...options, '-c', 'protocol.ssh.allow=always', 'push', '--quiet', '--no-follow-tags',
        '--force-with-lease=' + receipt.ref + ':', '--', env.WIZARD_GITHUB_BACKUP_REMOTE,
        receipt.wizardRevision + ':' + receipt.ref], clean);
    }
    if (!verified && await publicTip() !== receipt.wizardRevision)
      throw Error('Anonymous public Wizard source verification failed.');
    const output = path.join(cwd, 'test-results/github');
    fs.mkdirSync(output, {recursive: true});
    fs.writeFileSync(path.join(output, 'wizard-source.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

module.exports = {context, isolatedEnvironment, publish};
if (require.main === module) publish().then(() => console.log('Exact Wizard source publicly verified.'))
  .catch(() => { console.error('Wizard source publication failed; inspect approved mappings and access.'); process.exitCode = 1; });
