import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';

interface RunnerMount {
  type: 'bind';
  source: string;
  target: string;
}

interface RunnerServiceDefinition {
  container_name: string;
  volumes: RunnerMount[];
  [key: string]: unknown;
}

export interface RunnerComposeDefinition {
  services: Record<string, RunnerServiceDefinition>;
  [key: string]: unknown;
}

/** Materialize one owned pool from the retained declarative Compose template. */
@Injectable()
export class RunnerComposeService {
  definition(
    pool: string,
    count: string | number,
    persistentDirectory: string,
    template: string,
  ): RunnerComposeDefinition {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(pool || '')) throw Error('Invalid runner pool name.');
    if (!/^(?:[0-9]|[1-4][0-9]|50)$/.test(String(count)))
      throw Error('Runner count must be an integer from 0 to 50.');
    if (
      !persistentDirectory ||
      !path.isAbsolute(persistentDirectory) ||
      /[\0\r\n$]/.test(persistentDirectory)
    )
      throw Error('PERSISTENT_DIR must be an absolute host directory without shell interpolation.');
    const base = JSON.parse(fs.readFileSync(template, 'utf8')) as RunnerComposeDefinition;
    const original = base.services.docker;
    base.services = {};
    for (let index = 1; index <= Number(count); index++) {
      const service = structuredClone(original);
      const directory = path.join(persistentDirectory, 'runners', pool, String(index));
      service.container_name = `${pool}_docker_${index}`;
      service.volumes = [
        { type: 'bind', source: '/var/run/docker.sock', target: '/var/run/docker.sock' },
        { type: 'bind', source: path.join(directory, 'config'), target: '/etc/gitlab-runner' },
        { type: 'bind', source: path.join(directory, 'home'), target: '/home/gitlab-runner' },
      ];
      base.services[`docker_${index}`] = service;
    }
    return base;
  }

  prepare(definition: RunnerComposeDefinition): void {
    for (const service of Object.values(definition.services))
      for (const mount of service.volumes.slice(1))
        fs.mkdirSync(mount.source, { recursive: true, mode: 0o700 });
  }
}
