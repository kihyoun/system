import { ManagedBuildService } from './managedBuild.service';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GitlabCredentialService } from './credential.service';
import { GitlabProjectCredentialService } from './projectCredential.service';
import { GitlabNativeApiService } from './nativeApi.service';
import { GitlabActivationSessionService } from './activationSession.service';
import { ManagedEnvironmentService } from './managedEnvironment.service';
import { recipeRow as row, recipeText as text, ensureRecipe as ensure } from './managedRecipe';
@Injectable()
export class ManagedRecipeOperationService {
  constructor(
    private readonly credentials: GitlabCredentialService,
    private readonly projects: GitlabProjectCredentialService,
    private readonly api: GitlabNativeApiService,
    private readonly sessions: GitlabActivationSessionService,
    private readonly environments: ManagedEnvironmentService,
    private readonly builds: ManagedBuildService,
  ) {}

  async execute(checkout: string, value: unknown, signal?: AbortSignal) {
    const input = row(value),
      repository = row(input.repository),
      building = ['wizard-build', 'wizard-build-status'].includes(String(input.action)),
      reservation = row(building ? input.build : input.environments),
      service = building ? this.builds : this.environments;
    ensure(
      [
        'wizard-build',
        'wizard-build-status',
        'wizard-environments',
        'wizard-environments-status',
      ].includes(text(input.action)) &&
        Number.isSafeInteger(repository.id) &&
        Number(repository.id) > 0 &&
        Number.isSafeInteger(input.namespaceId) &&
        Number(input.namespaceId) > 0 &&
        /^[a-z0-9]+$/.test(text(input.projectKey)),
      'Invalid managed Wizard project binding',
    );
    const authority = await this.credentials.ensure({ checkout, signal });
    const result = await this.api.request(
        authority.context,
        authority.credential.token,
        'GET',
        `projects/${repository.id}`,
      ),
      project = row(result.value);
    ensure(
      result.status === 200 && row(project.namespace).id === input.namespaceId,
      'Bound Wizard project identity changed',
    );
    service.validate(input, project);
    const credential = await this.projects.current(
      authority.context,
      authority.configDirectory,
      Number(repository.id),
      text(repository.path),
      authority.credential.token,
    );
    const operation = createHash('sha256')
      .update(JSON.stringify({ projectId: repository.id, operation: reservation.operation }))
      .digest('hex');
    const session = this.sessions.create(
      authority.context,
      authority.configDirectory,
      Number(repository.id),
      operation,
      credential.token,
      building ? 'build' : 'environment',
    );
    return service.execute(input, project, session);
  }
}
