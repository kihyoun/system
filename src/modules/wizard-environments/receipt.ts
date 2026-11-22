import { validRequest } from '../project-lifecycle/state';
import type { DeploymentRecord, DeploymentSlot } from '../project-lifecycle/types';
import type { CiFile } from '../project-lifecycle/sourcePrimaryEnvironment';
import { object, normalizeSettings } from './settings';
import {
  ArtifactObservation,
  BuildObservation,
  EnvironmentDeployments,
  EnvironmentReceipt,
  EnvironmentReservation,
  PipelineObservation,
} from './types';

const ownershipError = () =>
  new Error('Initialize the managed Wizard source before configuring Review and Beta.');
const reservationError = () =>
  new Error(
    'The environment reservation changed. Inspect the server-owned receipt before continuing.',
  );
function row(value: unknown): Record<string, unknown> {
  if (!object(value)) {
    throw ownershipError();
  }

  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') {
    throw ownershipError();
  }

  return value;
}
function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value);
}
function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw ownershipError();
  }

  return value;
}
function files(value: unknown): CiFile[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw reservationError();
  }

  return value.map((item) => {
    const file = row(item);
    return { ...file, path: text(file.path), sha256: text(file.sha256) };
  });
}
function pipeline(value: unknown): PipelineObservation | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  const input = row(value);
  return {
    ...input,
    id: optionalNumber(input.id),
    sha: optionalText(input.sha),
    status: optionalText(input.status),
  };
}
function artifact(value: unknown): ArtifactObservation | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  const input = row(value);
  return {
    ...input,
    imageRef: optionalText(input.imageRef),
    sourceCommit: optionalText(input.sourceCommit),
    pipelineId: optionalNumber(input.pipelineId),
  };
}
function build(value: unknown): BuildObservation | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const input = row(value),
    publishing = input.publishing == null ? input.publishing : row(input.publishing);
  return {
    ...input,
    version: optionalNumber(input.version),
    operation: optionalText(input.operation),
    recipeHash: text(input.recipeHash),
    phase: optionalText(input.phase),
    mode: optionalText(input.mode),
    activationCommit: optionalText(input.activationCommit),
    pipeline: pipeline(input.pipeline),
    publishing: publishing && { ...publishing, status: optionalText(publishing.status) },
    artifact: artifact(input.artifact),
  };
}
function deployment(value: unknown): DeploymentRecord {
  const input = row(value),
    request = validRequest(value);

  if (!['pending', 'active', 'stopped'].includes(text(input.state))) {
    throw reservationError();
  }

  const state = input.state;

  if (state !== 'pending' && state !== 'active' && state !== 'stopped') {
    throw reservationError();
  }

  for (const key of ['cleanupComplete', 'routeRemoved']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      throw reservationError();
    }
  }
  return {
    ...input,
    ...request,
    state,
    host: text(input.host),
    imageRef: text(input.imageRef),
    generation: text(input.generation),
    containerName: text(input.containerName),
    networkName: text(input.networkName),
    environment: text(input.environment),
    ...(input.routeHash === undefined ? {} : { routeHash: text(input.routeHash) }),
    ...(typeof input.cleanupComplete === 'boolean'
      ? { cleanupComplete: input.cleanupComplete }
      : {}),
    ...(typeof input.routeRemoved === 'boolean' ? { routeRemoved: input.routeRemoved } : {}),
  };
}
function deployments(value: unknown): EnvironmentDeployments | undefined {
  if (value === undefined) {
    return undefined;
  }

  const input = row(value),
    result: EnvironmentDeployments = { ...input };
  for (const name of ['review', 'beta'] as const) {
    if (input[name] === undefined) {
      continue;
    }

    const entry = row(input[name]),
      slot: DeploymentSlot = {};
    for (const key of ['active', 'pending', 'tombstone'] as const) {
      if (entry[key] !== undefined) {
        slot[key] = entry[key] === null ? null : deployment(entry[key]);
      }
    }

    if (entry.retired !== undefined) {
      if (!Array.isArray(entry.retired)) {
        throw reservationError();
      }

      slot.retired = entry.retired.map(deployment);
    }

    for (const key of ['lastPipelineId', 'stoppedThroughPipelineId'] as const) {
      if (entry[key] !== undefined) {
        const number = entry[key];

        if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) {
          throw reservationError();
        }

        slot[key] = number;
      }
    }
    // Unknown metadata is retained; the runtime owns its stricter deployment policy.
    result[name] = { ...entry, ...slot };
  }
  return result;
}
export function readEnvironmentReservation(value: unknown, depth = 0): EnvironmentReservation {
  if (depth > 16) {
    throw reservationError();
  }

  const input = row(value),
    selected = normalizeSettings(input.settings);

  if (typeof input.version !== 'number') {
    throw reservationError();
  }

  let history: EnvironmentReservation['historicalDeployments'];

  if (input.historicalDeployments !== undefined) {
    if (!Array.isArray(input.historicalDeployments)) {
      throw reservationError();
    }

    history = input.historicalDeployments.map((item) => {
      const entry = row(item);
      return {
        ...entry,
        operation: text(entry.operation),
        deployments: deployments(entry.deployments) || {},
      };
    });
  }

  if (input.externalAttempted !== undefined && typeof input.externalAttempted !== 'boolean') {
    throw reservationError();
  }

  return {
    ...input,
    version: input.version,
    operation: text(input.operation),
    phase: text(input.phase),
    settings: selected,
    settingsHash: text(input.settingsHash),
    helperImage: text(input.helperImage),
    controller: text(input.controller),
    recipeHash: optionalText(input.recipeHash),
    buildRecipeHash: optionalText(input.buildRecipeHash),
    activationCommit: optionalText(input.activationCommit),
    managementMode: optionalText(input.managementMode),
    ciFiles: files(input.ciFiles),
    deployments: deployments(input.deployments),
    previous:
      input.previous === undefined
        ? undefined
        : readEnvironmentReservation(input.previous, depth + 1),
    historicalDeployments: history,
    message: optionalText(input.message),
    ...(typeof input.externalAttempted === 'boolean'
      ? { externalAttempted: input.externalAttempted }
      : {}),
  };
}
export function readEnvironmentReceipt(value: unknown): EnvironmentReceipt {
  const input = row(value),
    repository = row(input.repository),
    workflow = row(input.wizardWorkflow);

  if (
    typeof input.defaultProject !== 'boolean' ||
    typeof repository.systemProject !== 'boolean' ||
    typeof repository.id !== 'number' ||
    !Number.isSafeInteger(repository.id) ||
    repository.id < 1 ||
    (typeof input.namespaceId !== 'string' && typeof input.namespaceId !== 'number')
  ) {
    throw ownershipError();
  }

  const primary = input.sourcePrimary === undefined ? undefined : row(input.sourcePrimary);
  return {
    ...input,
    defaultProject: input.defaultProject,
    template: text(input.template),
    state: text(input.state),
    operation: text(input.operation),
    namespaceId: input.namespaceId,
    repository: {
      ...repository,
      id: repository.id,
      path: text(repository.path),
      systemProject: repository.systemProject,
      ciPath: text(repository.ciPath),
      managementMode: optionalText(repository.managementMode),
      generatedCi: repository.generatedCi === null ? null : optionalText(repository.generatedCi),
    },
    wizardWorkflow: {
      ...workflow,
      version: optionalNumber(workflow.version),
      operation: optionalText(workflow.operation),
      sourceRevision: text(workflow.sourceRevision),
      importCommit: optionalText(workflow.importCommit),
      phase: optionalText(workflow.phase),
      build: build(workflow.build),
      environments:
        workflow.environments == null
          ? undefined
          : readEnvironmentReservation(workflow.environments),
    },
    sourcePrimary: primary && {
      ...primary,
      version: optionalNumber(primary.version),
      ciFiles: files(primary.ciFiles),
    },
  };
}
