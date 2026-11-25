import { settings as previewSettings } from '../project-lifecycle/previewSettings';
import type {
  ApplicationTemplate,
  BuildActivationInput,
  PreviewSetupInput,
  ProjectCreationInput,
  SourceInitializationInput,
} from './projectContracts';

export function inputRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function validProjectKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]+$/.test(value);
}

export function projectCreationInput(value: unknown): ProjectCreationInput {
  const input = inputRecord(value);

  if (
    !input ||
    !validProjectKey(input.projectKey) ||
    !['string', 'number'].includes(typeof input.namespaceId) ||
    !/^[1-9][0-9]*$/.test(String(input.namespaceId))
  ) {
    throw Error('Project Key must contain only lowercase a-z and digits 0-9; select a namespace.');
  }

  if (typeof input.data !== 'string') {
    throw Error('Invalid configuration signature.');
  }

  const template = input.template || 'empty';

  if (
    template !== 'empty' &&
    template !== 'angular' &&
    template !== 'react' &&
    template !== 'web' &&
    template !== 'wizard'
  ) {
    throw Error('Select a supported application template.');
  }

  if (
    (template === 'empty' || template === 'wizard') &&
    (typeof input.ci !== 'string' ||
      input.ci.length > 200000 ||
      !input.ci.includes('CI_DEFAULT_BRANCH'))
  ) {
    throw Error('Missing generated CI configuration.');
  }

  const namespaceId = input.namespaceId;

  if (typeof namespaceId !== 'string' && typeof namespaceId !== 'number') {
    throw Error('Project Key must contain only lowercase a-z and digits 0-9; select a namespace.');
  }

  return {
    ...input,
    projectKey: input.projectKey,
    namespaceId,
    data: input.data,
    template: template satisfies ApplicationTemplate,
    ci: typeof input.ci === 'string' ? input.ci : undefined,
  };
}

export function sourceInitializationInput(value: unknown): SourceInitializationInput {
  const input = inputRecord(value);

  if (!input || typeof input.manifestHash !== 'string') {
    throw Error('Preview the current Wizard source before initialization.');
  }

  return { ...input, manifestHash: input.manifestHash };
}

export function buildActivationInput(value: unknown): BuildActivationInput {
  const input = inputRecord(value);

  if (!input || typeof input.recipeHash !== 'string') {
    throw Error('Preview the current build recipe before activation.');
  }

  return { ...input, recipeHash: input.recipeHash };
}

export function previewSetupInput(value: unknown, applying = false): PreviewSetupInput {
  const input = inputRecord(value);
  const requested = inputRecord(input?.settings);

  if (requested?.version !== 2) {
    throw Error(
      applying
        ? 'Explicitly migrate legacy desired settings to System Beta.'
        : 'Explicitly migrate legacy desired settings to System Beta. Review values are not Beta settings.',
    );
  }

  if (!input || Object.keys(input).some((key) => !['settings', 'previewHash'].includes(key))) {
    throw Error('Provide desired Beta settings and the exact preflight hash.');
  }

  if (
    input.previewHash !== undefined &&
    input.previewHash !== null &&
    typeof input.previewHash !== 'string'
  ) {
    throw Error('Refresh Beta preflight before confirmation.');
  }

  return {
    ...input,
    settings: previewSettings(input.settings),
    ...(input.previewHash === null || typeof input.previewHash === 'string'
      ? { previewHash: input.previewHash }
      : {}),
  };
}
