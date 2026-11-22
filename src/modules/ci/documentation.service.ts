import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managedChild';
import { ProcessFailure } from '../../common/runtime/process';

@Injectable()
export class DocumentationCheckService {
  constructor(private readonly process: LifecycleProcess = new ManagedChildProcess()) {}

  async execute(root: string, env: NodeJS.ProcessEnv, cleanupOnly = false, signal?: AbortSignal) {
    if (![env.CI_PROJECT_ID, env.CI_JOB_ID].every((value) => /^\d+$/.test(value || ''))) {
      throw Error('numeric-ci-identities-required');
    }

    const resource = `system-documentation-${env.CI_PROJECT_ID}-${env.CI_JOB_ID}`;
    const label = 'org.system-bootstrapper.documentation-job';
    const owner = `${env.CI_PROJECT_ID}:${env.CI_JOB_ID}`;
    const report = path.join(root, 'test-results/documentation');
    fs.mkdirSync(report, { recursive: true });
    const docker = (args: string[], timeout = 8000, independent = false) =>
      this.process.run('docker', args, {
        cwd: root,
        env,
        timeout,
        signal: independent ? undefined : signal,
      });
    const list = (independent = false) =>
      docker(
        ['container', 'ls', '--all', '--filter', `name=^/${resource}$`, '--format', '{{.Names}}'],
        8000,
        independent,
      );
    const cleanup = async (phase: string) => {
      let failure: unknown;
      try {
        const names = (await list(true)).trim();

        if (names) {
          if (names !== resource) {
            throw Error('documentation-cleanup-name-mismatch');
          }

          const rows: unknown = JSON.parse(
            await docker(['container', 'inspect', resource], 8000, true),
          );

          if (
            !Array.isArray(rows) ||
            rows.length !== 1 ||
            rows[0]?.Config?.Labels?.[label] !== owner ||
            !/^[0-9a-f]{64}$/.test(rows[0]?.Id || '')
          ) {
            throw Error('documentation-cleanup-owner-mismatch');
          }

          await docker(['container', 'rm', '--force', rows[0].Id], 8000, true);
        }
      } catch (error) {
        failure = error;
      }
      fs.writeFileSync(
        path.join(report, `cleanup-${phase}.json`),
        JSON.stringify({ status: failure ? 'failed' : 'passed' }) + '\n',
      );

      if (failure) {
        throw failure;
      }
    };

    if (cleanupOnly) {
      return cleanup('after-script');
    }

    if (!/^[0-9a-f]{40}$/.test(env.CI_COMMIT_SHA || '')) {
      throw Error('full-source-revision-required');
    }

    const git = (args: string[], cwd = root, input?: string, inputFile?: string) =>
      this.process.run('git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', ...args], {
        cwd,
        env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
        input,
        inputFile,
        timeout: 20000,
        signal,
        maxBuffer: 8 * 1024 * 1024,
      });

    if ((await git(['rev-parse', '--verify', 'HEAD^{commit}'])).trim() !== env.CI_COMMIT_SHA) {
      throw Error('documentation-checkout-revision-mismatch');
    }

    let base = '';
    switch (env.CI_PIPELINE_SOURCE) {
      case 'merge_request_event':
        base = env.CI_MERGE_REQUEST_DIFF_BASE_SHA || '';
        break;
      case 'push':
        base = env.CI_COMMIT_BEFORE_SHA || '';
        break;
      case 'web':
      case 'schedule':
        try {
          base = (await git(['rev-parse', '--verify', 'HEAD^'])).trim();
        } catch {
          base = '';
        }
        break;
      default:
        throw Error('unsupported-documentation-pipeline-source');
    }

    if (base && !/^[0-9a-f]{40}$/.test(base)) {
      throw Error('invalid-documentation-base');
    }

    if (base === '0'.repeat(40)) {
      if (env.CI_PIPELINE_SOURCE !== 'push') {
        throw Error('invalid-zero-documentation-base');
      }

      base = '';
    } else if (!base && ['push', 'merge_request_event'].includes(env.CI_PIPELINE_SOURCE || '')) {
      throw Error('missing-documentation-base');
    }

    if ((await list()).trim()) {
      throw Error('documentation-resource-already-exists');
    }

