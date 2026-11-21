import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StorageSpec, MountRow, requireValue } from './types';
const liveDirectories = [
  'configuration',
  'wizard-public',
  'templates',
  'synctemplates',
  'ssl',
  'runners',
  'gitlab/config',
  'gitlab/logs',
  'gitlab/data',
  'host/letsencrypt',
];
export function absolute(value: unknown): string {
  requireValue(
    typeof value === 'string' &&
      value.startsWith('/') &&
      value !== '/' &&
      path.posix.normalize(value) === value &&
      !/[\0-\x1f,]/.test(value),
    'invalid-storage-path',
  );
  return value;
}
export function disjoint(a: string, b: string) {
  return a !== b && !a.startsWith(b + '/') && !b.startsWith(a + '/');
}
export function mountRows(text: string): MountRow[] {
  const decode = (value: string) =>
    value.replace(/\\([0-7]{3})/g, (_, digits: string) => String.fromCharCode(parseInt(digits, 8)));
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [left, right] = line.split(' - '),
        columns = left.split(' ');
      requireValue(right && columns.length >= 6, 'invalid-host-mount-information');
      return {
        device: columns[2],
        target: decode(columns[4]),
        options: columns[5].split(','),
        type: right.split(' ')[0],
      };
    });
}
export function covering(rows: MountRow[], value: string): MountRow {
  const matches = rows
    .filter(
      (row) => row.target === '/' || value === row.target || value.startsWith(row.target + '/'),
    )
    .sort((a, b) => b.target.length - a.target.length);
  const row = matches[0];
  requireValue(
    !row || !matches[1] || matches[1].target.length !== row.target.length,
    'ambiguous-storage-mount',
  );
  requireValue(row, 'storage-mount-not-found');
  return row;
}
function resolveHost(value: string, hostRoot = '/host') {
  const selected = hostRoot + value;
  requireValue(
    fs.existsSync(selected) &&
      fs.realpathSync(selected) === selected &&
      fs.statSync(selected).isDirectory(),
    'seed-target-unavailable',
  );
  return selected;
}
function checkUuid(uuid: string | undefined, device: string) {
  if (!uuid) return;
  requireValue(/^[A-Za-z0-9-]+$/.test(uuid), 'invalid-filesystem-identity');
  const file = '/host/dev/disk/by-uuid/' + uuid;
  let stat;
  try {
    stat = fs.statSync(file, { bigint: true });
  } catch {
    throw Error('filesystem-identity-mismatch');
  }
  const dev = stat.rdev;
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
  const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
  requireValue(
    stat.isBlockDevice() && `${major}:${minor}` === device,
    'filesystem-identity-mismatch',
  );
}
export function validate(
  spec: StorageSpec,
  read: (filename: string, encoding: BufferEncoding) => string = fs.readFileSync,
  hostRoot = '/host',
) {
  const live = absolute(spec.PERSISTENT_DIR),
    seed = absolute(spec.SEED_DIR);
  requireValue(disjoint(live, seed), 'overlapping-live-and-backup-paths');
  const rows = mountRows(read(hostRoot + '/proc/1/mountinfo', 'utf8'));
  const root = covering(rows, '/'),
    liveRow = covering(rows, live),
    seedRow = covering(rows, seed);
  const mode = spec.PERSISTENCE_MODE || (spec.PERSISTENT_MOUNT ? 'volume' : 'local');
  requireValue(['local', 'volume'].includes(mode), 'invalid-persistence-mode');
  const mount = spec.PERSISTENT_MOUNT || '/';
  if (mode === 'local')
    requireValue(
      mount === '/' && liveRow.device === root.device && liveRow.target === root.target,
      'local-storage-is-not-on-system-disk',
    );
  else
    requireValue(
      mount !== '/' && liveRow.target === mount && liveRow.device !== root.device,
      'live-volume-unavailable',
    );
  if (spec.SEED_MOUNT) {
    requireValue(
      spec.SEED_MOUNT === '/' || path.posix.normalize(spec.SEED_MOUNT) === spec.SEED_MOUNT,
      'invalid-seed-mount',
    );
    requireValue(
      seedRow.target === spec.SEED_MOUNT &&
        (seed === spec.SEED_MOUNT || seed.startsWith(spec.SEED_MOUNT.replace(/\/$/, '') + '/')),
      'seed-target-unavailable',
    );
  } else {
    // A different device must be declared explicitly, so disappearance cannot
    // silently turn a backup into a directory on the live/system filesystem.
    requireValue(seedRow.device === liveRow.device, 'declare-external-seed-mount');
  }
  if (mode === 'local')
    requireValue(
      spec.SEED_MOUNT &&
        spec.SEED_MOUNT !== '/' &&
        seedRow.target === spec.SEED_MOUNT &&
        seedRow.device !== liveRow.device &&
        seedRow.device !== root.device,
      'external-seed-volume-required',
    );
  resolveHost(live, hostRoot);
  resolveHost(seed, hostRoot);
  for (const relative of [...liveDirectories, 'configuration/.projects.env', 'ssl/acme-http01']) {
    const selected = live + '/' + relative;
    if (
      ['configuration/.projects.env', 'ssl/acme-http01'].includes(relative) &&
      !fs.lstatSync(hostRoot + selected, { throwIfNoEntry: false })
    )
      continue;
    resolveHost(selected, hostRoot);
    requireValue(covering(rows, selected).target === liveRow.target, 'nested-live-storage-mount');
  }
  requireValue(seedRow.options.includes('rw'), 'seed-target-not-writable');
  checkUuid(spec.PERSISTENT_UUID, liveRow.device);
  checkUuid(spec.SEED_UUID, seedRow.device);
  requireValue(
    !['vfat', 'msdos', '9p', 'drvfs'].includes(seedRow.type),
    'backup-requires-POSIX-filesystem',
  );
  return { live, seed, mode };
}

