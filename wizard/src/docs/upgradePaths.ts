import maintained from './upgrade-paths.json';

export type UpgradeTransition = {
  from: string;
  to: string;
  kind: string;
  services: string[];
  databaseMigration: boolean;
  serviceImagesPreserved: boolean;
  minimumFreeGiB: number;
  requiredStage: string;
  steps: string[];
};
export type UpgradeGraph = { format: string; versions: string[]; transitions: UpgradeTransition[] };
export type UpgradeRoute = {
  status: 'unknown' | 'unnecessary' | 'unsupported' | 'supported';
  transitions: UpgradeTransition[];
};
export const upgradeGraph: UpgradeGraph = maintained;

/** Match the CLI's ascending graph traversal; never infer edges from SemVer. */
export function upgradePath(
  source: string,
  target: string,
  graph: UpgradeGraph = upgradeGraph,
): UpgradeRoute {
  if (!graph.versions.includes(source) || !graph.versions.includes(target))
    return { status: 'unknown', transitions: [] };
  if (source === target) return { status: 'unnecessary', transitions: [] };
  const queue: { version: string; transitions: UpgradeTransition[] }[] = [
    { version: source, transitions: [] },
  ];
  const seen = new Set([source]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.transitions.filter((edge) => edge.from === current.version)) {
      const transitions = [...current.transitions, edge];
      if (edge.to === target) return { status: 'supported', transitions };
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push({ version: edge.to, transitions });
      }
    }
  }
  return { status: 'unsupported', transitions: [] };
}
