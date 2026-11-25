import { readSourceIdentity, record, wizardImageRevision } from './sourceIdentity';
import type { CiIdentity } from './types';

export type PublicSource = {
  repository: string;
  revision: string;
  tree: string;
} & (
  | { sourceLayout: 'system-monorepo-v1'; wizardSourceTree: string }
  | { wizardRepository: string; wizardRevision: string }
);

/** Public source comes from accepted evidence, never a fabricated Wizard receipt. */
export function publicSource(
  ci: CiIdentity & { repository: string },
  accepted: unknown,
  publication: unknown,
  historicalSource?: unknown,
): PublicSource {
  const source = readSourceIdentity(accepted);
  const published = readSourceIdentity(publication);

  if (
    JSON.stringify(source) !== JSON.stringify(published) ||
    source.sourceRevision !== ci.sourceRevision
  ) {
    throw Error('Public images must preserve the accepted source identity.');
  }

  const base = {
    repository: 'https://github.com/' + ci.repository + '.git',
    revision: source.sourceRevision,
    tree: source.sourceTree,
  };

  if (source.sourceLayout === 'system-monorepo-v1') {
    if (historicalSource !== undefined && historicalSource !== null) {
      throw Error('Monorepo releases must not carry a separate Wizard source receipt.');
    }

    return {
      ...base,
      sourceLayout: source.sourceLayout,
      wizardSourceTree: source.wizardSourceTree,
    };
  }

  const row = record(historicalSource);

  if (
    row.format !== 'system-wizard-source-publication-v1' ||
    row.projectId !== ci.projectId ||
    row.pipelineId !== ci.pipelineId ||
    row.systemRevision !== source.sourceRevision ||
    row.wizardRevision !== source.wizardRevision ||
    typeof row.repository !== 'string' ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.git$/.test(row.repository) ||
    row.ref !== 'refs/heads/system-release/' + source.wizardRevision
  ) {
    throw Error('Exact pinned Wizard source publication required.');
  }

  return { ...base, wizardRepository: row.repository, wizardRevision: source.wizardRevision };
}

export function publicWizardRevision(accepted: unknown): string {
  return wizardImageRevision(readSourceIdentity(accepted));
}
