import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ControllerLeaseService } from './controller-lease.service';
import { requireValue as ensure, writePrivate } from './install';
import { record } from '../release/source-identity';

type Entry = {
  path: string;
  mode: number;
  uid: number;
  gid: number;
  type: string;
  target?: string;
  bytes?: number;
  sha256?: string;
};
const excluded = ['.gitlab-upgrade-lock', '.wizard.env.environments.lock'];
const hash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
function fileHash(filename: string): string {
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const digest = crypto.createHash('sha256'),
      buffer = Buffer.alloc(1024 ** 2);
    let count: number;
    while ((count = fs.readSync(descriptor, buffer)) > 0) digest.update(buffer.subarray(0, count));
    return digest.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}
function barrier(directory: string): void {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
/** Byte, ownership and mode inventory intentionally excludes volatile sockets and devices. */
export function controllerInventory(root: string): Entry[] {
  const entries: Entry[] = [];
  function walk(directory: string): void {
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name),
        stat = fs.lstatSync(filename);
      if (stat.isDirectory() && excluded.includes(name)) continue;
      const common = {
        path: path.relative(root, filename),
        mode: stat.mode & 0o7777,
        uid: stat.uid,
        gid: stat.gid,
      };
      if (stat.isSymbolicLink())
        entries.push({ ...common, type: 'link', target: fs.readlinkSync(filename) });
      else if (stat.isDirectory()) {
        entries.push({ ...common, type: 'directory' });
        walk(filename);
      } else if (stat.isFile())
        entries.push({ ...common, type: 'file', bytes: stat.size, sha256: fileHash(filename) });
    }
  }
  walk(root);
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
export class ControllerCheckpointService {
  constructor(readonly lease: ControllerLeaseService) {}

  verify(checkpoint: string, expected: string): void {
    const filename = path.join(checkpoint, 'cold-checkpoint.json'),
      stat = fs.lstatSync(filename);
    ensure(
      stat.isFile() && !(stat.mode & 0o077) && stat.size <= 128 * 1024 ** 2,
      'private-controller-checkpoint-required',
    );
    const raw = fs.readFileSync(filename);
    ensure(
      /^[a-f0-9]{64}$/.test(expected) && hash(raw) === expected,
      'controller-cold-checkpoint-hash-mismatch',
    );
    const value = record(JSON.parse(raw.toString())),
      entries = record(value.entries);
    ensure(
      value.format === 'system-controller-cold-checkpoint-v1' &&
        Object.keys(entries).sort().join(',') === 'configuration,gitlab',
      'controller-cold-checkpoint-format-invalid',
    );
    for (const name of ['gitlab', 'configuration']) {
      const directory = path.join(checkpoint, name),
        stat = fs.lstatSync(directory);
      ensure(
        stat.isDirectory() && !stat.isSymbolicLink(),
        'controller-cold-checkpoint-directory-required',
      );
      ensure(
        equal(controllerInventory(directory), entries[name]),
        'controller-cold-checkpoint-content-mismatch',
      );
    }
  }

  async copy(root: string, checkpoint: string, image: string): Promise<string> {
    ensure(
      path.isAbsolute(root) && path.isAbsolute(checkpoint) && image.length > 0,
      'controller-checkpoint-inputs-required',
    );
    // A valid lease is required before taking even the first inventory.
    this.lease.guardFd;
    const sources = ['gitlab', 'configuration'].map((name) => ({
      name,
      source: path.join(root, name),
    }));
    const initial = sources.map(({ source }) => controllerInventory(source));
    const size = initial.flat().reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
      space = fs.statfsSync(checkpoint);
    ensure(
      space.bavail * space.bsize > size * 1.25 + 100 * 1024 ** 2,
      'controller-cold-checkpoint-space-insufficient',
    );
    const entries: Record<string, Entry[]> = {};
    for (const [index, { name, source }] of sources.entries()) {
      const destination = path.join(checkpoint, name);
      fs.mkdirSync(destination, { mode: 0o700 });
      const before = initial[index],
        helper = 'system-controller-copy-' + crypto.randomUUID().replaceAll('-', '');
      writePrivate(
        path.join(checkpoint, 'copy-helper.json'),
        Buffer.from(JSON.stringify({ name: helper, owner: helper }) + '\n'),
      );
      const docker = ['docker', '--host=unix:///var/run/docker.sock'];
      try {
        await this.lease.command([
          ...docker,
          'run',
          '--rm',
          '--name',
          helper,
          '--label',
          'org.system-bootstrapper.controller-copy=' + helper,
          '--network',
          'none',
          '--read-only',
          '--user',
          '0',
          '--memory',
          '256m',
          '--cpus',
          '1',
          '--pids-limit',
          '64',
          '--mount',
          'type=bind,src=' + source + ',dst=/source,readonly',
          '--mount',
          'type=bind,src=' + destination + ',dst=/destination',
          '--entrypoint',
          'timeout',
          image,
          '-k',
          '2',
          '240',
          'rsync',
          '-a',
          '--numeric-ids',
          '--no-specials',
          '--no-devices',
          '--fsync',
          ...excluded.map((name) => '--exclude=' + name),
          '/source/',
          '/destination/',
        ]);
      } catch (error) {
        // The Docker client can fail while its remote helper is still writing.
        // Inspection/cleanup runs under the same guardian and exact ownership.
        let remaining: Record<string, unknown> | undefined;
        try {
          const inspected: unknown = JSON.parse(
            (await this.lease.command([...docker, 'inspect', helper])).toString(),
          );
          ensure(
            Array.isArray(inspected) && inspected.length === 1,
            'exact-container-inspection-required',
          );
          remaining = record(inspected[0]);
        } catch {
          /* A missing helper is safe; an uncertain command still blocks subsequent lease operations. */
        }
        if (remaining) {
          ensure(
            record(record(remaining.Config).Labels)['org.system-bootstrapper.controller-copy'] ===
              helper,
            'checkpoint-helper-ownership-changed',
          );
          ensure(typeof remaining.Id === 'string', 'checkpoint-helper-identity-required');
          await this.lease.command([...docker, 'rm', '--force', remaining.Id as string]);
        }
        throw error;
      }
      const after = controllerInventory(source),
        copied = controllerInventory(destination);
      ensure(
        equal(before, after) && equal(before, copied),
        'controller-cold-checkpoint-content-mismatch',
      );
      entries[name] = copied;
      for (const entry of [...copied].reverse())
        if (entry.type === 'directory') barrier(path.join(destination, entry.path));
      barrier(destination);
    }
    for (const directory of [
      checkpoint,
      path.dirname(checkpoint),
      path.dirname(path.dirname(checkpoint)),
    ])
      barrier(directory);
    const raw = Buffer.from(
      JSON.stringify({
        format: 'system-controller-cold-checkpoint-v1',
        at: new Date().toISOString(),
        entries,
      }) + '\n',
    );
    ensure(raw.length <= 128 * 1024 ** 2, 'controller-checkpoint-size-limit');
    writePrivate(path.join(checkpoint, 'cold-checkpoint.json'), raw);
    const digest = hash(raw);
    this.verify(checkpoint, digest);
    return digest;
  }
}
function equal(left: unknown, right: unknown): boolean {
  // Object key order is not part of historical Python JSON receipt identity.
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>,
      b = right as Record<string, unknown>;
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  }
  return left === right;
}
