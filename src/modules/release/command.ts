import { nativeProcess, type ProcessRunner } from '../../common/runtime/process';
import type { Execute } from './types';
/** Same bounded/redacted process port used by other operational modules. */
export function publicationCommand(processes: ProcessRunner): Execute {
  return (binary, args, options = {}) => {
    const result = processes.run(binary, args, {
      timeout: 600000,
      maxBuffer: 4 * 1024 ** 2,
      ...options,
    });

    if (result.status !== 0) {
      throw Error('Successor publication operation failed.');
    }

    return result.stdout.trim();
  };
}
export const command = publicationCommand(nativeProcess);
