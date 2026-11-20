import { record } from '../release/source-identity';
import { requireValue } from './install';
export const semver = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const steps = ['prerequisites', 'backup', 'preflight', 'apply', 'verify', 'recovery'];
export interface UpgradeEdge {
  from: string;
  to: string;
  kind: 'controller-wizard';
  databaseMigration: false;
  serviceImagesPreserved: true;
  services: ['controller', 'Wizard'];
  minimumFreeGiB: number;
  requiredStage: string;
  steps: string[];
}
export interface UpgradeGraph {
  format: 'system-upgrade-paths-v1';
  versions: string[];
  transitions: UpgradeEdge[];
}
const compare = (a: string, b: string) => {
  const left = a.split('.').map(BigInt),
    right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
};
export function validateUpgradeGraph(input: unknown): UpgradeGraph {
  const value = record(input);
  requireValue(
    value.format === 'system-upgrade-paths-v1' && Array.isArray(value.versions),
    'invalid-upgrade-metadata',
  );
  const versions = value.versions;
  requireValue(
    versions.length &&
      new Set(versions).size === versions.length &&
      versions.every((v) => typeof v === 'string' && semver.test(v) && !v.includes('\n')),
    'invalid-upgrade-versions',
  );
  requireValue(
    versions.every((v, i) => i === 0 || compare(versions[i - 1], v) < 0),
    'upgrade-versions-must-be-in-ascending-order',
  );
  requireValue(
    value.transitions === undefined || Array.isArray(value.transitions),
    'invalid-or-unimplemented-upgrade-transition',
  );
  const pairs = new Set<string>();
  for (const input of (value.transitions || []) as unknown[]) {
    const row = record(input),
      pair = String(row.from) + '>' + String(row.to);
    requireValue(
      typeof row.from === 'string' &&
        typeof row.to === 'string' &&
        !pairs.has(pair) &&
        versions.includes(row.from) &&
        versions.includes(row.to) &&
        compare(row.from, row.to) < 0 &&
        row.kind === 'controller-wizard' &&
        row.databaseMigration === false &&
        row.serviceImagesPreserved === true &&
        JSON.stringify(row.services) === JSON.stringify(['controller', 'Wizard']) &&
        typeof row.minimumFreeGiB === 'number' &&
        Number.isSafeInteger(row.minimumFreeGiB) &&
        row.minimumFreeGiB >= 8 &&
        row.requiredStage ===
          'public-release-upgrade-' +
            row.from.replaceAll('.', '-') +
            '-to-' +
            row.to.replaceAll('.', '-') &&
        JSON.stringify(row.steps) === JSON.stringify(steps),
      'invalid-or-unimplemented-upgrade-transition',
    );
    pairs.add(pair);
  }
  return value as unknown as UpgradeGraph;
}
export function upgradePath(
  input: unknown,
  source: string,
  target: string,
): { status: 'unknown' | 'unnecessary' | 'supported' | 'unsupported'; transitions: UpgradeEdge[] } {
  const graph = validateUpgradeGraph(input);
  if (!graph.versions.includes(source) || !graph.versions.includes(target))
    return { status: 'unknown', transitions: [] };
  if (source === target) return { status: 'unnecessary', transitions: [] };
  const queue: { current: string; steps: UpgradeEdge[] }[] = [{ current: source, steps: [] }],
    seen = new Set([source]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.transitions || []) {
      if (edge.from !== current.current) continue;
      const route = [...current.steps, edge];
      if (edge.to === target) return { status: 'supported', transitions: route };
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push({ current: edge.to, steps: route });
      }
    }
  }
  return { status: 'unsupported', transitions: [] };
}
