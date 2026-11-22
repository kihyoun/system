import type {
  BuildArtifact,
  DeploymentFootprint,
  EnvironmentSettings,
  EnvironmentSetting,
  EnvironmentSummary,
  NativeProjectResult,
  PipelineIdentity,
  ProjectReceipt,
  ProjectRepository,
  WizardBuildState,
  WizardWorkflow,
} from './projectContracts';
import { inputRecord } from './projectInputs';
import { settings as previewSettings } from '../project-lifecycle/previewSettings';

type FieldKind = 'string' | 'number' | 'boolean' | 'namespace' | 'nullable-string';

function object(value: unknown, message: string): Record<string, unknown> {
  const row = inputRecord(value);

  if (!row) {
    throw Error(message);
  }

  return row;
}

function fields(row: Record<string, unknown>, spec: Record<string, FieldKind>, message: string) {
  for (const [key, kind] of Object.entries(spec)) {
    const value = row[key];

    if (value === undefined) {
      continue;
    }

    const valid =
      kind === 'namespace'
        ? (typeof value === 'string' || typeof value === 'number') &&
          /^[1-9][0-9]*$/.test(String(value))
        : kind === 'nullable-string'
          ? value === null || typeof value === 'string'
          : kind === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === kind;

    if (!valid) {
      throw Error(message);
    }
  }
}

function pipeline(value: unknown, message: string): PipelineIdentity {
  const row = object(value, message);
  fields(row, { id: 'number', sha: 'string', status: 'string', webUrl: 'string' }, message);
  return row;
}

function artifact(value: unknown, message: string): BuildArtifact {
  const row = object(value, message);
  fields(row, { sourceCommit: 'string', pipelineId: 'number', imageRef: 'string' }, message);
  return row;
}

export function readBuildState(
  value: unknown,
  message = 'Invalid stored build state.',
): WizardBuildState {
  const row = object(value, message);
  fields(
    row,
    {
      version: 'number',
      operation: 'string',
      mode: 'string',
      recipeHash: 'string',
      cliArtifactSha256: 'string',
      phase: 'string',
      activationCommit: 'string',
      message: 'string',
    },
    message,
  );

  if (row.pipeline !== undefined && row.pipeline !== null) {
    pipeline(row.pipeline, message);
  }

  if (row.publishing !== undefined && row.publishing !== null) {
    pipeline(row.publishing, message);
  }

  if (row.artifact !== undefined && row.artifact !== null) {
    artifact(row.artifact, message);
  }

  // Every declared field above has been checked; unknown extension fields stay intact.
  return row as WizardBuildState;
}

function environmentSettings(value: unknown, message: string): EnvironmentSettings {
  const row = object(value, message);
  const readSetting = (value: unknown): EnvironmentSetting => {
    const setting = object(value, message);

    if (
      typeof setting.enabled !== 'boolean' ||
      setting.domainMode !== 2 ||
      typeof setting.host !== 'string' ||
      typeof setting.ssl !== 'string' ||
      typeof setting.sslKey !== 'string'
    ) {
      throw Error(message);
    }

    return {
      ...setting,
      enabled: setting.enabled,
      domainMode: setting.domainMode,
      host: setting.host,
      ssl: setting.ssl,
      sslKey: setting.sslKey,
    };
  };
  return { ...row, review: readSetting(row.review), beta: readSetting(row.beta) };
}

function deployments(value: unknown, message: string) {
  const row = object(value, message);
  for (const kind of ['review', 'beta']) {
    if (row[kind] === undefined) {
      continue;
    }

    const slot = object(row[kind], message);
    fields(slot, { lastPipelineId: 'number', stoppedThroughPipelineId: 'number' }, message);

    if (slot.retired !== undefined && !Array.isArray(slot.retired)) {
      throw Error(message);
    }
    // Individual deployment evidence is parsed by the lifecycle that consumes it.
  }
  return row as Partial<Record<'review' | 'beta', DeploymentFootprint>>;
}

