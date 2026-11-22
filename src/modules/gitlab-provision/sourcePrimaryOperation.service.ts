import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GitlabCredentialService } from './credential.service';
import { GitlabProjectCredentialService } from './projectCredential.service';
import { GitlabNativeApiService } from './nativeApi.service';
import { GitlabActivationSessionService } from './activationSession.service';
import { SourcePrimaryActivationService } from './sourcePrimaryActivation.service';
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('Invalid source-primary activation input');
  }

  return value as Record<string, unknown>;
}
@Injectable()
export class SourcePrimaryOperationService {
  constructor(
    private readonly credentials: GitlabCredentialService,
    private readonly projects: GitlabProjectCredentialService,
    private readonly api: GitlabNativeApiService,
    private readonly sessions: GitlabActivationSessionService,
    private readonly activation: SourcePrimaryActivationService,
  ) {}

  async execute(checkout: string, value: unknown, signal?: AbortSignal) {
    const input = row(value),
      repository = row(input.repository),
      environment = row(input.environments);

    if (
      !['wizard-environments-primary', 'wizard-environments-primary-status'].includes(
        String(input.action),
      ) ||
      !Number.isSafeInteger(repository.id) ||
      Number(repository.id) < 1 ||
      typeof repository.path !== 'string' ||
      !/^[a-z0-9]+$/.test(String(input.projectKey)) ||
      repository.path.split('/').at(-1) !== input.projectKey ||
      Number(input.namespaceId) !== repository.namespaceId ||
      typeof environment.operation !== 'string' ||
      !/^[a-f0-9]{48}$/.test(environment.operation)
    ) {
      throw Error('Invalid source-primary project binding');
    }

    const authorization = await this.credentials.ensure({ checkout, signal });
    const existing = await this.api.request(
      authorization.context,
      authorization.credential.token,
      'GET',
      `projects/${repository.id}`,
    );

    if (existing.status !== 200) {
      throw Error('Source-primary project lookup failed');
    }

    this.activation.validate(input, existing.value);
    const projectCredential = await this.projects.current(
      authorization.context,
      authorization.configDirectory,
      Number(repository.id),
      repository.path,
      authorization.credential.token,
    );
    const project = await this.api.request(
      authorization.context,
      projectCredential.token,
      'GET',
      `projects/${repository.id}`,
    );

    if (project.status !== 200) {
      throw Error('Source-primary project lookup failed');
    }

    const operation = createHash('sha256')
      .update(JSON.stringify({ projectId: repository.id, operation: environment.operation }))
      .digest('hex');
    const session = this.sessions.create(
      authorization.context,
      authorization.configDirectory,
      Number(repository.id),
      operation,
      projectCredential.token,
    );
    return this.activation.activate(input, project.value, session);
  }
}
