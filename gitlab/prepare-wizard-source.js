'use strict';
// Keep public submodule coordinates portable while allowing a private primary.
const {execFileSync} = require('child_process');

function selection(environment) {
  const value = environment.WIZARD_PRIMARY_REPOSITORY_URL;
  if (!value) return null;
  const target = new URL(value), server = new URL(environment.CI_SERVER_URL);
  if (target.protocol !== 'https:' || server.protocol !== 'https:' || target.origin !== server.origin ||
      target.username || target.password || target.search || target.hash ||
      !/^\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.git)?$/.test(target.pathname) ||
      target.pathname.split('/').some(part => part === '.' || part === '..') ||
      !environment.CI_JOB_TOKEN) throw Error('Use a same-instance HTTPS Wizard repository selector and CI job token.');
  return {url: target.href, origin: server.origin, token: environment.CI_JOB_TOKEN};
}
function prepare(environment = process.env, run = execFileSync) {
  const selected = selection(environment);
  const git = (args, env = environment) => run('git', ['-c', 'core.hooksPath=/dev/null', ...args],
    {env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const row = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(git(['ls-tree', 'HEAD', '--', 'wizard']));
  if (!row) throw Error('The checkout must pin exactly one Wizard gitlink.');
  if (git(['config', '--file', '.gitmodules', '--get', 'submodule.wizard.path']) !== 'wizard')
    throw Error('Wizard submodule path changed.');
  let env = environment;
  const args = [];
  if (selected) {
    // Process-local config avoids credentials in URLs, argv, files or logs.
    // Disable inherited credential helpers and restrict this auth to our origin.
    env = {...environment, GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'http.' + selected.origin + '/.extraHeader',
      GIT_CONFIG_VALUE_1: 'Authorization: Basic ' + Buffer.from('gitlab-ci-token:' + selected.token).toString('base64'),
      GIT_CONFIG_KEY_2: 'http.followRedirects', GIT_CONFIG_VALUE_2: 'false',
      GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never'};
    args.push('-c', 'submodule.wizard.url=' + selected.url);
  }
  git([...args, 'submodule', 'update', '--init', '--checkout', '--', 'wizard'], env);
  if (git(['-C', 'wizard', 'rev-parse', 'HEAD']) !== row[1]) throw Error('Wizard checkout differs from its exact gitlink.');
  return row[1];
}
module.exports = {selection, prepare};
if (require.main === module) {
  try { prepare(); console.log('Wizard source checkout verified at the exact gitlink.'); }
  catch (_) { console.error('Wizard source checkout failed; inspect the configured primary, access and gitlink availability.'); process.exitCode = 1; }
}
