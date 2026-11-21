import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { LifecycleProcess, ChildOptions } from '../../common/runtime/managed-child';
import { ProjectsRoutingService } from '../projects-routing/projects-routing.service';
import { localRegistry, projectForImage } from './identity';
import {
  WIZARD_RECOVERY_PROCESS,
  WIZARD_RECOVERY_REGISTRY,
  WIZARD_RECOVERY_READY,
  WIZARD_RECOVERY_DURABILITY,
  type RecoveryOptions,
  type RecoveryRegistryPort,
  type RecoveryReadinessPort,
  type RecoveryDurabilityPort,
  type RegistrySession,
} from './ports';
@Injectable()
export class WizardRecoveryService {
  constructor(
    @Inject(WIZARD_RECOVERY_PROCESS) private readonly children: LifecycleProcess,
    private readonly routing: ProjectsRoutingService,
    @Inject(WIZARD_RECOVERY_REGISTRY) private readonly registry: RecoveryRegistryPort,
    @Inject(WIZARD_RECOVERY_READY) private readonly readiness: RecoveryReadinessPort,
    @Inject(WIZARD_RECOVERY_DURABILITY) private readonly durability: RecoveryDurabilityPort,
  ) {}

  async recover(options: RecoveryOptions): Promise<{ state: string }> {
    const { settings, signal } = options;
    if (!path.isAbsolute(options.checkout)) throw Error('Absolute recovery checkout required.');
    const env = { ...settings };
    for (const name of [
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'DOCKER_TLS',
      'DOCKER_TLS_VERIFY',
      'DOCKER_CERT_PATH',
    ])
      delete env[name];
    const child: ChildOptions = {
      cwd: options.checkout,
      env,
      signal,
      timeout: 180000,
      maxBuffer: 1024 * 1024,
    };
    const docker = async (args: string[], overrides: Partial<ChildOptions> = {}) =>
      (
        await this.children.run('docker', ['--host=unix:///var/run/docker.sock', ...args], {
          ...child,
          ...overrides,
        })
      ).trim();
    const image = settings.WIZARD_IMAGE || 'systembootstrapper/wizard';
    if (settings.WIZARD_ENABLE !== 'true') return { state: 'disabled' };
    signal?.throwIfAborted();
    let available = false;
    try {
      await docker(['image', 'inspect', image]);
      available = true;
    } catch {
      signal?.throwIfAborted();
    }
    const registry = localRegistry(
      settings.GITLAB_REGISTRY_URL || '',
      settings.GITLAB_REGISTRY_DOMAIN_MODE,
    );
    if (!image.startsWith(registry.host + '/'))
      return { state: available ? 'available' : 'external-image' };
    const state = settings.SYSTEM_CONFIG_DIR || '/state';
    const project = projectForImage(
      fs.readFileSync(path.join(state, '.projects.env/.wizard.env'), 'utf8'),
      image,
      settings.GITLAB_REGISTRY_URL || '',
      settings.GITLAB_REGISTRY_DOMAIN_MODE,
    );
    const lock = path.join(state, '.wizard-image-recovery.lock'),
      pending = path.join(state, '.wizard-image-recovery.pending');
    if (fs.existsSync(lock))
      throw Error('Interrupted Wizard image recovery lease requires operator inspection.');
    if (available && !fs.existsSync(pending)) return { state: 'available' };
    fs.mkdirSync(lock, { mode: 0o700 });
    let session: RegistrySession | undefined,
      credential: Record<string, unknown> | undefined,
      privateConfig: string | undefined,
      primaryFailure: unknown,
      cleanupFailure: Error | undefined,
      mintAttempted = false;
    try {
      this.routing.run({
        environment: env,
        action: 'recovery',
        root: options.checkout,
        templates: options.templates || '/templates',
      });
      await this.readiness.wait(child);
      fs.writeFileSync(
        pending,
        JSON.stringify({ projectId: project.projectId, image: project.image }),
        { mode: 0o600, flush: true },
      );
      // Persist the pending obligation and lease before either credential provider runs.
      this.durability.syncDirectory(state);
      signal?.throwIfAborted();
      session = await this.registry.open(options);
      signal?.throwIfAborted();
      mintAttempted = true;
      if (!available) {
        credential = await session.execute({ ...project, action: 'create' });
        if (
          !Number.isSafeInteger(credential.id) ||
          Number(credential.id) < 1 ||
          credential.username !== `gitlab+deploy-token-${credential.id}` ||
          typeof credential.token !== 'string' ||
          !credential.token ||
          /[\r\n\0]/.test(credential.token)
        )
          throw Error('Invalid registry recovery credential.');
        privateConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-registry-'));
        fs.chmodSync(privateConfig, 0o700);
        const privateEnv = { ...env, DOCKER_CONFIG: privateConfig };
        await docker(
          [
            '--config',
            privateConfig,
            'login',
            project.registry,
            '--username',
            String(credential.username),
            '--password-stdin',
          ],
          { env: privateEnv, input: credential.token + '\n' },
        );
        await docker(['--config', privateConfig, 'pull', project.image], { env: privateEnv });
        const digests: unknown = JSON.parse(
          await docker(['image', 'inspect', '--format', '{{json .RepoDigests}}', project.image]),
        );
        if (!Array.isArray(digests) || !digests.includes(project.image))
          throw Error('Recovered Wizard image digest does not match its configured pin.');
      }
    } catch (error) {
      primaryFailure = error;
    } finally {
      if (mintAttempted && session)
        try {
          const id = credential?.id;
          // Cancellation still requires bounded revocation of this invocation's token.
          const result = await session.execute(
            {
              ...project,
              action: Number.isSafeInteger(id) && Number(id) > 0 ? 'revoke' : 'cleanup',
              ...(Number.isSafeInteger(id) && Number(id) > 0 ? { tokenId: Number(id) } : {}),
            },
            AbortSignal.timeout(180000),
          );
          if (result.revoked !== true) throw Error();
        } catch {
          cleanupFailure = Error('Registry recovery credential revocation failed.');
        }
      if (privateConfig)
        try {
          fs.rmSync(privateConfig, { recursive: true, force: true });
        } catch {
          cleanupFailure = Error('Cannot remove private registry login state.');
        }
      if (mintAttempted && !cleanupFailure && fs.existsSync(pending)) fs.unlinkSync(pending);
      fs.rmdirSync(lock);
      try {
        this.durability.syncDirectory(state);
      } catch {
        cleanupFailure = Error('Cannot persist registry recovery cleanup state.');
      }
      if (cleanupFailure) throw cleanupFailure;
    }
    if (primaryFailure) throw primaryFailure;
    return { state: 'recovered' };
  }
}
