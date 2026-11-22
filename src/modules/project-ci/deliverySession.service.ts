import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { LifecycleProcess } from '../../common/runtime/managedChild';
import { projectCiProcess } from './environmentLauncher.service';
import { buildkitImage, DeliveryIdentity } from './deliveryPolicy';
export interface DeliveryResource {
  kind: 'container' | 'network' | 'image';
  id: string;
  name: string;
}
export class DeliverySession {
  readonly operation = crypto.randomBytes(12).toString('hex');
  readonly resources: DeliveryResource[] = [];
  readonly auth = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-delivery-auth-'));
  readonly builder: string;
  builderCreated = false;
  readonly uncertain = new Set<string>();
  constructor(
    readonly process: LifecycleProcess,
    readonly root: string,
    readonly env: NodeJS.ProcessEnv,
    readonly identity: DeliveryIdentity,
    readonly signal?: AbortSignal,
  ) {
    fs.chmodSync(this.auth, 0o700);
    this.builder = `wizard-${identity.project}-${identity.job}-${this.operation}`;
  }

  run(args: string[], timeout = 180000, cleanup = false, input = ''): Promise<string> {
    return this.process.run('docker', ['--config', this.auth, ...args], {
      cwd: this.root,
      env: this.env,
      timeout,
      signal: cleanup ? undefined : this.signal,
      input,
    });
  }

  async login(): Promise<void> {
    const {
      CI_REGISTRY: registry,
      CI_REGISTRY_USER: user,
      CI_REGISTRY_PASSWORD: password,
    } = this.env;

    if (!registry || !user || !password || /[\r\n\0]/.test(registry + user)) {
      throw Error('Job registry credentials required');
    }

    await this.run(
      ['login', '--username', user, '--password-stdin', registry],
      180000,
      false,
      password + '\n',
    );
  }

  async createBuilder(): Promise<void> {
    this.uncertain.add(this.builder);
    await this.run([
      'buildx',
      'create',
      '--name',
      this.builder,
      '--driver',
      'docker-container',
      '--driver-opt',
      'memory=4g',
      '--driver-opt',
      'cpu-period=100000',
      '--driver-opt',
      'cpu-quota=200000',
      '--driver-opt',
      'image=' + buildkitImage,
    ]);
    this.builderCreated = true;
    this.uncertain.delete(this.builder);
  }

  async own(kind: DeliveryResource['kind'], name: string, id?: string): Promise<string> {
    const actual = (id || (await this.run([kind, 'inspect', '--format', '{{.Id}}', name]))).trim();

    if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(actual)) {
      throw Error('Invalid native resource identity');
    }

    this.resources.push({ kind, name, id: actual });
    return actual;
  }

  async createContainer(name: string, args: string[]): Promise<string> {
    this.uncertain.add(name);
    const id = (
      await this.run([
        'create',
        '--label',
        'system-bootstrapper.project-ci=' + this.operation,
        '--name',
        name,
        ...args,
      ])
    ).trim();
    const owned = await this.own('container', name, id);
    this.uncertain.delete(name);
    return owned;
  }

  async buildImage(name: string, args: string[]): Promise<void> {
    this.uncertain.add(name);
    await this.run(args, 900000);
    await this.own('image', name);
    this.uncertain.delete(name);
  }

  async createNetwork(name: string): Promise<string> {
    this.uncertain.add(name);
    const id = (
      await this.run([
        'network',
        'create',
        '--internal',
        '--label',
        'system-bootstrapper.project-ci=' + this.operation,
        name,
      ])
    ).trim();
    await this.own('network', name, id);
    this.uncertain.delete(name);
    return id;
  }

  async cleanup(): Promise<void> {
    const errors: string[] = [...this.uncertain].map(
      (name) => 'Uncertain native creation retained: ' + name,
    );
    for (const item of [...this.resources].reverse()) {
      try {
        const current = (
          await this.run([item.kind, 'inspect', '--format', '{{.Id}}', item.name], 15000, true)
        ).trim();

        if (current !== item.id) {
          throw Error('Owned resource identity changed: ' + item.name);
        }

        if (item.kind === 'container') {
          const owner = (
            await this.run(
              [
                'container',
                'inspect',
                '--format',
                '{{index .Config.Labels "system-bootstrapper.project-ci"}}',
                item.id,
              ],
              15000,
              true,
            )
          ).trim();

          if (owner !== this.operation) {
            throw Error('Owned container label changed');
          }

          await this.run(['stop', '--time', '10', item.id], 20000, true);
          await this.run(['rm', item.id], 15000, true);
        } else if (item.kind === 'network') {
          await this.run(['network', 'rm', item.id], 15000, true);
        } else {
          await this.run(['image', 'rm', item.id], 30000, true);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Native cleanup failed');
      }
    }

    if (this.builderCreated) {
      try {
        const name = (
          await this.run(['buildx', 'inspect', this.builder, '--format', '{{.Name}}'], 15000, true)
        ).trim();

        if (name !== this.builder) {
          throw Error('Owned builder identity changed');
        }

        await this.run(['buildx', 'rm', this.builder], 130000, true);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Builder cleanup failed');
      }
    }

    fs.rmSync(this.auth, { recursive: true, force: true });
    fs.writeFileSync(
      path.join(this.root, 'cleanup.json'),
      JSON.stringify({
        version: 1,
        status: errors.length ? 'failed' : 'passed',
        operation: this.operation,
        errors,
      }) + '\n',
    );

    if (errors.length) {
      throw Error('Project delivery cleanup failed: ' + errors.join('; '));
    }
  }
}
@Injectable()
export class DeliverySessionService {
  constructor(@Inject(projectCiProcess) private readonly process: LifecycleProcess) {}

  async use<T>(
    root: string,
    env: NodeJS.ProcessEnv,
    identity: DeliveryIdentity,
    signal: AbortSignal | undefined,
    operation: (session: DeliverySession) => Promise<T>,
  ): Promise<T> {
    if (!path.isAbsolute(root) || !fs.statSync(root).isDirectory()) {
      throw Error('Absolute source directory required');
    }

    const session = new DeliverySession(this.process, root, env, identity, signal);
    let failure: unknown;
    try {
      return await operation(session);
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        await session.cleanup();
      } catch (error) {
        if (!failure) {
          throw error;
        }
      }
    }
  }
}
