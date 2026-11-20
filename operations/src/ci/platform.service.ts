import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ManagedChildProcess, type LifecycleProcess } from '../runtime/managed-child';

/** Coordinates the existing candidate checks and removes only this job's images. */
@Injectable()
export class PlatformCheckService {
  constructor(private readonly process: LifecycleProcess = new ManagedChildProcess()) {}
  async execute(
    root: string,
    environment: NodeJS.ProcessEnv,
    cleanupOnly = false,
    signal?: AbortSignal,
  ) {
    if (!/^\d+$/.test(environment.CI_JOB_ID || '')) throw new Error('numeric-ci-job-required');
    const env = {
      ...environment,
      SYSTEM_DISPOSABLE_CANDIDATE: 'I_ACCEPT_PRIVILEGED_DISPOSABLE_EXECUTION',
    };
    const run = (
      binary: string,
      args: string[],
      inherit = false,
      timeout: number | null = 8000,
      activeSignal: AbortSignal | null | undefined = signal,
    ) =>
      this.process.run(binary, args, {
        cwd: root,
        env,
        inherit,
        timeout,
        signal: activeSignal ?? undefined,
      });
    const cleanup = async () => {
      let failure: unknown;
      try {
        await run(
          process.execPath,
          ['tests/e2e/candidate.js', 'cleanup-all', 'test-results/e2e'],
          true,
          null,
          null,
        );
      } catch (error) {
        failure = error;
      }
      // The established identifier helper derives the exact disposable job names.
      const { identifiers } = require(path.join(root, 'tests/e2e/prepare-images.js')) as {
        identifiers(): Record<string, string>;
      };
      for (const name of Object.values(identifiers())) {
        try {
          const listed = await run(
            'docker',
            ['image', 'ls', '--filter', `reference=${name}`, '--format', '{{.ID}}'],
            false,
            8000,
            null,
          );
          if (!listed.trim()) continue;
          const rows: unknown = JSON.parse(
            await run('docker', ['image', 'inspect', name], false, 8000, null),
          );
          if (
            !Array.isArray(rows) ||
            rows.length !== 1 ||
            rows[0]?.Config?.Labels?.['org.system-bootstrapper.test-job'] !== environment.CI_JOB_ID
          )
            throw new Error('candidate-image-owner-mismatch');
          await run('docker', ['image', 'rm', name], false, 8000, null);
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure) throw failure;
    };
    if (cleanupOnly) return cleanup();
    let primary: unknown;
    try {
      fs.mkdirSync(path.join(root, 'test-results/successor'), { recursive: true });
      const report = await run(
        process.execPath,
        ['tests/bootstrapper/paused-controller-docker.js', '--allow-local-daemon'],
        false,
        null,
      );
      fs.writeFileSync(
        path.join(root, 'test-results/successor/controller-stop-primitive.json'),
        report,
      );
      process.stdout.write(report);
      await run(process.execPath, ['tests/e2e/prepare-images.js'], true, null);
      await run(
        process.execPath,
        ['tests/e2e/candidate.js', '.candidate-images/spec.json'],
        true,
        null,
      );
      await run(process.execPath, ['gitlab/publish-successor.js'], true, null);
    } catch (error) {
      primary = error;
    }
    try {
      await cleanup();
    } catch (error) {
      primary ??= error;
    }
    if (primary) throw primary;
  }
}
