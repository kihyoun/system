export const ROUTING_PROCESS = Symbol('ROUTING_PROCESS');
export const ROUTING_CONFIGURATION = Symbol('ROUTING_CONFIGURATION');
import fs from 'node:fs';
import { environmentAssignments } from '../../common/runtime/environment-assignments';
import { Settings } from './types';
export interface ConfigurationPort {
  read(files: readonly string[], keys: readonly string[], defaults?: Settings): Settings;
}
/** Routing consumes declarative settings; configuration never executes commands. */
export class LiteralConfiguration implements ConfigurationPort {
  read(files: readonly string[], keys: readonly string[], defaults: Settings = {}): Settings {
    const values: NodeJS.ProcessEnv = { ...process.env, ...defaults };
    for (const file of files)
      Object.assign(values, environmentAssignments(fs.readFileSync(file, 'utf8')));
    return Object.fromEntries(keys.map((key) => [key, values[key] || '']));
  }
}
