import { spawnSync } from 'node:child_process';
import type { CommandOptions } from './types';
export const UPGRADE_PROCESS = Symbol('GITLAB_UPGRADE_PROCESS');
export interface UpgradeProcess {
  run(binary: string, args: string[], options?: CommandOptions): string;
}
export function run(binary: string, args: string[], options: CommandOptions = {}) {
  const r = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: options.timeout || 180000,
    maxBuffer: 8 * 1024 * 1024,
    input: options.input,
    cwd: options.cwd,
    env: options.env,
    ...{ detached: options.detached },
  });
  if (r.error || r.status !== 0) throw Error('upgrade-operation-failed');
  return (r.stdout || '').trim();
}

export class NativeUpgradeProcess implements UpgradeProcess {
  run(binary: string, args: string[], options?: CommandOptions): string {
    return run(binary, args, options);
  }
}
