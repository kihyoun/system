import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readRecord, type InventoryRoot, type InventoryEntry } from './types';
export const INPUT_JSON_MAX_BYTES = 4 * 1024 * 1024;
export const CHECKPOINT_JSON_MAX_BYTES = 64 * 1024 * 1024;
export function regular(filename: string) {
  const s = fs.lstatSync(filename);
  if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0)
    throw Error('upgrade-private-regular-file-required');
  return filename;
}

export function jsonBytes(
  filename: string,
  maximum = INPUT_JSON_MAX_BYTES,
  tooLarge = 'upgrade-input-too-large',
) {
  regular(filename);
  const descriptor = fs.openSync(filename, 'r');
  try {
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0)
      throw Error('upgrade-private-regular-file-required');
    if (metadata.size > maximum) throw Error(tooLarge);
    // A fixed-size read also bounds allocation if the file grows after fstat.
    const bytes = Buffer.alloc(metadata.size + 1);
    let length = 0,
      count;
    while (
      length < bytes.length &&
      (count = fs.readSync(descriptor, bytes, length, bytes.length - length, null))
    )
      length += count;
    if (length > metadata.size) throw Error(tooLarge);
    return bytes.subarray(0, length);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function json(filename: string) {
  return readRecord(JSON.parse(jsonBytes(filename).toString('utf8')));
}

export function atomic(filename: string, value: string | Buffer) {
  const tmp = filename + '.' + crypto.randomBytes(8).toString('hex');
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, filename);
    fd = fs.openSync(path.dirname(filename), 'r');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

export function durableDirectory(directory: string) {
  const fd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function durableAncestors(directory: string) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    durableDirectory(current);
    if (current === path.dirname(current)) break;
  }
}

export function inventoryAt(roots: InventoryRoot[], ignore: Set<string> = new Set()) {
  const entries: InventoryEntry[] = [];
  function visit(full: string, relative: string) {
    if (ignore.has(relative)) return;
    const s = fs.lstatSync(full),
      e: InventoryEntry = { path: relative, mode: s.mode & 0o7777, uid: s.uid, gid: s.gid };
    if (s.isSymbolicLink()) {
      e.type = 'link';
      e.target = fs.readlinkSync(full);
    } else if (s.isDirectory()) e.type = 'directory';
    else if (s.isFile()) {
      e.type = 'file';
      e.size = s.size;
      const h = crypto.createHash('sha256'),
        buffer = Buffer.allocUnsafe(1024 * 1024),
        fd = fs.openSync(full, 'r');
      try {
        let n;
        while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)))
          h.update(buffer.subarray(0, n));
      } finally {
        fs.closeSync(fd);
      }
      e.sha256 = h.digest('hex');
    } else throw Error('upgrade-checkpoint-entry-invalid');
    entries.push(e);
    if (s.isDirectory())
      for (const name of fs.readdirSync(full).sort())
        visit(path.join(full, name), path.posix.join(relative, name));
  }
  for (const root of roots) visit(root.full, root.path);
  return entries;
}

export function inventory(directory: string) {
  return inventoryAt(
    ['gitlab', 'configuration'].map((name) => ({ full: path.join(directory, name), path: name })),
  );
}
