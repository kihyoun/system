import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ManagedChildProcess, type LifecycleProcess } from '../runtime/managed-child';

/** Validates the actual packaged runtime in the socket-free candidate container. */
@Injectable()
export class CandidateRuntimeService {
  constructor(private readonly process: LifecycleProcess = new ManagedChildProcess()) {}
  async check(root: string, environment: NodeJS.ProcessEnv, signal?: AbortSignal) {
    const run = (binary: string, args: string[], cwd = root, inherit = true) =>
      this.process.run(binary, args, { cwd, env: environment, signal, timeout: null, inherit });
    for (const [component, scripts] of [
      ['sync', ['format:check', 'lint', 'check']],
      ['operations', ['format:check', 'check']],
    ] as const) {
      for (const script of scripts) await run('npm', ['run', script], path.join(root, component));
    }
    if (
      (await run(process.execPath, ['--version'], root, false)).trim() !== 'v24.22.0' ||
      (await run('npm', ['--version'], root, false)).trim() !== '11.19.1'
    )
      throw Error('candidate-runtime-version-mismatch');
    await run('docker', ['--version']);
    await run('docker', ['compose', 'version']);
    await run(process.execPath, ['project-bootstrap/wizard-source/package.js', '--verify']);
    await this.process.run(
      'docker',
      ['compose', '-p', 'system', '-f', 'system/docker-compose.yml', 'config', '--quiet'],
      {
        cwd: root,
        env: { ...environment, SEED_DIR: '/candidate/seed', PERSISTENT_DIR: '/candidate/platform' },
        signal,
        timeout: null,
        inherit: true,
      },
    );
  }
}
