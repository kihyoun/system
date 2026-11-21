import fs from 'node:fs';
import { row } from './verification.service';
export function privateJson(filename: string): Record<string, unknown> {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.mode & 0o077 || stat.size > 4 * 1024 * 1024)
      throw Error('Private input/state must be a bounded regular file with mode 0600.');
    return row(JSON.parse(fs.readFileSync(fd, 'utf8')));
  } finally {
    fs.closeSync(fd);
  }
}
