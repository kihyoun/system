import 'reflect-metadata';
import { fileLock } from '../runtime/file-lock';
import path from 'node:path';
import fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { LifecycleModule } from './lifecycle.module';
import { LifecycleService, type LifecycleAction } from './lifecycle.service';
import { RunnerLifecycleService } from './runner.service';
import { startupAllowed, startupBegin, startupSettled } from '../storage/lease';
import { inheritedUpgrade } from './upgrade-lease';
import { ProcessFailure } from '../runtime/process';
export async function main(args = process.argv.slice(2), environment = process.env): Promise<void> {
  const [action, root, scope, pool] = args;
  if (!root || !path.isAbsolute(root)) throw Error('Absolute lifecycle checkout required.');
  const controller = new AbortController();
  let signal: NodeJS.Signals | undefined;
  const interrupt = (value: NodeJS.Signals) => {
    signal = value;
    controller.abort();
  };
  const term = () => interrupt('SIGTERM'),
    int = () => interrupt('SIGINT');
  process.on('SIGTERM', term);
  process.on('SIGINT', int);
  const app = await NestFactory.createApplicationContext(LifecycleModule, {
    logger: false,
    abortOnError: false,
  });
  const state = environment.SYSTEM_CONFIG_DIR || '/state';
  let unlock: (() => void) | undefined;
  let operation: string | undefined,
    settled: number | null = 1;
  try {
    if (/^runner-(start|stop|register|unregister)$/.test(action))
      unlock = fileLock('/tmp/system-bootstrapper-runner-registration.lock');
    const upgrade =
      (action.startsWith('runner-') || action === 'gitlab-start') &&
      inheritedUpgrade(state, environment.SYSTEM_GITLAB_UPGRADE_OPERATION);
    if (action !== 'start') {
      // Reuse only a matching inherited owner; a stale environment token grants no lease.
      const inherited = environment.SYSTEM_STARTUP_OPERATION;
      const owner = path.join(state, '.storage-operation-lock/startup-owner.json');
      let reused = upgrade;
      if (
        !upgrade &&
        inherited?.startsWith('startup-') &&
        fs.existsSync(owner) &&
        fs.lstatSync(owner).isFile() &&
        !fs.lstatSync(owner).isSymbolicLink()
      ) {
        const value = JSON.parse(fs.readFileSync(owner, 'utf8'));
        reused =
          value.format === 'system-controller-startup-v1' && value.operation === inherited.slice(8);
      } else if (!upgrade && inherited?.startsWith('staged-'))
        reused = startupAllowed(state, true)?.operation === inherited.slice(7);
      if (!reused) operation = startupBegin(state, process.pid);
    }
    const context = {
      root,
      state,
      environment: {
        ...environment,
        ...(operation ? { SYSTEM_STARTUP_OPERATION: operation } : {}),
      },
      signal: controller.signal,
      supervisedGroup: upgrade,
    };
    if (action === 'refresh-source') await app.get(LifecycleService).refreshSource(context);
    else if (action === 'wizard-apply-image')
      await app.get(LifecycleService).applyWizardImage(context, scope, pool);
    else if (action === 'gitlab-start' || action === 'gitlab-stop')
      await app.get(LifecycleService).gitlab(context, action === 'gitlab-start');
    else if (action === 'wizard-start' || action === 'wizard-stop')
      await app.get(LifecycleService).wizard(context, action === 'wizard-start');
    else if (action === 'sync-start' || action === 'sync-stop')
      await app.get(LifecycleService).sync(context, action === 'sync-start');
    else if (action === 'runner-provision')
      await app.get(RunnerLifecycleService).provisionToken(context);
    else if (action === 'runner-refresh')
      await app.get(RunnerLifecycleService).refreshEndpoint(context, scope);
    else if (action === 'runner-pool')
      await app.get(RunnerLifecycleService).runPool(context, scope as 'up' | 'down', pool);
    else if (action.startsWith('runner-')) {
      const mode = action.slice(7);
      if (!['start', 'stop', 'register', 'unregister'].includes(mode))
        throw Error('Unknown runner action.');
      await app
        .get(RunnerLifecycleService)
        .runPools(context, mode as 'start' | 'stop' | 'register' | 'unregister', scope);
    } else await app.get(LifecycleService).run(action as LifecycleAction, context);
    settled = 0;
  } catch (error) {
    if (
      signal ||
      (error instanceof ProcessFailure && error.uncertain) ||
      error instanceof AggregateError
    )
      settled = null;
    throw error;
  } finally {
    try {
      if (operation) startupSettled(state, operation, settled);
    } finally {
      unlock?.();
      await app.close();
      process.off('SIGTERM', term);
      process.off('SIGINT', int);
      if (signal) process.exitCode = signal === 'SIGTERM' ? 143 : 130;
    }
  }
}
if (require.main === module)
  main().catch((error: unknown) => {
    console.error(
      error instanceof ProcessFailure
        ? 'Lifecycle command failed.'
        : error instanceof Error
          ? error.message
          : 'Lifecycle failed.',
    );
    process.exitCode ||= 1;
  });
