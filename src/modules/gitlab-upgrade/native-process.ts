import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { CommandOptions } from './types';
import {
  nativeFailureFacts,
  workerFailureFacts,
  type UpgradeNativeFailureFacts,
} from './command-failure-policy';
export const UPGRADE_PROCESS = Symbol('GITLAB_UPGRADE_PROCESS');
export interface UpgradeProcess {
  run(binary: string, args: string[], options?: CommandOptions): string;
}
export class NativeUpgradeProcessFailure extends Error {
  readonly failureKind: UpgradeNativeFailureFacts['kind'];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly systemCode?: UpgradeNativeFailureFacts['systemCode'];

  constructor(facts: UpgradeNativeFailureFacts) {
    super('upgrade-operation-failed');
    this.name = 'NativeUpgradeProcessFailure';
    this.failureKind = facts.kind;
    this.exitCode = facts.exitCode;
    this.signal = facts.signal;
    this.systemCode = facts.systemCode;
  }
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
  if (r.error || r.status !== 0 || r.signal !== null) {
    const watched =
      binary === process.execPath &&
      args[0] === path.join(__dirname, 'child-entry.js') &&
      args[1] === 'watchdog' &&
      args.length === 3;
    const reported =
      watched && !r.error && r.signal === null && r.status !== null && r.status > 0
        ? workerFailureFacts(r.stdout || '', r.stderr || '')
        : undefined;
    throw new NativeUpgradeProcessFailure(
      reported
        ? { ...reported, exitCode: r.status }
        : nativeFailureFacts(r.error, r.status, r.signal),
    );
  }
  return (r.stdout || '').trim();
}

export class NativeUpgradeProcess implements UpgradeProcess {
  run(binary: string, args: string[], options?: CommandOptions): string {
    return run(binary, args, options);
  }
}
