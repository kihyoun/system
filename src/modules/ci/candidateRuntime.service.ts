import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managedChild';

/** Validates the actual packaged runtime in the socket-free candidate container. */
@Injectable()
export class CandidateRuntimeService {
  constructor(private readonly process: LifecycleProcess = new ManagedChildProcess()) {}

  async check(root: string, environment: NodeJS.ProcessEnv, signal?: AbortSignal) {
    const run = (binary: string, args: string[], cwd = root, inherit = true) =>
      this.process.run(binary, args, { cwd, env: environment, signal, timeout: null, inherit });
    for (const script of ['format:check', 'lint', 'check']) {
      await run('npm', ['run', script]);
    }
    await this.checkToolchain(root, environment, signal);
    await run('docker', ['--version']);
    await run('docker', ['compose', 'version']);
    await run(process.execPath, [
      path.join(root, 'dist/cli/main.js'),
      'source-prepare',
      root,
      '--verify',
    ]);
    await this.process.run(
      'docker',
      ['compose', '-p', 'system', '-f', 'config/system/docker-compose.yml', 'config', '--quiet'],
      {
        cwd: root,
        env: { ...environment, SEED_DIR: '/candidate/seed', PERSISTENT_DIR: '/candidate/platform' },
        signal,
        timeout: null,
        inherit: true,
      },
    );
  }

  async checkToolchain(
    root: string,
    environment: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<void> {
    const run = (binary: string, args: string[]) =>
      this.process.run(binary, args, { cwd: root, env: environment, signal, timeout: null });

    if (
      (await run(process.execPath, ['--version'])).trim() !== 'v24.22.0' ||
      (await run('npm', ['--version'])).trim() !== '11.19.1'
    ) {
      throw Error('candidate-runtime-version-mismatch');
    }
  }
}