export function restoreEmpty(live = '/live') {
  for (const relative of [
    'gitlab/config',
    'gitlab/logs',
    'gitlab/data',
    'ssl',
    'host/letsencrypt',
  ]) {
    const directory = path.join(live, relative);
    requireValue(fs.existsSync(directory), 'restore-target-not-empty');
    const entries = fs.readdirSync(directory);
    const publicScaffold =
      relative === 'ssl' &&
      entries.length === 1 &&
      entries[0] === 'acme-http01' &&
      fs.lstatSync(path.join(directory, entries[0])).isDirectory() &&
      fs.readdirSync(path.join(directory, entries[0])).length === 0;
    requireValue(entries.length === 0 || publicScaffold, 'restore-target-not-empty');
  }
}
export function prepareLocal(spec: StorageSpec, hostRoot = '/host', mountinfo?: string) {
  requireValue(
    spec.PERSISTENCE_MODE === 'local' && (!spec.PERSISTENT_MOUNT || spec.PERSISTENT_MOUNT === '/'),
    'invalid-local-storage-selector',
  );
  const live = absolute(spec.PERSISTENT_DIR || '/var/lib/system-bootstrapper/platform');
  let existing = hostRoot + live;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  requireValue(
    existing === hostRoot || existing.startsWith(hostRoot + '/'),
    'invalid-storage-path',
  );
  requireValue(fs.realpathSync(existing) === existing, 'unsafe-live-storage-path');
  const rows = mountRows(mountinfo || fs.readFileSync(hostRoot + '/proc/1/mountinfo', 'utf8'));
  requireValue(
    covering(rows, live).device === covering(rows, '/').device,
    'local-storage-is-not-on-system-disk',
  );
  const disk = fs.statfsSync(existing);
  requireValue(disk.bavail * disk.bsize >= 1073741824, 'local-storage-insufficient-space');
  const root = hostRoot + live,
    marker = path.join(root, '.system-bootstrapper-volume');
  // Check every existing ancestor before mkdir: recursive mkdir otherwise
  // follows an intermediate symlink before a later realpath check can refuse.
  const scaffold = [...liveDirectories, 'ssl/acme-http01'];
  for (const relative of ['', ...scaffold]) {
    const selected = path.join(root, relative);
    let ancestor = selected;
    while (!fs.lstatSync(ancestor, { throwIfNoEntry: false })) ancestor = path.dirname(ancestor);
    requireValue(
      fs.realpathSync(ancestor) === ancestor && fs.statSync(ancestor).isDirectory(),
      'unsafe-live-storage-path',
    );
    requireValue(
      covering(rows, selected.slice(hostRoot.length)).target === covering(rows, '/').target,
      'nested-live-storage-mount',
    );
  }
  if (fs.lstatSync(marker, { throwIfNoEntry: false }))
    requireValue(
      fs.lstatSync(marker).isFile() &&
        !fs.lstatSync(marker).isSymbolicLink() &&
        fs.readFileSync(marker, 'utf8') === 'system-bootstrapper-persistence-v1\n',
      'unrecognized-live-storage',
    );
  for (const relative of scaffold) {
    const directory = path.join(root, relative);
    requireValue(
      !fs.lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink(),
      'unsafe-live-storage-path',
    );
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    requireValue(fs.realpathSync(directory) === directory, 'unsafe-live-storage-path');
  }
  fs.chmodSync(path.join(root, 'wizard-public'), 0o755);
  const ssl = path.join(root, 'ssl');
  fs.chmodSync(ssl, (fs.statSync(ssl).mode & 0o7777) | 0o111);
  fs.chmodSync(path.join(ssl, 'acme-http01'), 0o755);
  const descriptor = fs.openSync(
    marker,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(descriptor, 'system-bootstrapper-persistence-v1\n');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  console.log('Local live storage prepared.');
}
