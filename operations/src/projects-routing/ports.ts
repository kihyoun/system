import fs from 'node:fs';
import { ProcessRunner } from '../runtime/process';
import { Settings } from './types';
export interface ConfigurationPort {
  read(files: readonly string[], keys: readonly string[], defaults?: Settings): Settings;
}
/** Shell is only the retained configuration-format adapter; no routing decisions run in it. */
export class ShellConfiguration implements ConfigurationPort {
  constructor(private readonly process: ProcessRunner) {}
  read(files: readonly string[], keys: readonly string[], defaults: Settings = {}): Settings {
    if (files.some((file) => !fs.existsSync(file)))
      throw Error('Routing configuration file is missing.');
    const existing = files;
    const script =
      'count=$1; shift; for ((i=0;i<count;i++)); do source "$1"; shift; done; for key in "$@"; do printf "%s\\0%s\\0" "$key" "${!key-}"; done';
    const values = this.process
      .run(
        'bash',
        ['-e', '-c', script, 'routing-config', String(existing.length), ...existing, ...keys],
        { env: { ...process.env, ...defaults }, timeout: 10000, maxBuffer: 1024 * 1024 },
      )
      .stdout.split('\0');
    if (values.pop() !== '' || values.length !== keys.length * 2)
      throw Error('Invalid routing configuration response.');
    const result: Settings = {};
    keys.forEach((key, index) => {
      if (values[index * 2] !== key) throw Error('Invalid routing configuration key.');
      result[key] = values[index * 2 + 1];
    });
    return result;
  }
}
