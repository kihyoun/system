import fs from 'node:fs';
import { requireValue } from './install';
/** Validate and read the same open inode, including files replaced concurrently. */
export function readPrivateInput(filename: string, maximum = 8 * 1024 ** 2): Buffer {
  requireValue(Number.isSafeInteger(maximum) && maximum > 0, 'invalid-private-input-limit');
  const descriptor = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = fs.fstatSync(descriptor);
    requireValue(stat.isFile() && stat.nlink === 1, 'private-file-must-be-regular');
    requireValue(
      stat.uid === 0 && (stat.mode & 0o777) === 0o600,
      'private-file-must-be-root-owned-mode-0600',
    );
    requireValue(stat.size <= maximum, 'input-is-too-large');
    const bytes = Buffer.alloc(maximum + 1);
    let used = 0,
      count: number;
    while (
      used < bytes.length &&
      (count = fs.readSync(descriptor, bytes, used, bytes.length - used, null)) > 0
    )
      used += count;
    requireValue(used <= maximum, 'input-is-too-large');
    return Buffer.from(bytes.subarray(0, used));
  } finally {
    fs.closeSync(descriptor);
  }
}
