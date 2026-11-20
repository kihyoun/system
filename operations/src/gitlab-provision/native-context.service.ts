import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import type { LifecycleProcess } from '../runtime/managed-child';
import { GITLAB_PROVISION_PROCESS, type GitlabNativeContext } from './native-api.service';
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('gitlab-owned-container-required');
  return value as Record<string, unknown>;
}
/** Resolve the local owned GitLab once; all subsequent calls use its immutable ID. */
@Injectable()
export class GitlabNativeContextService {
  constructor(@Inject(GITLAB_PROVISION_PROCESS) private readonly child: LifecycleProcess) {}
  async resolve(
    checkout: string,
    configDirectory = '/srv/gitlab/config',
    signal?: AbortSignal,
  ): Promise<GitlabNativeContext> {
    if (
      !path.isAbsolute(checkout) ||
      fs.realpathSync(checkout) !== checkout ||
      !fs.statSync(checkout).isDirectory() ||
      !path.isAbsolute(configDirectory) ||
      fs.realpathSync(configDirectory) !== configDirectory
    )
      throw Error('gitlab-native-path-invalid');
    const config = fs.statSync(configDirectory, { bigint: true });
    if (!config.isDirectory()) throw Error('gitlab-native-config-volume-required');
    const run = (args: string[]) =>
      this.child.run('docker', ['--host=unix:///var/run/docker.sock', ...args], {
        cwd: checkout,
        env: process.env,
        signal,
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
      });
    let container: Record<string, unknown>;
    try {
      container = row(
        JSON.parse(await run(['inspect', '--format', '{{json .}}', 'system_gitlab_1'])),
      );
    } catch {
      throw Error('gitlab-owned-container-required');
    }
    const labels = row(row(container.Config).Labels);
    if (
      typeof container.Id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(container.Id) ||
      container.Name !== '/system_gitlab_1' ||
      row(container.State).Running !== true ||
      labels['com.docker.compose.project'] !== 'system' ||
      labels['com.docker.compose.service'] !== 'gitlab' ||
      !Array.isArray(container.Mounts)
    )
      throw Error('gitlab-owned-container-required');
    const mounts = container.Mounts.map(row).filter((mount) => mount.Destination === '/etc/gitlab');
    if (
      mounts.length !== 1 ||
      mounts[0].RW !== true ||
      !['bind', 'volume'].includes(String(mounts[0].Type))
    )
      throw Error('gitlab-native-config-volume-required');
    const identity = (
      await run(['exec', container.Id, 'stat', '--format=%d:%i', '--', '/etc/gitlab'])
    ).trim();
    if (identity !== `${config.dev}:${config.ino}`)
      throw Error('gitlab-native-config-volume-mismatch');
    return { checkout, containerId: container.Id, signal };
  }
}
