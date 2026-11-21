import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
/** Native flock belongs to the open descriptor, retained for the caller lifetime.
 * Short options work with both Ubuntu util-linux and the controller's BusyBox. */
export function fileLock(filename: string, nonblocking = true): () => void {
  const fd = fs.openSync(
    filename,
    fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const result = spawnSync('flock', ['-x', ...(nonblocking ? ['-n'] : []), '3'], {
      stdio: ['ignore', 'pipe', 'pipe', fd],
      timeout: nonblocking ? 10000 : undefined,
    });
    if (result.error || result.status !== 0) throw Error('Operation mutex is busy or unavailable.');
    return () => fs.closeSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}
