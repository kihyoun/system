import { GitlabRunnerCredentialService } from '../gitlab-provision/runnerCredential.service';
import { Injectable, Inject } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ProcessFailure } from '../../common/runtime/process';
import { setTimeout as delay } from 'node:timers/promises';
import type { LifecycleProcess } from '../../common/runtime/managedChild';
import type { ConfigurationPort } from '../projects-routing/ports';
import { lifecycleChild, lifecycleConfiguration, settings, type LifecycleContext } from './types';
import { RunnerComposeService } from './runnerCompose.service';
export function withRunnerToken(content: string, token: string): string {
  if (!/^glrt-[A-Za-z0-9_.-]+$/.test(token)) {
    throw Error('Invalid runner token');
  }

  const assignment = `GITLAB_RUNNER_TOKEN='${token}'`,
    pattern = /^(?:export\s+)?GITLAB_RUNNER_TOKEN=.*$/m;
  return pattern.test(content)
    ? content.replace(pattern, assignment)
    : content + '\n' + assignment + '\n';
}
export function stableEndpoint(content: string): string {
  if (!/^\s*network_mode = "system_gitlab"[ \t]*$/m.test(content)) {
    return content;
  }

  return content.replace(
    /^(\s*)(url|clone_url) = "http:\/\/(?:\d{1,3}\.){3}\d{1,3}\/"[ \t]*$/gm,
    '$1$2 = "http://gitlab/"',
  );
}
@Injectable()
export class RunnerLifecycleService {
  constructor(
    @Inject(lifecycleChild) private readonly children: LifecycleProcess,
    @Inject(lifecycleConfiguration) private readonly configuration: ConfigurationPort,
    private readonly credentials: GitlabRunnerCredentialService,
    private readonly compose: RunnerComposeService,
  ) {}

  private run(context: LifecycleContext, binary: string, args: string[], input?: string) {
    return this.children.run(binary, args, {
      cwd: path.join(context.root, 'config/gitlab-runner'),
      env: context.environment,
      signal: context.signal,
      inheritGroup: context.supervisedGroup,
      timeout: 180000,
      input,
    });
  }

  private async ready(context: LifecycleContext, attempts: number) {
    for (let index = 0; index < attempts; index++) {
      try {
        await this.run(context, 'docker', [
          'exec',
          'system_gitlab_1',
          'curl',
          '-fsS',
          '--max-time',
          '3',
          'http://127.0.0.1/-/readiness',
        ]);
        return;
      } catch (error) {
        if (context.signal?.aborted) {
          throw error;
        }

        if (index === attempts - 1) {
          throw Error('GitLab did not become ready for runner setup.');
        }

        await delay(2000, undefined, { signal: context.signal });
      }
    }
  }

