import fs from 'node:fs';
import path from 'node:path';

const historicalVersions = new Set(['1.0.0', '1.1.0', '1.1.1', '1.1.2', '1.1.3', '1.2.0']);

/** Select the declared layout of this exact checkout; never infer it from missing assets. */
export function checkoutLayout(root: string): 'historical' | 'native' {
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  if (version === '2.0.0') return 'native';
  if (historicalVersions.has(version)) return 'historical';
  throw Error('unsupported-checkout-layout-version');
}

export function checkoutConfiguration(
  root: string,
  component: 'system' | 'gitlab',
  ...parts: string[]
): string {
  return path.join(root, checkoutLayout(root) === 'native' ? 'config' : '', component, ...parts);
}

export function checkoutUpgradeGraph(root: string): string {
  return path.join(
    root,
    checkoutLayout(root) === 'native' ? 'config/releases' : 'bootstrapper',
    'upgrade-paths.json',
  );
}
