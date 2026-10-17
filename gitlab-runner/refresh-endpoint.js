'use strict';
const {spawnSync} = require('child_process');

function stableEndpoint(content) {
  if (!/^\s*network_mode = "system_gitlab"[ \t]*$/m.test(content)) return content;
  // Docker DNS survives GitLab recreation; a stored container IP does not.
  // Preserve tokens and all unrelated configuration, including external URLs.
  return content.replace(/^(\s*)(url|clone_url) = "http:\/\/(?:\d{1,3}\.){3}\d{1,3}\/"[ \t]*$/gm,
    '$1$2 = "http://gitlab/"');
}

function refresh(container) {
  if (!/^[a-z0-9][a-z0-9_-]+$/.test(container || '')) throw new Error('Invalid managed runner container.');
  const read = spawnSync('docker', ['exec', container, 'cat', '/etc/gitlab-runner/config.toml'], {encoding: 'utf8'});
  if (read.status !== 0) throw new Error('Could not read managed runner endpoint.');
  const updated = stableEndpoint(read.stdout);
  if (updated === read.stdout) return;
  const write = spawnSync('docker', ['exec', '-i', container, 'sh', '-c',
    'umask 077; cat > /etc/gitlab-runner/config.toml.endpoint-tmp && mv /etc/gitlab-runner/config.toml.endpoint-tmp /etc/gitlab-runner/config.toml'],
    {input: updated, encoding: 'utf8'});
  if (write.status !== 0) throw new Error('Could not update managed runner endpoint.');
  console.log('Managed runner now uses stable GitLab service discovery.');
}
module.exports = {stableEndpoint};
if (require.main === module) {
  try { refresh(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
