'use strict';

const fs = require('fs');
const path = require('path');

function definition(pool, count, persistentDirectory) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(pool || '')) throw new Error('Invalid runner pool name.');
  if (!/^(?:[0-9]|[1-4][0-9]|50)$/.test(String(count))) throw new Error('Runner count must be an integer from 0 to 50.');
  if (!persistentDirectory || !path.isAbsolute(persistentDirectory) || /[\0\r\n$]/.test(persistentDirectory)) {
    throw new Error('PERSISTENT_DIR must be an absolute host directory without shell interpolation.');
  }
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'docker-compose.yml'), 'utf8'));
  const template = base.services.docker;
  base.services = {};
  for (let index = 1; index <= Number(count); index++) {
    const service = JSON.parse(JSON.stringify(template));
    const directory = path.join(persistentDirectory, 'runners', pool, String(index));
    service.container_name = `${pool}_docker_${index}`;
    service.volumes = [
      {type: 'bind', source: '/var/run/docker.sock', target: '/var/run/docker.sock'},
      {type: 'bind', source: path.join(directory, 'config'), target: '/etc/gitlab-runner'},
      {type: 'bind', source: path.join(directory, 'home'), target: '/home/gitlab-runner'}
    ];
    base.services[`docker_${index}`] = service;
  }
  return base;
}

module.exports = {definition};
if (require.main === module) {
  try {
    const config = definition(process.argv[2], process.argv[3], process.argv[4]);
    if (process.argv[5] === '--prepare') {
      for (const service of Object.values(config.services)) {
        for (const mount of service.volumes.slice(1)) fs.mkdirSync(mount.source, {recursive: true, mode: 0o700});
      }
    }
    process.stdout.write(JSON.stringify(config));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
