import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { startupBegin, startupFinish, startupSettled } from '../storage/lease';
import { ProcessFailure } from '../runtime/process';
import type { LifecycleProcess } from '../runtime/managed-child';
import type { ConfigurationPort } from '../projects-routing/ports';
import { ProjectsRoutingService } from '../projects-routing/projects-routing.service';
import { RunnerLifecycleService } from './runner.service';
import { LIFECYCLE_CHILD, LIFECYCLE_CONFIGURATION, settings, type LifecycleContext } from './types';
export const LIFECYCLE_PATHS = Symbol('LIFECYCLE_PATHS');
export interface LifecyclePaths {
  gitlabConfig: string;
  gitlabData: string;
  syncTemplates: string;
}
export const lifecyclePaths: LifecyclePaths = {
  gitlabConfig: '/srv/gitlab/config',
  gitlabData: '/srv/gitlab/data',
  syncTemplates: '/synctemplates',
};
export type LifecycleAction =
  'start' | 'start-main' | 'start-intermediate' | 'stop' | 'stop-main' | 'stop-intermediate';
@Injectable()
export class LifecycleService {
  constructor(
    @Inject(LIFECYCLE_CHILD) private readonly children: LifecycleProcess,
    @Inject(LIFECYCLE_CONFIGURATION) private readonly configuration: ConfigurationPort,
    private readonly routing: ProjectsRoutingService,
    private readonly runners: RunnerLifecycleService,
    @Inject(LIFECYCLE_PATHS) private readonly paths: LifecyclePaths = lifecyclePaths,
  ) {}
  private command(
    context: LifecycleContext,
    binary: string,
    args: string[],
    directory = 'system',
    long = false,
  ) {
    return this.children.run(binary, args, {
      cwd: path.join(context.root, directory),
      env: context.environment,
      signal: context.signal,
      timeout: long ? null : 180000,
      inherit: long,
      inheritGroup: context.supervisedGroup === true,
    });
  }
  private configured(context: LifecycleContext): boolean {
    return fs.existsSync(path.join(context.root, 'system/.docker.env'));
  }
  private load(context: LifecycleContext, files: string[]): LifecycleContext {
    return {
      ...context,
      environment: settings(
        this.configuration,
        files.map((file) => path.join(context.root, file)),
        context.environment,
      ),
    };
  }
  private compose(context: LifecycleContext, service: string, args: string[]) {
    return this.command(context, 'docker', [
      '--host=unix:///var/run/docker.sock',
      'compose',
      '--compatibility',
      '-f',
      '../system/docker-compose.yml',
      ...args,
      service,
    ]);
  }
  private async address(context: LifecycleContext, service: string, filename: string, key: string) {
    const value = (
      await this.command(context, 'docker', [
        'inspect',
        '-f',
        '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        'system_' + service + '_1',
      ])
    ).trim();
    if (!/^[0-9a-fA-F:.]+$/.test(value)) throw Error('Invalid service address.');
    fs.writeFileSync(path.join(context.root, filename), 'export ' + key + '=' + value + '\n', {
      mode: 0o600,
    });
    return value;
  }
  async wizard(context: LifecycleContext, start: boolean) {
    const selected = this.configured(context)
      ? this.load(context, ['system/.docker.env'])
      : context;
    if (!this.configured(context) || selected.environment.WIZARD_ENABLE === 'true')
      await this.compose(
        selected,
        'wizard',
        start ? ['up', '--remove-orphans', '--build', '-d'] : ['stop'],
      );
    if (start) await this.address(selected, 'wizard', 'wizard/.docker.env', 'WIZARD_IP');
  }
  async gitlab(context: LifecycleContext, start: boolean) {
    if (!this.configured(context)) return;
    const selected = this.load(context, ['system/.docker.env']);
    if (!start) {
      await this.compose(selected, 'gitlab', ['stop']);
      return;
    }
    if (fs.existsSync(path.join(this.paths.gitlabData, '.system-bootstrapper-restore-incomplete')))
      throw Error('An interrupted Seed restore must be completed before GitLab startup.');
    fs.mkdirSync(this.paths.gitlabConfig, { recursive: true });
    await this.command(
      selected,
      process.execPath,
      [path.join(context.root, 'gitlab/prepare-root-password.js')],
      'gitlab',
    );
    const values = {
      ...selected.environment,
      DISABLE_INSECURE_REGISTRY:
        Number(selected.environment.GITLAB_REGISTRY_DOMAIN_MODE) < 2 ? '' : '#',
    };
    const rendered = fs
      .readFileSync(path.join(context.root, 'gitlab/gitlab.rb'), 'utf8')
      .replace(
        /\$\{(GITLAB_REGISTRY_URL|GITLAB_REGISTRY_HOST|GITLAB_EXTERNAL_URL|DISABLE_INSECURE_REGISTRY)\}/g,
        (_, key: string) => values[key as keyof typeof values] || '',
      );
    const file = path.join(this.paths.gitlabConfig, 'gitlab.rb');
    const changed = !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== rendered;
    if (changed) {
      const temporary = fs.mkdtempSync(path.join(this.paths.gitlabConfig, '.gitlab-rb-'));
      try {
        fs.writeFileSync(path.join(temporary, 'record'), rendered, { mode: 0o600 });
        fs.renameSync(path.join(temporary, 'record'), file);
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }
    await this.command(
      selected,
      'docker',
      [
        '--host=unix:///var/run/docker.sock',
        'compose',
        '--compatibility',
        '-f',
        '../system/docker-compose.yml',
        ...(selected.environment.GITLAB_OMNIBUS_CONFIG
          ? ['-f', '../gitlab/docker-compose.omnibus.yml']
          : []),
        'up',
        ...(changed ? ['--force-recreate'] : []),
        '-d',
        'gitlab',
      ],
      'gitlab',
    );
    await this.address(selected, 'gitlab', 'gitlab/.docker.env', 'GITLAB_IP');
  }
  async intermediate(context: LifecycleContext, start: boolean): Promise<void> {
    if (start) {
      await this.gitlab(context, true);
      if (this.configured(context))
        await this.command(this.load(context, ['system/.docker.env']), process.execPath, [
          path.join(context.root, 'system/wizard-image-recovery.js'),
        ]);
      this.routing.run({ action: 'proxies', root: context.root });
      try {
        await this.runners.runPools(context, 'start');
      } catch (error) {
        if (context.signal?.aborted || (error instanceof ProcessFailure && error.uncertain))
          throw error;
        console.error(
          'Runner setup failed. The platform will continue so you can correct the configuration in the Wizard.',
        );
      }
      await this.wizard(context, true);
    } else {
      // Try every stop, but never turn a partially stopped platform into a successful result.
      const errors: unknown[] = [];
      for (const stop of [
        () => this.wizard(context, false),
        () => this.runners.runPools(context, 'stop'),
        () => this.routing.run({ action: 'stop-proxies', root: context.root }),
        () => this.gitlab(context, false),
      ])
        try {
          await stop();
        } catch (error) {
          errors.push(error);
        }
      if (errors.length) throw new AggregateError(errors, 'Intermediate service shutdown failed.');
    }
  }
  async sync(context: LifecycleContext, start: boolean) {
    if (this.configured(context) && start) {
      const selected = this.load(context, ['system/.docker.env']);
      if (selected.environment.SYNC_ENABLE === 'true')
        await this.command(selected, process.execPath, ['dist/index.js'], 'sync', true);
      return;
    }
    let selected = this.load(context, ['system/.seed.env', '.docker.env', 'wizard/.docker.env']);
    if (context.environment.SEED_DIR !== undefined)
      selected.environment.SEED_DIR = context.environment.SEED_DIR;
    if (start) {
      const template = fs
        .readFileSync(path.join(context.root, 'nginx/.templates/default.sync.template'), 'utf8')
        .replace(/\$\{SYNC_IP\}/g, selected.environment.BOOTSTRAPPER_IP || '')
        .replace(/\$\{WIZARD_IP\}/g, selected.environment.WIZARD_IP || '');
      fs.writeFileSync(path.join(this.paths.syncTemplates, 'default.conf.template'), template);
      await this.compose(selected, 'sync', [
        'up',
        '--build',
        '--remove-orphans',
        '--force-recreate',
        '-d',
      ]);
      await this.command(selected, process.execPath, ['dist/index.js'], 'sync', true);
    } else await this.compose(selected, 'sync', ['stop']);
  }
  async main(context: LifecycleContext, start: boolean): Promise<void> {
    if (!start) {
      const errors: unknown[] = [];
      try {
        await this.sync(context, false);
      } catch (error) {
        errors.push(error);
      }
      try {
        this.routing.run({ action: 'stop', root: context.root });
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, 'Main service shutdown failed.');
      return;
    }
    this.routing.run({ action: 'start', root: context.root });
    const selected = this.load(context, ['system/.docker.env']);
    if (
      selected.environment.SYNC_ENABLE !== 'true' &&
      selected.environment.WIZARD_ENABLE === 'true'
    ) {
      try {
        await this.command(selected, process.execPath, ['dist/DefaultWizard.js'], 'sync');
      } catch (error) {
        if (context.signal?.aborted) throw error;
        console.error(
          'System Wizard registration failed; the existing interface remains available.',
        );
      }
    }
    if (context.environment.SYSTEM_STARTUP_OPERATION)
      startupFinish(context.state, context.environment.SYSTEM_STARTUP_OPERATION);
    await this.sync(context, true);
  }
  private async waitSync(context: LifecycleContext): Promise<void> {
    while (!context.signal?.aborted) {
      const ready = await new Promise<boolean>((resolve) => {
        const socket = net.connect({ host: context.environment.BOOTSTRAPPER_IP, port: 8071 });
        socket.setTimeout(1000);
        const settle = (value: boolean) => {
          socket.destroy();
          resolve(value);
        };
        socket.once('connect', () => settle(true));
        socket.once('error', () => settle(false));
        socket.once('timeout', () => settle(false));
      });
      if (ready) return;
      await delay(1000, undefined, { signal: context.signal });
    }
    throw new ProcessFailure('sync-listener', null, 'SIGTERM', true);
  }
  async refreshSource(context: LifecycleContext): Promise<void> {
    await this.intermediate(context, false);
    for (const args of [
      ['reset', '--hard'],
      ['pull', '-r'],
      ['submodule', 'update'],
    ])
      await this.children.run('git', args, {
        cwd: context.root,
        env: context.environment,
        signal: context.signal,
        timeout: 180000,
      });
  }
  async run(action: LifecycleAction, context: LifecycleContext): Promise<void> {
    if (
      ![
        'start',
        'start-main',
        'start-intermediate',
        'stop',
        'stop-main',
        'stop-intermediate',
      ].includes(action)
    )
      throw Error('Unknown lifecycle action.');
    if (action === 'start') {
      if (
        fs.existsSync(path.join(this.paths.gitlabData, '.system-bootstrapper-restore-incomplete'))
      )
        throw Error('An interrupted Seed restore must be completed before startup.');
      let operation: string;
      try {
        operation = startupBegin(context.state, process.pid);
      } catch (error) {
        if (error instanceof Error && error.message === 'storage-operation-busy') {
          console.error(
            'Startup paused for an unfinished operation; native recovery remains available through Docker exec.',
          );
          while (!context.signal?.aborted)
            await delay(60000, undefined, { signal: context.signal });
          return;
        }
        throw error;
      }
      const active: LifecycleContext = {
        ...context,
        environment: { ...context.environment, SYSTEM_STARTUP_OPERATION: operation },
      };
      let settled: number | null = 1;
      try {
        await this.command(active, process.execPath, [
          path.join(context.root, 'system/persistence-init.js'),
        ]);
        await this.command(active, process.execPath, [
          path.join(context.root, 'system/wizard-public.js'),
        ]);
        active.environment = settings(
          this.configuration,
          [path.join(context.state, 'sync-auth.env')],
          active.environment,
        );
        active.environment.BOOTSTRAPPER_IP = await this.address(
          active,
          'bootstrapper',
          '.docker.env',
          'BOOTSTRAPPER_IP',
        );
        if (this.configured(active)) {
          await this.intermediate(active, true);
          await this.main(active, true);
          if (this.load(active, ['system/.docker.env']).environment.SYNC_ENABLE === 'false')
            await this.waitSync(active);
        } else {
          await this.wizard(active, true);
          startupFinish(context.state, operation);
          await this.sync(active, true);
        }
        await this.main(active, false);
        await this.intermediate(active, false);
        settled = 0;
      } catch (error) {
        if (
          context.signal?.aborted ||
          (error instanceof ProcessFailure && error.uncertain) ||
          error instanceof AggregateError
        )
          settled = null;
        throw error;
      } finally {
        startupSettled(context.state, operation, settled);
      }
    } else if (action === 'start-main') await this.main(context, true);
    else if (action === 'start-intermediate') await this.intermediate(context, true);
    else if (action === 'stop-main') await this.main(context, false);
    else if (action === 'stop-intermediate') await this.intermediate(context, false);
    else {
      const errors: unknown[] = [];
      try {
        await this.main(context, false);
      } catch (error) {
        errors.push(error);
      }
      try {
        await this.intermediate(context, false);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, 'Service shutdown failed.');
    }
  }
}
