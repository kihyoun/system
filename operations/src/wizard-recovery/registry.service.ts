import { Injectable } from '@nestjs/common';
import { GitlabCredentialService } from '../gitlab-provision/credential.service';
import { RecoveryRegistryCredentialService } from '../gitlab-provision/recovery-registry-credential.service';
import type { RecoveryOptions, RecoveryRegistryPort, RegistrySession } from './ports';
@Injectable()
export class WizardRecoveryRegistryService implements RecoveryRegistryPort {
  constructor(
    private readonly credentials: GitlabCredentialService,
    private readonly registry: RecoveryRegistryCredentialService,
  ) {}
  async open(options: RecoveryOptions): Promise<RegistrySession> {
    const current = await this.credentials.ensure({
      checkout: options.checkout,
      configDirectory: options.configDirectory,
      signal: options.signal,
    });
    // Credentials and the exact GitLab identity belong to this invocation only.
    return {
      execute: (input, signal = options.signal) =>
        this.registry.execute({ ...current.context, signal }, current.credential.token, input),
    };
  }
}
