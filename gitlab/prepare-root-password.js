// Run inside the bootstrapper before GitLab's first database initialization.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function prepare(configDir, dataDir, supplied = '') {
  const target = path.join(configDir, 'bootstrapper_initial_root_password');
  if (fs.existsSync(target)) {
    fs.chmodSync(target, 0o600);
    return 'retained';
  }
  // Never manufacture an apparent login credential for an existing database.
  if (fs.existsSync(path.join(dataDir, 'postgresql'))) return 'existing-database';
  if (supplied && (supplied.length < 12 || /[\r\n\0]/.test(supplied))) {
    throw new Error('Initial root password needs at least 12 characters and no line breaks or NUL.');
  }
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(target, supplied || crypto.randomBytes(24).toString('hex'), {
    mode: 0o600, flag: 'wx'
  });
  return 'created';
}

module.exports = prepare;
if (require.main === module) {
  const state = prepare('/srv/gitlab/config', '/srv/gitlab/data',
    process.env.GITLAB_INITIAL_ROOT_PASSWORD || '');
  if (state === 'existing-database') {
    console.log('GitLab database already exists; initial root password was not changed.');
  } else {
    console.log('GitLab initial user: root (initial password is not a password reset).');
    console.log('Read locally: docker exec system_gitlab_1 cat /etc/gitlab/bootstrapper_initial_root_password');
  }
}
