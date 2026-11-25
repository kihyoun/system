import crypto from 'node:crypto';
import { DeploymentSlot, EnvironmentKind } from './types';
export interface CiFile {
  path: string;
  sha256: string;
}
export interface PreviousEnvironment {
  version?: number;
  phase: string;
  operation: string;
  managementMode?: string;
  settings: unknown;
  settingsHash: string;
  deployments?: Partial<Record<EnvironmentKind, DeploymentSlot>>;
  historicalDeployments?: {
    operation: string;
    deployments: Partial<Record<EnvironmentKind, DeploymentSlot>>;
  }[];
}
interface SourcePrimaryOptions {
  operation: string;
  helperImage: string;
  activationCommit: string;
  ciFiles: unknown;
}
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function producerPaths(files: readonly CiFile[]): string[] {
  if (files.some((file) => file.path === '.gitlab/producer-v3.json')) {
    return [
      '.gitlab/primary.yml',
      '.gitlab/producer-v3.json',
      '.gitlab/cli/system-bootstrapper.tgz',
      '.gitlab/cli/system-bootstrapper.tgz.json',
      '.gitlab/cli/system-bootstrapper.tgz.sha256',
    ];
  }

  return files.some((file) => file.path === '.gitlab/producer-v2.json')
    ? [
        '.gitlab/primary.yml',
        '.gitlab/producer-v2.json',
        '.gitlab/runtime/project-ci.cjs',
        '.gitlab/runtime/LICENSES.txt',
      ]
    : ['.gitlab/primary.yml', '.gitlab/delivery/environment.sh'];
}
export function ciFiles(input: unknown): CiFile[] {
  if (
    !Array.isArray(input) ||
    !input.length ||
    input.length > 40 ||
    input.some(
      (row) =>
        !row ||
        Object.keys(row).sort().join(',') !== 'path,sha256' ||
        typeof row.path !== 'string' ||
        !/^(?:\.gitlab\/|\.system-bootstrapper\/build-v[123]\/)[A-Za-z0-9_./-]+$/.test(row.path) ||
        row.path.split('/').includes('..') ||
        !/^[a-f0-9]{64}$/.test(row.sha256 || ''),
    ) ||
    new Set(input.map((row) => row.path)).size !== input.length ||
    !producerPaths(input).every((name) => input.some((row) => row.path === name))
  ) {
    throw new Error('Source-primary CI requires an exact approved file manifest.');
  }

  return copy(input as CiFile[]);
}
export function reservation(input: unknown) {
  const value = input as {
    version: number;
    managementMode: string;
    operation: string;
    helperImage: string;
    controller: string;
    activationCommit: string;
    settings: unknown;
    settingsHash: string;
    ciFiles: unknown;
  };

  if (
    !value ||
    value.version !== 1 ||
    value.managementMode !== 'source-primary' ||
    !/^[a-f0-9]{48}$/.test(value.operation || '') ||
    !/^sha256:[a-f0-9]{64}$/.test(value.helperImage || '') ||
    value.controller !== 'system_bootstrapper_1' ||
    !/^[a-f0-9]{40}$/.test(value.activationCommit || '') ||
    !value.settings ||
    value.settingsHash !== hash(JSON.stringify(value.settings))
  ) {
    throw new Error('Invalid source-primary environment reservation.');
  }

  const files = ciFiles(value.ciFiles);
  const manifest = {
    version: 1,
    managementMode: 'source-primary',
    operation: value.operation,
    settingsHash: value.settingsHash,
    helperImage: value.helperImage,
    controller: value.controller,
    ciFiles: files,
  };
  return { ...manifest, recipeHash: hash(JSON.stringify(manifest)) };
}
export function sourcePrimaryEnvironment(
  previous: PreviousEnvironment,
  options: SourcePrimaryOptions,
) {
  if (!previous || previous.phase !== 'ready' || previous.operation === options?.operation) {
    throw new Error('Adoption requires a ready previous reservation and a new operation.');
  }

  const deployments = {} as Record<EnvironmentKind, DeploymentSlot>;
  for (const kind of ['review', 'beta'] as const) {
    const slot = previous.deployments?.[kind] || {};

    if (slot.active || slot.pending || slot.retired?.length) {
      throw new Error('Stop and reconcile all environments before source-primary adoption.');
    }

    for (const key of ['lastPipelineId', 'stoppedThroughPipelineId'] as const) {
      if (slot[key] !== undefined && (!Number.isSafeInteger(slot[key]) || slot[key] < 0)) {
        throw new Error('Invalid retained environment generation floor.');
      }
    }
    deployments[kind] = previous.managementMode === 'source-primary' ? copy(slot) : {};
    for (const key of ['lastPipelineId', 'stoppedThroughPipelineId'] as const) {
      if (slot[key] !== undefined) {
        deployments[kind][key] = slot[key];
      }
    }
  }
  const result = {
    version: 1,
    managementMode: 'source-primary',
    phase: 'ready',
    operation: options.operation,
    settings: copy(previous.settings),
    settingsHash: previous.settingsHash,
    helperImage: options.helperImage,
    controller: 'system_bootstrapper_1',
    activationCommit: options.activationCommit,
    ciFiles: ciFiles(options.ciFiles),
    deployments,
    historicalDeployments: [
      ...(previous.historicalDeployments || []),
      { operation: previous.operation, deployments: copy(previous.deployments || {}) },
    ],
  };
  return { ...result, recipeHash: reservation(result).recipeHash };
}
