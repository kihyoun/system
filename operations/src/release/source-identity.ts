import type { Execute, SourceIdentity } from './types';
export const revision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const imageId = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('A release object is required.');
  return value as Record<string, unknown>;
}
/** The discriminator is authoritative: historical commits are never reinterpreted. */
export function readSourceIdentity(value: unknown): SourceIdentity {
  const row = record(value);
  if (!revision(row.sourceRevision) || !revision(row.sourceTree)) throw Error('Invalid release source identity.');
  if (row.sourceLayout === undefined) {
    if (!revision(row.wizardRevision) || row.wizardSourceTree !== undefined) throw Error('Historical Wizard commit is required.');
    return { sourceRevision: row.sourceRevision, sourceTree: row.sourceTree, wizardRevision: row.wizardRevision };
  }
  if (row.sourceLayout !== 'system-monorepo-v1' || !revision(row.wizardSourceTree) || row.wizardRevision !== undefined)
    throw Error('Explicit monorepo Wizard tree identity is required.');
  return { sourceLayout: row.sourceLayout, sourceRevision: row.sourceRevision, sourceTree: row.sourceTree, wizardSourceTree: row.wizardSourceTree };
}
export function checkoutIdentity(root: string, expectedRevision: string, execute: Execute): SourceIdentity {
  const git = (...args: string[]) => execute('git', args, { cwd: root });
  const sourceRevision = git('rev-parse', 'HEAD');
  const sourceTree = git('rev-parse', 'HEAD^{tree}');
  const entry = git('ls-tree', 'HEAD', 'wizard');
  if (sourceRevision !== expectedRevision || !revision(sourceRevision) || !revision(sourceTree)) throw Error('Publication checkout/source mismatch.');
  const legacy = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(entry);
  if (legacy) return { sourceRevision, sourceTree, wizardRevision: legacy[1] };
  const tree = /^040000 tree ([a-f0-9]{40})\twizard$/.exec(entry);
  if (!tree) throw Error('A tracked Wizard source tree or historical gitlink is required.');
  return { sourceLayout: 'system-monorepo-v1', sourceRevision, sourceTree, wizardSourceTree: tree[1] };
}
export function wizardImageRevision(source: SourceIdentity): string {
  return source.sourceLayout === 'system-monorepo-v1' ? source.sourceRevision : source.wizardRevision;
}
export function verifyCheckout(source: SourceIdentity, root: string, execute: Execute): void {
  const actual = checkoutIdentity(root, source.sourceRevision, execute);
  if (JSON.stringify(actual) !== JSON.stringify(readSourceIdentity(source))) throw Error('Publication checkout must match the accepted source and Wizard identity.');
}
