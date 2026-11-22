import { createHash } from 'node:crypto';
import type { Environment } from './types';

export class NpmPublicationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'NpmPublicationError';
  }
}
export function requireNpm(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new NpmPublicationError(code);
  }
}
export function record(value: unknown): Record<string, unknown> {
  requireNpm(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'invalid-npm-record',
  );
  return value as Record<string, unknown>;
}
export const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const integrity = (bytes: Buffer): string =>
  'sha512-' + createHash('sha512').update(bytes).digest('base64');
export const validVersion = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
export const validId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
export function environmentId(value: string | undefined): number {
  requireNpm(
    typeof value === 'string' && /^[1-9]\d*$/.test(value) && validId(Number(value)),
    'invalid-npm-ci-id',
  );
  return Number(value);
}
export interface NpmReceipt {
  format: 'system-cli-source-v1';
  name: '@systembootstrapper/cli';
  version: string;
  sourceRevision: string;
  sourceTree: string;
  pipelineId: number;
  packageJobId: number;
  filename: string;
  sha256: string;
  integrity: string;
}
export function readNpmReceipt(input: unknown): NpmReceipt {
  const value = record(input);
  requireNpm(
    value.format === 'system-cli-source-v1' &&
      value.name === '@systembootstrapper/cli' &&
      validVersion(value.version),
    'invalid-npm-identity',
  );
  requireNpm(
    value.filename === `systembootstrapper-cli-${value.version}.tgz`,
    'invalid-npm-filename',
  );
  requireNpm(
    typeof value.sourceRevision === 'string' &&
      /^[a-f0-9]{40}$/.test(value.sourceRevision) &&
      typeof value.sourceTree === 'string' &&
      /^[a-f0-9]{40}$/.test(value.sourceTree),
    'invalid-npm-source',
  );
  requireNpm(validId(value.pipelineId) && validId(value.packageJobId), 'invalid-npm-ci-id');
  requireNpm(
    typeof value.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(value.sha256) &&
      typeof value.integrity === 'string' &&
      /^sha512-[A-Za-z0-9+/]{86}==$/.test(value.integrity),
    'invalid-npm-digest',
  );
  return value as unknown as NpmReceipt;
}
export function validateNpmPublication(
  input: unknown,
  release: unknown,
  env: Environment,
  bytes: Buffer,
): NpmReceipt {
  requireNpm(
    env.GITLAB_CI === 'true' &&
      env.NPM_PUBLISH_ENABLED === 'true' &&
      env.CI_COMMIT_REF_PROTECTED === 'true' &&
      env.CI_PIPELINE_SOURCE === 'push' &&
      !env.CI_COMMIT_TAG &&
      !!env.CI_DEFAULT_BRANCH &&
      env.CI_COMMIT_BRANCH === env.CI_DEFAULT_BRANCH,
    'protected-accepted-release-required',
  );
  const receipt = readNpmReceipt(input);
  const metadata = record(release);
  const source = record(metadata.source);
  requireNpm(
    metadata.format === 'system-accepted-release-v1' &&
      metadata.version === receipt.version &&
      source.revision === receipt.sourceRevision &&
      source.tree === receipt.sourceTree &&
      receipt.sourceRevision === env.CI_COMMIT_SHA &&
      receipt.pipelineId === environmentId(env.CI_PIPELINE_ID),
    'accepted-npm-source-mismatch',
  );
  requireNpm(
    receipt.sha256 === hash(bytes) && receipt.integrity === integrity(bytes),
    'accepted-npm-bytes-mismatch',
  );
  return receipt;
}
