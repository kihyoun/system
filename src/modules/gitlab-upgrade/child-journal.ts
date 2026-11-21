import fs from 'node:fs';
import path from 'node:path';
export interface ProcessIdentity {
  state: string;
  group: number;
  start: string;
}
export const uptime = (): number => Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
export function stat(pid: number): ProcessIdentity | null {
  try {
    const raw = fs.readFileSync('/proc/' + pid + '/stat', 'utf8'),
      fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    return { state: fields[0], group: Number(fields[2]), start: fields[19] };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ESRCH') return null;
    throw error;
  }
}
export function activeGroup(group: number): boolean {
  return fs
    .readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .some((name) => {
      const row = stat(Number(name));
      return !!row && row.group === group && row.state !== 'Z';
    });
}
export function record(filename: string, value: unknown): void {
  const temporary = filename + '.' + process.pid + '.tmp';
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, filename);
    fd = fs.openSync(path.dirname(filename), 'r');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
