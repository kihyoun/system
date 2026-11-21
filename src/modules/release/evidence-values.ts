/** Untrusted evidence is decoded only through fixed, source-owned allowlists. */
export type EvidenceObject = Record<string, unknown>;
export type Predicate = (value: unknown) => boolean;
export const object = (value: unknown): EvidenceObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as EvidenceObject)
    : {};
export const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
export const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const image = (value: unknown): value is string =>
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export const boolean: Predicate = (value) => typeof value === 'boolean';
export const operation: Predicate = (value) =>
  typeof value === 'string' && /^[a-f0-9]{48}$/.test(value);
export const generation: Predicate = (value) =>
  typeof value === 'string' && /^p[1-9][0-9]*-j[1-9][0-9]*$/.test(value);
export const oneOf =
  (...values: unknown[]): Predicate =>
  (value) =>
    values.includes(value);
export function fields(
  source: EvidenceObject,
  target: EvidenceObject,
  names: readonly string[],
  accepts: Predicate,
): void {
  for (const name of names) if (accepts(source[name])) target[name] = source[name];
}
export function identity(value: unknown): EvidenceObject {
  const source = object(value),
    result: EvidenceObject = {};
  fields(source, result, ['projectId', 'pipelineId', 'jobId'], positive);
  fields(
    source,
    result,
    ['mrIid'],
    (item) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0,
  );
  fields(source, result, ['sourceCommit'], sha);
  fields(source, result, ['operation'], operation);
  fields(source, result, ['generation'], generation);
  fields(source, result, ['state'], oneOf('active', 'stopped'));
  fields(source, result, ['imageDigest'], image);
  return result;
}
export const pipelineStatuses = [
  'created',
  'pending',
  'running',
  'success',
  'failed',
  'canceled',
  'skipped',
  'manual',
  'scheduled',
  'waiting_for_resource',
  'preparing',
];
export function stagesPassed(results: unknown, stages: readonly string[]): boolean {
  return (
    Array.isArray(results) &&
    stages.every((name) =>
      results.some((row) => object(row).name === name && object(row).status === 'passed'),
    )
  );
}