export function readEnvironmentSummary(
  value: unknown,
  message = 'Invalid stored environment state.',
): EnvironmentSummary {
  const row = object(value, message);
  fields(
    row,
    {
      version: 'number',
      phase: 'string',
      operation: 'string',
      managementMode: 'string',
      settingsHash: 'string',
      helperImage: 'string',
      controller: 'string',
      recipeHash: 'string',
      buildRecipeHash: 'string',
      cliArtifactSha256: 'string',
      activationCommit: 'string',
      externalAttempted: 'boolean',
    },
    message,
  );

  if (row.settings !== undefined) {
    environmentSettings(row.settings, message);
  }

  if (row.deployments !== undefined) {
    deployments(row.deployments, message);
  }

  if (row.previous !== undefined && row.previous !== null) {
    readEnvironmentSummary(row.previous, message);
  }

  if (row.historicalDeployments !== undefined && !Array.isArray(row.historicalDeployments)) {
    throw Error(message);
  }

  if (row.desiredSettings !== undefined) {
    previewSettings(row.desiredSettings);
  }

  return row as EnvironmentSummary;
}

function workflow(value: unknown, message: string): WizardWorkflow {
  const row = object(value, message);
  fields(
    row,
    {
      version: 'number',
      operation: 'string',
      sourceRevision: 'string',
      sourceLayout: 'string',
      wizardSourceTree: 'string',
      manifestHash: 'string',
      importCommit: 'string',
      phase: 'string',
      message: 'string',
    },
    message,
  );

  if (row.build !== undefined && row.build !== null) {
    readBuildState(row.build, message);
  }

  if (row.environments !== undefined && row.environments !== null) {
    readEnvironmentSummary(row.environments, message);
  }

  return row as WizardWorkflow;
}

export function readRepository(
  value: unknown,
  message = 'Invalid stored repository identity.',
): ProjectRepository {
  const row = object(value, message);
  fields(
    row,
    {
      id: 'number',
      namespaceId: 'namespace',
      path: 'string',
      defaultBranch: 'string',
      ciPath: 'string',
      generatedCi: 'nullable-string',
      systemProject: 'boolean',
      managementMode: 'string',
      deploymentState: 'string',
      webUrl: 'string',
      pipelineUrl: 'string',
    },
    message,
  );

  if (row.initialPipeline !== undefined && row.initialPipeline !== null) {
    pipeline(row.initialPipeline, message);
  }

  return row as ProjectRepository;
}

export function readProjectReceipt(value: unknown): ProjectReceipt {
  const message = 'Invalid stored project state.';
  const row = object(value, message);
  fields(
    row,
    {
      operation: 'string',
      fingerprint: 'string',
      namespaceId: 'namespace',
      template: 'string',
      defaultProject: 'boolean',
      state: 'string',
    },
    message,
  );

  if (row.repository !== undefined && row.repository !== null) {
    readRepository(row.repository, message);
  }

  if (row.wizardWorkflow !== undefined && row.wizardWorkflow !== null) {
    workflow(row.wizardWorkflow, message);
  }

  return row as ProjectReceipt;
}

export function readNativeProjectResult(value: unknown): NativeProjectResult {
  const message = 'Invalid GitLab operation response.';
  const row = object(value, message);

  if (!Object.keys(row).length) {
    throw Error(message);
  }

  fields(
    row,
    {
      state: 'string',
      message: 'string',
      conflict: 'boolean',
      availability: 'string',
      path: 'string',
      namespaceId: 'number',
      sourceRevision: 'string',
      importCommit: 'string',
    },
    message,
  );

  if (row.repository !== undefined && row.repository !== null) {
    readRepository(row.repository, message);
  }

  if (row.pipeline !== undefined && row.pipeline !== null) {
    pipeline(row.pipeline, message);
  }

  if (row.build !== undefined && row.build !== null) {
    readBuildState(row.build, message);
  }

  if (row.credentials !== undefined && !Array.isArray(row.credentials)) {
    throw Error(message);
  }

  if (row.namespaces !== undefined) {
    if (!Array.isArray(row.namespaces)) {
      throw Error(message);
    }

    for (const item of row.namespaces) {
      const namespace = object(item, message);

      if (typeof namespace.id !== 'number' || typeof namespace.path !== 'string') {
        throw Error(message);
      }
    }
  }

  if (row.projects !== undefined) {
    if (!Array.isArray(row.projects)) {
      throw Error(message);
    }

    for (const item of row.projects) {
      const project = object(item, message);

      if (
        typeof project.id !== 'number' ||
        typeof project.namespaceId !== 'number' ||
        !['path', 'defaultBranch', 'sourceRevision'].every(
          (key) => typeof project[key] === 'string',
        )
      ) {
        throw Error(message);
      }
    }
  }

  // Environments and credentials remain unknown until their owning capability validates them.
  return row as NativeProjectResult;
}
