import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { HostPersistenceService } from '../host-lifecycle/persistence.service';
import { HostLifecycleService, readEnvironment } from '../host-lifecycle/lifecycle.service';
import { HostInstallService } from '../host/install';
import { RecoveryManifestService, type RecoveryManifest } from '../host/recovery-manifest';
import { RecoveryImageService } from '../host/recovery-images';
import { ManagedChildProcess, type LifecycleProcess } from '../runtime/managed-child';
import { HostCertificateService } from './certificate.service';
export interface RetainedRecoveryPort {
  verify(
    directory: string,
    checkout: string,
    configuration: string,
    expectedSha?: string,
  ): RecoveryManifest;
  load(directory: string, manifest: RecoveryManifest): void;
}
const nativeRecovery: RetainedRecoveryPort = {
  verify(directory, checkout, configuration, expectedSha) {
    const service = new RecoveryManifestService(new HostInstallService());
    const manifest = service.load(directory, checkout, expectedSha);
    service.validateSelected(manifest, configuration);
    return manifest;
  },
  load(directory, manifest) {
    new RecoveryImageService().restore(directory, manifest);
  },
};
@Injectable()
export class RetainedRecoveryService {
  constructor(
    readonly process: LifecycleProcess = new ManagedChildProcess(),
    readonly port: RetainedRecoveryPort = nativeRecovery,
    readonly systemRoot = '/',
  ) {}
  async recover(
    checkout: string,
    input: NodeJS.ProcessEnv,
    verifyOnly: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    if (process.geteuid?.() !== 0) throw Error('Retained recovery requires root.');
    const selector = input.PERSISTENCE_ENV_FILE;
    if (!selector) throw Error('Select the retained private persistence environment.');
    let env = await readEnvironment(this.process, [selector], input, checkout, signal);
    const persistence = new HostPersistenceService(this.process);
    env = await persistence.prepare(env, process.geteuid?.(), signal);
    const data = env.PERSISTENT_DIR!,
      directory = path.join(data, 'recovery'),
      configuration = path.join(data, 'configuration/.docker.env');
    const manifest = this.port.verify(
      directory,
      checkout,
      configuration,
      env.RECOVERY_MANIFEST_SHA256,
    );
    if (verifyOnly) return;
    if (!fs.statSync(configuration).isFile())
      throw Error('Retained live configuration is required.');
    const selected = path.join(this.systemRoot, 'etc/system-bootstrapper/persistence.env');
    fs.mkdirSync(path.dirname(selected), { recursive: true, mode: 0o700 });
    if (fs.realpathSync(selector) !== selected) {
      fs.writeFileSync(selected, fs.readFileSync(selector), { mode: 0o600 });
      fs.chmodSync(selected, 0o600);
    }
    env = {
      ...env,
      PERSISTENCE_ENV_FILE: selected,
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      SYSTEM_BOOTSTRAPPER_SKIP_BUILD: '1',
    };
    delete env.DOCKER_CONTEXT;
    delete env.DOCKER_TLS_VERIFY;
    delete env.DOCKER_CERT_PATH;
    this.port.load(directory, manifest);
    await new HostCertificateService(this.process, this.systemRoot).install(checkout, env, signal);
    await new HostLifecycleService(persistence, this.process).execute(
      'start',
      checkout,
      env,
      signal,
    );
  }
}
