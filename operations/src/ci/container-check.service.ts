import { ProcessFailure } from '../runtime/process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ManagedChildProcess, type LifecycleProcess } from '../runtime/managed-child';

type Check = 'isolated' | 'wizard-browser';
const components = [
  'all',
  'gitlab',
  'sync',
  'gitlab-runner',
  'bootstrapper',
  'nginx',
  'wizard',
  'shared',
  'performance',
];

/** Runs repository checks inside resource-bounded children without daemon access. */
@Injectable()
export class ContainerCheckService {
  constructor(private readonly process: LifecycleProcess = new ManagedChildProcess()) {}

  async execute(
    kind: Check,
    root: string,
    env: NodeJS.ProcessEnv,
    selection: string,
    signal?: AbortSignal,
  ) {
    if (!['isolated', 'wizard-browser'].includes(kind)) throw Error('unknown-container-check');
    if (![env.CI_PROJECT_ID, env.CI_JOB_ID].every((value) => /^\d+$/.test(value || '')))
      throw Error('numeric-ci-identities-required');
    const cleanupOnly = selection === 'cleanup';
    if (
      !cleanupOnly &&
      (kind === 'isolated' ? !components.includes(selection) : selection !== 'run')
    )
      throw Error('invalid-container-check-selection');
    const browser = kind === 'wizard-browser';
    const resource = `system-${browser ? 'wizard-browser' : 'tests'}-${env.CI_PROJECT_ID}-${env.CI_JOB_ID}`;
    const image = `system-${browser ? 'wizard-browser' : 'component-tests'}:ci-${env.CI_PROJECT_ID}-${env.CI_JOB_ID}`;
    const report = path.join(root, 'test-results', browser ? 'wizard-browser' : 'cleanup');
    const labels: Record<string, string> = {
      'org.system-bootstrapper.test-project': env.CI_PROJECT_ID!,
      'org.system-bootstrapper.test-job': env.CI_JOB_ID!,
      'org.system-bootstrapper.test-kind': kind,
    };
    const labelArgs = Object.entries(labels).flatMap(([key, value]) => [
      '--label',
      `${key}=${value}`,
    ]);
    fs.mkdirSync(report, { recursive: true });
    const run = (
      args: string[],
      timeout: number | null = 15000,
      inputFile?: string,
      independent = false,
    ) =>
      this.process.run('docker', args, {
        cwd: root,
        env,
        timeout,
        inputFile,
        signal: independent ? undefined : signal,
      });
    const list = (type: string, name: string, independent = false) =>
      run(
        [
          type,
          'ls',
          ...(type === 'container' ? ['--all'] : []),
          '--filter',
          type === 'container' ? `name=^/${name}$` : `reference=${name}`,
          '--format',
          type === 'container' ? '{{.Names}}' : '{{.Repository}}:{{.Tag}}',
        ],
        8000,
        undefined,
        independent,
      );
    const cleanup = async (phase: string) => {
      let failure: unknown;
      for (const [type, name] of [
        ['container', resource],
        ['image', image],
      ]) {
        try {
          const names = (await list(type, name, true)).trim();
          if (!names) continue;
          if (names !== name) throw Error('container-check-cleanup-name-mismatch');
          const rows: unknown = JSON.parse(
            await run([type, 'inspect', name], 8000, undefined, true),
          );
          if (
            !Array.isArray(rows) ||
            rows.length !== 1 ||
            Object.entries(labels).some(
              ([key, value]) => rows[0]?.Config?.Labels?.[key] !== value,
            ) ||
            !/^(?:sha256:)?[0-9a-f]{64}$/.test(rows[0]?.Id || '')
          )
            throw Error('container-check-cleanup-owner-mismatch');
          await run(
            [type, 'rm', ...(type === 'container' ? ['--force'] : []), rows[0].Id],
            8000,
            undefined,
            true,
          );
        } catch (error) {
          failure ??= error;
        }
      }
      fs.writeFileSync(
        path.join(report, `${browser ? 'cleanup-' : ''}${phase}.json`),
        JSON.stringify({ container: resource, image, status: failure ? 'failed' : 'passed' }) +
          '\n',
      );
      if (failure) throw failure;
    };
    if (cleanupOnly) return cleanup('after-script');
    const context = path.join(root, browser ? '.wizard-browser-context' : '.test-context');
    if (
      !/^[0-9a-f]{40}$/.test(env.CI_COMMIT_SHA || '') ||
      fs.readFileSync(path.join(context, 'revision'), 'utf8').trim() !== env.CI_COMMIT_SHA
    )
      throw Error('stale-container-check-context');
    const archive = path.join(context, 'context.tar');
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
    if (hash.digest('hex') !== fs.readFileSync(path.join(context, 'sha256'), 'utf8').trim())
      throw Error('container-check-context-checksum-mismatch');
    // Refuse collisions before building or arming cleanup; existing resources are untouched.
    if ((await list('container', resource)).trim() || (await list('image', image)).trim())
      throw Error('container-check-resource-already-exists');
    const config = fs.mkdtempSync(path.join(os.tmpdir(), 'container-check-'));
    fs.chmodSync(config, 0o700);
    fs.writeFileSync(path.join(config, 'config.json'), '{}\n', { mode: 0o600 });
    let primary: unknown;
    try {
      await run(
        [
          'build',
          ...labelArgs,
          '-f',
          browser ? 'tests/wizard-browser.Dockerfile' : 'tests/Dockerfile',
          '-t',
          image,
          '-',
        ],
        browser ? 480000 : null,
        archive,
      );
      await run([
        '--config',
        config,
        'create',
        '--name',
        resource,
        ...labelArgs,
        '--init',
        '--network',
        'none',
        '--memory',
        '2g',
        '--cpus',
        '2',
        '--pids-limit',
        '512',
        image,
        ...(browser ? [] : [selection]),
      ]);
      await run(['start', resource]);
      try {
        const status = (await run(['wait', resource], browser ? 240000 : null)).trim();
        if (status !== '0')
          primary = /^\d+$/.test(status)
            ? new ProcessFailure('container-check', Number(status), null, false)
            : Error('container-check-invalid-exit-status');
      } catch (error) {
        primary = error;
      }
      try {
        process.stdout.write(await run(['logs', resource], 15000, undefined, true));
      } catch (error) {
        primary ??= error;
      }
      try {
        await run(
          [
            'cp',
            `${resource}:/candidate/test-results/${browser ? 'wizard-browser/.' : '.'}`,
            browser ? report : path.join(root, 'test-results/'),
          ],
          20000,
          undefined,
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
    fs.rmSync(config, { recursive: true, force: true });
    if (
      browser &&
      (!fs.existsSync(path.join(report, 'junit.xml')) ||
        fs.statSync(path.join(report, 'junit.xml')).size === 0)
    ) {
      fs.writeFileSync(
        path.join(report, 'junit.xml'),
        '<?xml version="1.0"?><testsuite name="wizard-browser" tests="1" failures="1"><testcase name="full-native-browser-suite"><failure message="Browser build, launch, report copy or execution failed; see job log"/></testcase></testsuite>\n',
      );
      primary ??= Error('browser-check-missing-junit');
    }
    if (primary) throw primary;
  }
}