    // Git creates pack temporaries in its object directory before renaming them
    // beside the output prefix. Keep that rename on the same filesystem, even
    // when the checkout or a linked worktree's common Git directory is mounted.
    const objects = path.resolve(root, (await git(['rev-parse', '--git-path', 'objects'])).trim());
    const temporary = fs.mkdtempSync(path.join(objects, 'documentation-check-'));
    fs.chmodSync(temporary, 0o700);
    const candidate = path.join(temporary, 'candidate'),
      config = path.join(temporary, 'docker-config');
    fs.mkdirSync(candidate);
    fs.mkdirSync(config);
    let primary: unknown;
    try {
      await git(['-c', 'init.templateDir=', 'init', '-q', candidate]);
      const ids = await git([
        'rev-list',
        '--objects',
        '--no-object-names',
        '--no-walk',
        env.CI_COMMIT_SHA!,
        ...(base ? [base] : []),
      ]);
      const pack = (await git(['pack-objects', path.join(temporary, 'objects')], root, ids)).trim();

      if (!/^[0-9a-f]{40}$/.test(pack)) {
        throw Error('invalid-documentation-pack');
      }

      await git(
        ['index-pack', '--stdin'],
        candidate,
        undefined,
        path.join(temporary, `objects-${pack}.pack`),
      );
      await git(['update-ref', 'HEAD', env.CI_COMMIT_SHA!], candidate);
      await git(['hash-object', '-w', '-t', 'tree', '--stdin'], candidate, '');
      // Copy only the compiled, dependency-free checker and its process adapter.
      // The CI build compiles these sources from the pinned candidate checkout.
      const runtime = path.resolve(__dirname, '../..');
      for (const file of [
        'modules/ci/documentationCheckEntry.js',
        'modules/ci/documentationPolicy.js',
        'modules/ci/documentationGit.js',
      ]) {
        const destination = path.join(candidate, 'runtime', file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(runtime, file), destination);
      }
      const readable = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const name = path.join(directory, entry.name);

          if (entry.isDirectory()) {
            readable(name);
            fs.chmodSync(name, 0o755);
          } else {
            fs.chmodSync(name, 0o644);
          }
        }
      };
      readable(candidate);
      fs.chmodSync(candidate, 0o777);
      const image =
        'node:24.22.0-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5';
      await docker(['pull', image], 45000);
      await docker(
        [
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
          '256m',
          '--cpus',
          '1',
          '--pids-limit',
          '64',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          ...[
            'CI_PIPELINE_SOURCE',
            'CI_COMMIT_SHA',
            'CI_MERGE_REQUEST_DIFF_BASE_SHA',
            'CI_COMMIT_BEFORE_SHA',
          ].flatMap((key) => ['--env', `${key}=${env[key] || ''}`]),
          '--env',
          'GIT_CONFIG_COUNT=1',
          '--env',
          'GIT_CONFIG_KEY_0=safe.directory',
          '--env',
          'GIT_CONFIG_VALUE_0=/candidate',
          '--workdir',
          '/candidate',
          '--entrypoint',
          'node',
          image,
          '/candidate/runtime/modules/ci/documentationCheckEntry.js',
        ],
        10000,
      );
      await docker(['cp', candidate, `${resource}:/`], 10000);
      await docker(['start', resource]);
      try {
        const status = (await docker(['wait', resource], 45000)).trim();

        if (status !== '0') {
          primary = /^\d+$/.test(status)
            ? new ProcessFailure('documentation-check', Number(status), null, false)
            : Error('invalid-documentation-exit');
        }
      } catch (error) {
        primary = error;
      }
      try {
        process.stdout.write(await docker(['logs', resource], 8000, true));
      } catch (error) {
        primary ??= error;
      }
      try {
        await docker(
          ['cp', `${resource}:/candidate/test-results/documentation/.`, report],
          8000,
          true,
        );
      } catch (error) {
        primary ??= error;
      }
    } catch (error) {
      primary ??= error;
    }
    try {
      await cleanup('on-exit');
    } catch (error) {
      primary ??= error;
    }
    fs.rmSync(temporary, { recursive: true, force: true });

    if (primary) {
      throw primary;
    }
  }
}
