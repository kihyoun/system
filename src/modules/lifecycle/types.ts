import fs from 'node:fs';
import type { ConfigurationPort } from '../projects-routing/ports';
export const LIFECYCLE_CHILD = Symbol('LIFECYCLE_CHILD');
export const LIFECYCLE_CONFIGURATION = Symbol('LIFECYCLE_CONFIGURATION');
export interface LifecycleContext {
  root: string;
  state: string;
  environment: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  supervisedGroup?: boolean;
}
/** Retained shell assignments are interpreted only by the configuration-format adapter. */
export function settings(
  configuration: ConfigurationPort,
  files: string[],
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const keys = [
    ...new Set(
      files.flatMap((file) =>
        [...fs.readFileSync(file, 'utf8').matchAll(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=/gm)].map(
          (match) => match[1],
        ),
      ),
    ),
  ];
  return {
    ...environment,
    ...configuration.read(
      files,
      keys,
      Object.fromEntries(
        Object.entries(environment).filter(
          (item): item is [string, string] => typeof item[1] === 'string',
        ),
      ),
    ),
  };
}
