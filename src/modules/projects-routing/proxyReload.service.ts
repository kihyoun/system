import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProcessFailure, type ProcessRunner } from '../../common/runtime/process';
import { routingProcess } from './ports';

export class ProxyReloadRecoveryRequired extends Error {
  readonly uncertain = true;
  constructor(
    readonly snapshot: string,
    cause: unknown,
  ) {
    super('Proxy reload needs recovery; retain its owned lease and snapshot at ' + snapshot + '.', {
      cause,
    });
  }
}

/** Coordinate native operations in the exact running proxy; never send a shell program. */
@Injectable()
export class ProxyReloadService {
  constructor(@Inject(routingProcess) private readonly process: ProcessRunner) {}

  reload(): void {
    const docker = (args: string[]) =>
      this.process.run('docker', ['--host=unix:///var/run/docker.sock', ...args], {
        timeout: 180000,
        maxBuffer: 65536,
      }).stdout;
    const id = docker(['container', 'inspect', '--format', '{{.Id}}', 'system_web_1']).trim();

    if (!/^[a-f0-9]{64}$/.test(id)) {
      throw Error('Exact running proxy identity required.');
    }

    const run = (...args: string[]) => docker(['exec', id, ...args]);
    const lease = '/tmp/system-routing-reload.lock';
    const snapshot = lease + '/snapshot-' + randomUUID();
    // A killed/uncertain coordinator leaves this exclusive directory for recovery.
    // Never adopt or remove a previous owner's lease, even after a name is reused.
    run('mkdir', '-m', '700', '--', lease);
    let preserve = false;
    try {
      run('mkdir', '-m', '700', '--', snapshot);
      run('cp', '-a', '--', '/etc/nginx/conf.d/.', snapshot + '/');
      try {
        // This is the pinned upstream NGINX image's renderer, not repository shell orchestration.
        run('/docker-entrypoint.d/20-envsubst-on-templates.sh');
        run('nginx', '-t');
        run('nginx', '-s', 'reload');
      } catch (error) {
        if (error instanceof ProcessFailure && error.uncertain) {
          preserve = true;
          throw new ProxyReloadRecoveryRequired(snapshot, error);
        }

        try {
          run(
            'find',
            '/etc/nginx/conf.d',
            '-mindepth',
            '1',
            '-maxdepth',
            '1',
            '-name',
            '*.conf',
            '!',
            '-type',
            'd',
            '-exec',
            'rm',
            '-f',
            '--',
            '{}',
            '+',
          );
          run('cp', '-a', '--', snapshot + '/.', '/etc/nginx/conf.d/');
          run('nginx', '-t');
          run('nginx', '-s', 'reload');
        } catch (rollback) {
          preserve = true;
          throw new ProxyReloadRecoveryRequired(snapshot, rollback);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof ProcessFailure && error.uncertain) {
        preserve = true;
        throw new ProxyReloadRecoveryRequired(snapshot, error);
      }

      throw error;
    } finally {
      if (!preserve) {
        try {
          run('rm', '-rf', '--', snapshot);
          run('rmdir', '--', lease);
        } catch (error) {
          // Cleanup failure remains visible and a held lease blocks an overlapping retry.
          throw new ProxyReloadRecoveryRequired(snapshot, error);
        }
      }
    }
  }
}
