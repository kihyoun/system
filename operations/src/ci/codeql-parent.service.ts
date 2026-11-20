import { ProcessFailure } from '../runtime/process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ManagedChildProcess, type LifecycleProcess } from '../runtime/managed-child';

/** Trusted Docker boundary: only the committed source archive enters the scanner. */
@Injectable()
export class CodeqlParentService {
  constructor(private readonly process: LifecycleProcess = new ManagedChildProcess()) {}

  async execute(root: string, env: NodeJS.ProcessEnv, cleanupOnly = false, signal?: AbortSignal) {
    if (![env.CI_PROJECT_ID, env.CI_JOB_ID].every((value) => /^\d+$/.test(value || '')))
      throw Error('numeric-ci-identities-required');
    const owner = `${env.CI_PROJECT_ID}:${env.CI_JOB_ID}`;
    const resource = `system-codeql-${env.CI_PROJECT_ID}-${env.CI_JOB_ID}`;
    const image = `system-codeql:ci-${env.CI_PROJECT_ID}-${env.CI_JOB_ID}`;
    const label = 'org.system-bootstrapper.codeql-job';
    const report = path.join(root, 'test-results/codeql');
    fs.mkdirSync(report, { recursive: true });
    const run = (args: string[], timeout = 15000, inputFile?: string, cleanup = false) =>
      this.process.run('docker', args, {
        cwd: root,
        env,
        timeout,
        inputFile,
        signal: cleanup ? undefined : signal,
      });
    const cleanup = async (phase: string) => {
      let failure: unknown;
      for (const [kind, name, filter, format] of [
        ['container', resource, `name=^/${resource}$`, '{{.Names}}'],
        ['image', image, `reference=${image}`, '{{.Repository}}:{{.Tag}}'],
      ]) {
        try {
          const names = (
            await run(
              [
                kind,
                'ls',
                ...(kind === 'container' ? ['--all'] : []),
                '--filter',
                filter,
                '--format',
                format,
              ],
              8000,
              undefined,
              true,
            )
          ).trim();
          if (!names) continue;
          if (names !== name) throw Error('codeql-cleanup-name-mismatch');
          const rows: unknown = JSON.parse(
            await run([kind, 'inspect', name], 8000, undefined, true),
          );
          if (
            !Array.isArray(rows) ||
            rows.length !== 1 ||
            rows[0]?.Config?.Labels?.[label] !== owner ||
            !/^sha256:[0-9a-f]{64}$|^[0-9a-f]{64}$/.test(rows[0]?.Id || '')
          )
            throw Error('codeql-cleanup-owner-mismatch');
          await run(
            [kind, 'rm', ...(kind === 'container' ? ['--force'] : []), rows[0].Id],
            8000,
            undefined,
            true,
          );
        } catch (error) {
          failure ??= error;
        }
      }
      fs.writeFileSync(
        path.join(report, `cleanup-${phase}.json`),
        JSON.stringify({ status: failure ? 'failed' : 'passed' }) + '\n',
      );
      if (failure) throw failure;
    };
    if (cleanupOnly) return cleanup('after-script');
    const context = path.join(root, '.codeql-context');
    if (
      !/^[0-9a-f]{40}$/.test(env.CI_COMMIT_SHA || '') ||
      fs.readFileSync(path.join(context, 'revision'), 'utf8').trim() !== env.CI_COMMIT_SHA
    )
      throw Error('stale-codeql-source-context');
    const checksum = fs.readFileSync(path.join(context, 'sha256'), 'utf8').trim();
    const archive = path.join(context, 'context.tar');
    const digest = createHash('sha256');
    for await (const chunk of fs.createReadStream(archive)) digest.update(chunk);
    if (!/^[0-9a-f]{64}$/.test(checksum) || digest.digest('hex') !== checksum)
      throw Error('codeql-source-context-checksum-mismatch');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codeql-parent-'));
    fs.chmodSync(temporary, 0o700);
    const config = path.join(temporary, 'docker-config');
    fs.mkdirSync(config, { mode: 0o700 });
    let primary: unknown;
    try {
      await run(
        [
          '--config',
          config,
          'build',
          '--label',
          `${label}=${owner}`,
          '-f',
          'source/tests/codeql/Dockerfile',
          '-t',
          image,
          '-',
        ],
        900000,
        archive,
      );
      await run([
        '--config',
        config,
        'create',
        '--name',
        resource,
        '--label',
        `${label}=${owner}`,
        '--init',
        '--user',
        '1000:1000',
        '--network',
        'none',
        '--memory',
        '6g',
        '--memory-swap',
        '6g',
        '--cpus',
        '2',
        '--pids-limit',
        '256',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        image,
      ]);
      await run(['start', resource]);
      let status: string | undefined;
      try {
        status = (await run(['wait', resource], 900000)).trim();
      } catch (error) {
        primary = error;
      }
      // Collect available evidence even after cancellation; do not hide the original failure.
      try {
        const log = await run(['logs', resource], 15000, undefined, true);
        fs.writeFileSync(path.join(report, 'scan.log'), log);
        process.stdout.write(log);
      } catch (error) {
        primary ??= error;
      }
      for (const file of ['tool.json', 'results.sarif', 'gate.json']) {
        try {
          await run(
            ['cp', `${resource}:/reports/${file}`, path.join(report, file)],
            15000,
            undefined,
            true,
          );
        } catch (error) {
          primary ??= error;
        }
      }
      fs.copyFileSync(path.join(context, 'manifest.json'), path.join(report, 'source.json'));
      if (status !== '0')
        primary ??=
          status && /^\d+$/.test(status)
            ? new ProcessFailure('codeql-scanner', Number(status), null, false)
            : Error('codeql-scanner-invalid-exit-status');
    } catch (error) {
      primary ??= error;
    }
    try {
      await cleanup('on-exit');
    } catch (error) {
      primary ??= error;
    }
    fs.rmSync(temporary, { recursive: true, force: true });
    if (primary) throw primary;
  }
}
