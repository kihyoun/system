'use strict';

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

// Replace only this assignment; in particular, preserve the signature bytes.
function withToken(content, token) {
  if (!/^glrt-[A-Za-z0-9_.-]+$/.test(token)) throw new Error('Invalid runner token');
  const assignment = `GITLAB_RUNNER_TOKEN='${token}'`;
  const pattern = /^(?:export\s+)?GITLAB_RUNNER_TOKEN=.*$/m;
  return pattern.test(content) ? content.replace(pattern, assignment) : content + '\n' + assignment + '\n';
}

function provision() {
  const configPath = path.join(__dirname, '../system/.docker.env');
  const content = fs.readFileSync(configPath, 'utf8');
  // The shell has already sourced this file. Never print its credentials.
  const current = process.env.GITLAB_RUNNER_TOKEN || '';
  if (current && current !== 'secret-token' && current !== 'secret') return;
  const script = fs.readFileSync(path.join(__dirname, 'provision.rb'), 'utf8');
  const result = spawnSync('docker', ['exec', '-i', 'system_gitlab_1', 'gitlab-rails', 'runner', '-'], {
    input: script, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024
  });
  // Rails error output may contain credentials. Do not relay it to logs or Sync.
  if (result.status !== 0) throw new Error('Automatic runner creation failed; check GitLab readiness and version (16+ required).');
  const lines = result.stdout.trim().split('\n');
  const runner = JSON.parse(lines[lines.length - 1]);
  const updated = withToken(content, runner.token);
  // Fail rather than overwrite a concurrent Wizard Push.
  if (fs.readFileSync(configPath, 'utf8') !== content) throw new Error('Configuration changed during runner setup; retry after Fetch.');
  const temp = configPath + `.${process.pid}.runner-tmp`;
  try {
    fs.writeFileSync(temp, updated, {mode: 0o600, flag: 'wx'});
    fs.renameSync(temp, configPath);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  console.log('Instance runner pool ready; temporary setup access revoked. Fetch to load its runner token.');
}

module.exports = {withToken};
if (require.main === module) {
  try { provision(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
