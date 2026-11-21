import { spawnSync } from 'node:child_process';
import { ProcessFailure } from '../../common/runtime/process';
export const CONTEXT_PROCESS = Symbol('CONTEXT_PROCESS');
export interface ContextProcess {
  run(
    binary: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number },
  ): Buffer;
}
export class NativeContextProcess implements ContextProcess {
  run(
    binary: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number } = {},
  ): Buffer {
    const result = spawnSync(binary, args, {
      ...options,
      timeout: 120000,
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    if (result.error || result.status !== 0 || result.signal)
      throw new ProcessFailure(
        binary,
        result.status,
        result.signal,
        !!result.error || result.status === null || !!result.signal,
      );
    return result.stdout;
  }
}
