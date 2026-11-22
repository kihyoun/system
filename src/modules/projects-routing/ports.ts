export const routingProcess = Symbol('ROUTING_PROCESS');
export const routingConfiguration = Symbol('ROUTING_CONFIGURATION');
import fs from 'node:fs';
import { environmentAssignments } from '../../common/runtime/environmentAssignments';
import { Settings } from './types';
export interface ConfigurationPort {
  read(files: readonly string[], keys: readonly string[], defaults?: Settings): Settings;
}
/** Routing consumes declarative settings; configuration never executes commands. */
export class LiteralConfiguration implements ConfigurationPort {
  read(files: readonly string[], keys: readonly string[], defaults: Settings = {}): Settings {
    const values: NodeJS.ProcessEnv = { ...process.env, ...defaults };
    for (const file of files) {
      Object.assign(values, environmentAssignments(fs.readFileSync(file, 'utf8')));
    }
    return Object.fromEntries(keys.map((key) => [key, values[key] || '']));
  }
}
