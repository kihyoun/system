import fs from 'node:fs';
import { requireValue } from './install';
/** Validate and read the same open inode, including files replaced concurrently. */
export function readPrivateSnapshot(
  filename: string,
  maximum = 8 * 1024 ** 2,
  policy: { owner?: number; mode?: number } = {},
): { bytes: Buffer; stat: fs.Stats } {
  requireValue(Number.isSafeInteger(maximum) && maximum > 0, 'invalid-private-input-limit');
  const descriptor = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = fs.fstatSync(descriptor);
    requireValue(stat.isFile() && stat.nlink === 1, 'private-file-must-be-regular');
    requireValue(
      (stat.mode & 0o077) === 0 &&
        (policy.owner === undefined || stat.uid === policy.owner) &&
        (policy.mode === undefined || (stat.mode & 0o777) === policy.mode),
      'private-file-permissions-or-owner-mismatch',
    );
    requireValue(stat.size <= maximum, 'input-is-too-large');
    const bytes = Buffer.alloc(maximum + 1);
    let used = 0,
      count: number;
    while (
      used < bytes.length &&
      (count = fs.readSync(descriptor, bytes, used, bytes.length - used, null)) > 0
    ) {
      used += count;
    }
    requireValue(used <= maximum, 'input-is-too-large');
    return { bytes: Buffer.from(bytes.subarray(0, used)), stat };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readPrivateInput(
  filename: string,
  maximum = 8 * 1024 ** 2,
  policy: { owner?: number; mode?: number } = {},
): Buffer {
  return readPrivateSnapshot(filename, maximum, policy).bytes;
}
