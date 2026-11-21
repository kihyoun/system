import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managed-child';
/** Retains the native upstream build role without passing registry credentials in argv. */
@Injectable()
export class BootstrapperBuildService {
  constructor(private readonly process: LifecycleProcess = new ManagedChildProcess()) {}

  async build(root: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    if (
      !path.isAbsolute(root) ||
      ![env.CI_REGISTRY, env.CI_REGISTRY_USER, env.CI_REGISTRY_PASSWORD, env.IMAGE_TAG].every(
        (value) => typeof value === 'string' && value.length > 0 && !/[\r\n\0]/.test(value),
      )
    )
      throw Error('native-registry-build-inputs-required');
    const config = fs.mkdtempSync(path.join(os.tmpdir(), 'system-native-build-'));
    fs.chmodSync(config, 0o700);
    const run = (args: string[], input?: string) =>
      this.process.run('docker', ['--config', config, ...args], {
        cwd: root,
        env,
        signal,
        input,
        timeout: null,
        inherit: input === undefined,
      });
    try {
      await run(
        ['login', '--username', env.CI_REGISTRY_USER!, '--password-stdin', env.CI_REGISTRY!],
        env.CI_REGISTRY_PASSWORD! + '\n',
      );
      await run([
        'build',
        '--provenance=false',
        '--sbom=false',
        '-f',
        'containers/bootstrapper/Dockerfile',
        '-t',
        env.IMAGE_TAG!,
        '.',
      ]);
      await run(['push', env.IMAGE_TAG!]);
    } finally {
      fs.rmSync(config, { recursive: true, force: true });
    }
  }
}