  async provisionToken(
    context: LifecycleContext,
    rotation?: { id: number; operation: string },
    reconcile = false,
  ) {
    const file = path.join(context.state, '.docker.env'),
      content = fs.readFileSync(file, 'utf8'),
      token = context.environment.GITLAB_RUNNER_TOKEN;

    if (!rotation && !reconcile && token && token !== 'secret-token' && token !== 'secret') {
      return;
    }

    const response = await this.credentials.current({
      checkout: context.root,
      persistentDirectory: context.environment.PERSISTENT_DIR || '',
      signal: context.signal,
      rotateRunnerId: rotation?.id,
      rotation: rotation?.operation,
      startupOperation: context.environment.SYSTEM_STARTUP_OPERATION,
    });
    const updated = withRunnerToken(content, response.token);

    if (fs.readFileSync(file, 'utf8') !== content) {
      throw Error('Configuration changed during runner setup; retry after Fetch.');
    }

    const temporary = file + '.' + process.pid + '.runner-tmp';
    try {
      fs.writeFileSync(temporary, updated, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  reconciliation(context: LifecycleContext, startupOperation: string, operation: string) {
    return this.credentials.reconciliation(
      { checkout: context.root, signal: context.signal },
      startupOperation,
      operation,
    );
  }

  private async register(context: LifecycleContext, container: string, name: string) {
    const token = context.environment.GITLAB_RUNNER_TOKEN;

    if (!token || token === 'secret-token') {
      return;
    }

    let registered = false;
    try {
      await this.run(context, 'docker', [
        'exec',
        container,
        'grep',
        '-q',
        '^\\[\\[runners\\]\\]',
        '/etc/gitlab-runner/config.toml',
      ]);
      registered = true;
    } catch (error) {
      if (context.signal?.aborted) {
        throw error;
      }
    }

    if (registered) {
      await this.refreshEndpoint(context, container);
      await this.run(context, 'docker', ['exec', container, 'gitlab-runner', 'verify']);
      return;
    }

    await this.ready(context, 90);
    const modern = token.startsWith('glrt-');
    const policy = JSON.parse(
      fs.readFileSync(path.join(context.root, 'config/gitlab/security-release.json'), 'utf8'),
    );
    const variable = modern ? 'CI_SERVER_TOKEN' : 'REGISTRATION_TOKEN';
    await this.run(
      { ...context, environment: { ...context.environment, [variable]: token } },
      'docker',
      [
        'exec',
        '--env',
        variable,
        container,
        'gitlab-runner',
        'register',
        '--non-interactive',
        ...(modern
          ? []
          : ['--tag-list', 'docker,aws', '--run-untagged=true', '--access-level=not_protected']),
        '--executor',
        'docker',
        '--docker-image',
        'docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb',
        '--docker-helper-image',
        context.environment.GITLAB_RUNNER_HELPER_IMAGE || policy.runner.helperImage,
        '--url',
        'http://gitlab/',
        '--description',
        name,
        '--clone-url',
        'http://gitlab/',
        '--docker-network-mode',
        'system_gitlab',
        '--docker-extra-hosts',
        context.environment.GITLAB_HOST + ':host-gateway',
        '--docker-extra-hosts',
        context.environment.GITLAB_REGISTRY_HOST + ':host-gateway',
        '--docker-volumes',
        '/var/run/docker.sock:/var/run/docker.sock',
        '--docker-privileged=true',
      ],
    );
  }

  async refreshEndpoint(context: LifecycleContext, container: string): Promise<void> {
    if (!/^[a-z0-9][a-z0-9_-]+$/.test(container)) {
      throw Error('Invalid managed runner container.');
    }

    const previous = await this.run(context, 'docker', [
      'exec',
      container,
      'cat',
      '/etc/gitlab-runner/config.toml',
    ]);
    const updated = stableEndpoint(previous);

    if (previous === updated) {
      return;
    }

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'system-runner-endpoint-')),
      local = path.join(directory, 'config.toml'),
      remote = '/etc/gitlab-runner/config.toml.endpoint-' + randomUUID();
    let copied = false,
      uncertain = false;
    try {
      fs.writeFileSync(local, updated, { mode: 0o600, flag: 'wx' });
      copied = true;
      await this.run(context, 'docker', ['cp', local, container + ':' + remote]);
      await this.run(context, 'docker', [
        'exec',
        container,
        'mv',
        '-f',
        '--',
        remote,
        '/etc/gitlab-runner/config.toml',
      ]);
      copied = false;
    } catch (error) {
      uncertain = error instanceof ProcessFailure && error.uncertain;
      throw error;
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });

      // An interrupted remote copy/rename may still own its private temporary file.
      // Its startup lease remains held; do not race that worker during cleanup.
      if (copied && !uncertain) {
        await this.run(context, 'docker', ['exec', container, 'rm', '-f', '--', remote]);
      }
    }
  }

  async runPool(context: LifecycleContext, action: 'up' | 'down', pool: string): Promise<void> {
    if (!['up', 'down'].includes(action) || !/^[a-z0-9][a-z0-9_-]*$/.test(pool)) {
      throw Error('Invalid runner pool.');
    }

    const count = context.environment.GITLAB_RUNNER_SCALE || '';

    if (!/^(?:[0-9]|[1-4][0-9]|50)$/.test(count)) {
      throw Error('Runner count must be an integer from 0 to 50.');
    }

    const up = action === 'up' && count !== '0',
      temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'system-runner-compose-'));
    try {
      const definition = this.compose.definition(
        pool,
        up ? count : '1',
        context.environment.PERSISTENT_DIR || '',
        path.join(context.root, 'config/gitlab-runner/docker-compose.yml'),
      );

      if (up) {
        this.compose.prepare(definition);
      }

      const file = path.join(temporary, 'compose.json');
      fs.writeFileSync(file, JSON.stringify(definition), { mode: 0o600 });
      await this.run(context, 'docker', [
        '--host=unix:///var/run/docker.sock',
        'compose',
        '--compatibility',
        '-p',
        pool,
        '-f',
        file,
        ...(up ? ['up', '--remove-orphans', '-d'] : ['down', '--remove-orphans']),
      ]);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  async runPools(
    context: LifecycleContext,
    action: 'start' | 'stop' | 'register' | 'unregister',
    scope?: string,
  ): Promise<void> {
    if (scope && !['main', 'projects'].includes(scope)) {
      throw Error('Invalid runner scope.');
    }

    const main = path.join(context.root, 'config/system/.docker.env'),
      gitlab = path.join(context.root, 'config/gitlab/.docker.env');

    if (!fs.existsSync(main) || !fs.existsSync(gitlab)) {
      return;
    }

    const base = {
      ...context,
      environment: settings(this.configuration, [main, gitlab], context.environment),
    };
    const pools: { pool: string; name: string; context: LifecycleContext; file?: string }[] = [];

    if (!scope || scope === 'main') {
      pools.push({ pool: 'runner', name: 'runner-docker', context: base });
    }

    if (!scope || scope === 'projects') {
      for (const directory of ['.projects.env', 'projects.env']) {
        const parent = path.join(context.root, 'config/system', directory);

        if (!fs.existsSync(parent)) {
          continue;
        }

        for (const file of fs.readdirSync(parent).sort()) {
          if (!file.endsWith('.env') || !fs.statSync(path.join(parent, file)).isFile()) {
            continue;
          }

          const environment = settings(
              this.configuration,
              [path.join(parent, file)],
              base.environment,
            ),
            name = environment.PROJECT_NAME;

          if (environment.PROJECT_TEMPLATE === 'wizard' && name === 'wizard') {
            continue;
          }

          if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
            throw Error('Invalid runner pool name.');
          }

          pools.push({
            pool: name + '_runner',
            name: name + '-runner-docker',
            context: { ...base, environment },
            file: path.join(parent, file),
          });
        }
      }
    }

    for (const selected of pools) {
      const count = selected.context.environment.GITLAB_RUNNER_SCALE || '';

      if (!/^(?:[0-9]|[1-4][0-9]|50)$/.test(count)) {
        throw Error('Runner count must be an integer from 0 to 50.');
      }

      if (action === 'register' || action === 'unregister') {
        continue;
      }

      await this.runPool(selected.context, action === 'start' ? 'up' : 'down', selected.pool);
    }

    if (action === 'stop') {
      return;
    }

    if (action === 'unregister') {
      for (const selected of pools) {
        for (
          let index = 1;
          index <= Number(selected.context.environment.GITLAB_RUNNER_SCALE);
          index++
        ) {
          await this.run(selected.context, 'docker', [
            'exec',
            selected.pool + '_docker_' + index,
            'gitlab-runner',
            'unregister',
            '--all-runners',
          ]);
        }
      }
      return;
    }

    if ((!scope || scope === 'main') && Number(base.environment.GITLAB_RUNNER_SCALE) > 0) {
      await this.ready(base, 180);
      await this.provisionToken(base);
      base.environment = settings(this.configuration, [main, gitlab], context.environment);
      for (const selected of pools) {
        selected.context = {
          ...base,
          environment: selected.file
            ? settings(this.configuration, [selected.file], base.environment)
            : base.environment,
        };
      }
    }

    for (const selected of pools) {
      for (
        let index = 1;
        index <= Number(selected.context.environment.GITLAB_RUNNER_SCALE);
        index++
      ) {
        await this.register(
          selected.context,
          selected.pool + '_docker_' + index,
          selected.name + '-' + index,
        );
      }
    }
  }
}
