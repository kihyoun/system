import { cliArguments } from '../../common/runtime/installationPaths';
import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { startupBegin, startupFinish, startupSettled } from '../storage/lease';
import { ProcessFailure } from '../../common/runtime/process';
import type { LifecycleProcess } from '../../common/runtime/managedChild';
import type { ConfigurationPort } from '../projects-routing/ports';
import { ProjectsRoutingService } from '../projects-routing/projectsRouting.service';
import { WizardRecoveryService } from '../wizard-recovery/wizardRecovery.service';
import { RunnerLifecycleService } from './runner.service';
import { RootPasswordService } from './rootPassword.service';
import { WizardPublicSettingsService } from './publicSettings.service';
import { initializeMountedState } from '../storage/persistence';
import { lifecycleChild, lifecycleConfiguration, settings, type LifecycleContext } from './types';
export const lifecyclePathsToken = Symbol('LIFECYCLE_PATHS');
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
    @Inject(lifecycleChild) private readonly children: LifecycleProcess,
    @Inject(lifecycleConfiguration) private readonly configuration: ConfigurationPort,
    private readonly routing: ProjectsRoutingService,
    private readonly runners: RunnerLifecycleService,
    private readonly recovery: WizardRecoveryService,
    private readonly rootPassword: RootPasswordService,
    private readonly publicSettings: WizardPublicSettingsService,
    @Inject(lifecyclePathsToken) private readonly paths: LifecyclePaths = lifecyclePaths,
  ) {}

  private command(
    context: LifecycleContext,
    binary: string,
    args: string[],
    directory = 'config/system',
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
    return fs.existsSync(path.join(context.root, 'config/system/.docker.env'));
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
      path.join(context.root, 'config/system/docker-compose.yml'),
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

    if (!/^[0-9a-fA-F:.]+$/.test(value)) {
      throw Error('Invalid service address.');
    }

    fs.writeFileSync(path.join(context.root, filename), 'export ' + key + '=' + value + '\n', {
      mode: 0o600,
    });
    return value;
  }

  async wizard(context: LifecycleContext, start: boolean) {
    const selected = this.configured(context)
      ? this.load(context, ['config/system/.docker.env'])
      : context;

    if (!this.configured(context) || selected.environment.WIZARD_ENABLE === 'true') {
      await this.compose(
        selected,
        'wizard',
        start ? ['up', '--remove-orphans', '--build', '-d'] : ['stop'],
      );
    }

    if (start) {
      await this.address(selected, 'wizard', 'wizard/.docker.env', 'WIZARD_IP');
    }
  }

  async applyWizardImage(context: LifecycleContext, snapshot: string, compose: string) {
    if (!path.isAbsolute(snapshot) || !path.isAbsolute(compose)) {
      throw Error('Absolute configuration snapshot and Compose paths required.');
    }

    const environment = settings(this.configuration, [snapshot], context.environment);

    if (
      !/^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64})$/.test(
        environment.WIZARD_IMAGE || '',
      )
    ) {
      throw Error('Only immutable Wizard images can be applied.');
    }

    await this.command({ ...context, environment }, 'docker', [
      '--host=unix:///var/run/docker.sock',
      'compose',
      '--compatibility',
      '-f',
      compose,
      'up',
      '--no-deps',
      '--pull',
      'never',
      '-d',
      'wizard',
    ]);
  }

  async gitlab(context: LifecycleContext, start: boolean) {
    if (!this.configured(context)) {
      return;
    }

    const selected = this.load(context, ['config/system/.docker.env']);

    if (!start) {
      await this.compose(selected, 'gitlab', ['stop']);
      return;
    }

    if (
      fs.existsSync(path.join(this.paths.gitlabData, '.system-bootstrapper-restore-incomplete'))
    ) {
      throw Error('An interrupted Seed restore must be completed before GitLab startup.');
    }

    fs.mkdirSync(this.paths.gitlabConfig, { recursive: true });
    const password = this.rootPassword.prepare(
      this.paths.gitlabConfig,
      this.paths.gitlabData,
      selected.environment.GITLAB_INITIAL_ROOT_PASSWORD || '',
    );

    if (password === 'existing-database') {
      console.log('GitLab database already exists; initial root password was not changed.');
    } else {
      console.log('GitLab initial user: root (initial password is not a password reset).');
      console.log(
        'Read locally: docker exec system_gitlab_1 cat /etc/gitlab/bootstrapper_initial_root_password',
      );
    }

    const values = {
      ...selected.environment,
      DISABLE_INSECURE_REGISTRY:
        Number(selected.environment.GITLAB_REGISTRY_DOMAIN_MODE) < 2 ? '' : '#',
    };
    const rendered = fs
      .readFileSync(path.join(context.root, 'config/gitlab/gitlab.rb'), 'utf8')
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
        path.join(context.root, 'config/system/docker-compose.yml'),
        ...(selected.environment.GITLAB_OMNIBUS_CONFIG
          ? ['-f', path.join(context.root, 'config/gitlab/docker-compose.omnibus.yml')]
          : []),
        'up',
        ...(changed ? ['--force-recreate'] : []),
        '-d',
        'gitlab',
      ],
      'config/gitlab',
    );
    await this.address(selected, 'gitlab', 'config/gitlab/.docker.env', 'GITLAB_IP');
  }

  async intermediate(context: LifecycleContext, start: boolean): Promise<void> {
    if (start) {
      await this.gitlab(context, true);

      if (this.configured(context)) {
        const selected = this.load(context, ['config/system/.docker.env']);
        await this.recovery.recover({
          checkout: context.root,
          settings: { ...selected.environment, SYSTEM_CONFIG_DIR: context.state },
          configDirectory: this.paths.gitlabConfig,
          signal: context.signal,
        });
      }

      this.routing.run({ action: 'proxies', root: context.root });
      try {
        await this.runners.runPools(context, 'start');
      } catch (error) {
        if (context.signal?.aborted || (error instanceof ProcessFailure && error.uncertain)) {
          throw error;
        }

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
      ]) {
        try {
          await stop();
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length) {
        throw new AggregateError(errors, 'Intermediate service shutdown failed.');
      }
    }
  }

  async sync(context: LifecycleContext, start: boolean) {
    if (this.configured(context) && start) {
      const selected = this.load(context, ['config/system/.docker.env']);

      if (selected.environment.SYNC_ENABLE === 'true') {
        await this.command(
          selected,
          process.execPath,
          cliArguments('api', [], context.root),
          '.',
          true,
        );
      }

      return;
    }

    let selected = this.load(context, [
      'config/system/.seed.env',
      '.docker.env',
      'wizard/.docker.env',
    ]);

    if (context.environment.SEED_DIR !== undefined) {
      selected.environment.SEED_DIR = context.environment.SEED_DIR;
    }

    if (start) {
      const template = fs
        .readFileSync(path.join(context.root, 'templates/nginx/default.sync.template'), 'utf8')
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
      await this.command(
        selected,
        process.execPath,
        cliArguments('api', [], context.root),
        '.',
        true,
      );
    } else {
      await this.compose(selected, 'sync', ['stop']);
    }
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

      if (errors.length) {
        throw new AggregateError(errors, 'Main service shutdown failed.');
      }

      return;
    }

    this.routing.run({ action: 'start', root: context.root });
    const selected = this.load(context, ['config/system/.docker.env']);

    if (
      selected.environment.SYNC_ENABLE !== 'true' &&
      selected.environment.WIZARD_ENABLE === 'true'
    ) {
      try {
        await this.command(
          selected,
          process.execPath,
          cliArguments('default-wizard', [], context.root),
          '.',
        );
      } catch (error) {
        if (context.signal?.aborted) {
          throw error;
        }

        console.error(
          'System Wizard registration failed; the existing interface remains available.',
        );
      }
    }

    if (context.environment.SYSTEM_STARTUP_OPERATION) {
      startupFinish(context.state, context.environment.SYSTEM_STARTUP_OPERATION);
    }

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

      if (ready) {
        return;
      }

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
    ]) {
      await this.children.run('git', args, {
        cwd: context.root,
        env: context.environment,
        signal: context.signal,
        timeout: 180000,
      });
    }
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
    ) {
      throw Error('Unknown lifecycle action.');
    }

    if (action === 'start') {
      if (
        fs.existsSync(path.join(this.paths.gitlabData, '.system-bootstrapper-restore-incomplete'))
      ) {
        throw Error('An interrupted Seed restore must be completed before startup.');
      }

      let operation: string;
      try {
        operation = startupBegin(context.state, process.pid);
      } catch (error) {
        if (error instanceof Error && error.message === 'storage-operation-busy') {
          console.error(
            'Startup paused for an unfinished operation; native recovery remains available through Docker exec.',
          );
          while (!context.signal?.aborted) {
            await delay(60000, undefined, { signal: context.signal });
          }
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
        initializeMountedState(
          path.resolve(context.state),
          path.join(context.root, 'config/system'),
        );
        this.publicSettings.publishMounted(context.state, '/wizard-public');
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

          if (
            this.load(active, ['config/system/.docker.env']).environment.SYNC_ENABLE === 'false'
          ) {
            await this.waitSync(active);
          }
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
        ) {
          settled = null;
        }

        throw error;
      } finally {
        startupSettled(context.state, operation, settled);
      }
    } else if (action === 'start-main') {
      await this.main(context, true);
    } else if (action === 'start-intermediate') {
      await this.intermediate(context, true);
    } else if (action === 'stop-main') {
      await this.main(context, false);
    } else if (action === 'stop-intermediate') {
      await this.intermediate(context, false);
    } else {
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

      if (errors.length) {
        throw new AggregateError(errors, 'Service shutdown failed.');
      }
    }
  }
}
