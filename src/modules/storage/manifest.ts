import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireValue } from './types';

export interface SeedEntry {
  path: string;
  mode: number;
  uid: number;
  gid: number;
  type?: 'link' | 'directory' | 'file';
  target?: string;
  size?: number;
  sha256?: string;
}
export interface SeedManifest {
  format: 'system-bootstrapper-seed-v2';
  completedAt: string;
  consistency: 'gitlab-stopped';
  gitlabImage: string;
  gitlabImageId: string;
  runnerImage: string;
  entries: SeedEntry[];
}

export function inventory(root: string): SeedEntry[] {
  if (fs.existsSync(path.join(root, 'srv/gitlab/data/.system-bootstrapper-restore-incomplete'))) {
    throw new Error('Seed contains an incomplete restore');
  }

  const entries: SeedEntry[] = [];
  function visit(relative: string) {
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    const record: SeedEntry = {
      path: relative,
      mode: stat.mode & 0o7777,
      uid: stat.uid,
      gid: stat.gid,
    };

    if (stat.isSymbolicLink()) {
      record.type = 'link';
      record.target = fs.readlinkSync(full);
    } else if (stat.isDirectory()) {
      record.type = 'directory';
    } else if (stat.isFile()) {
      record.type = 'file';
      record.size = stat.size;
      // Stream large database/registry objects instead of buffering them in RAM.
      const digest = crypto.createHash('sha256');
      const descriptor = fs.openSync(full, 'r');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      try {
        let count;
        while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null))) {
          digest.update(buffer.subarray(0, count));
        }
      } finally {
        fs.closeSync(descriptor);
      }
      record.sha256 = digest.digest('hex');
    } else {
      throw new Error('Unsupported Seed entry type');
    }

    entries.push(record);

    if (record.type === 'directory') {
      fs.readdirSync(full)
        .sort()
        .forEach((name) => visit(path.posix.join(relative, name)));
    }
  }
  for (const directory of ['srv', 'ssl', 'letsencrypt']) {
    if (!fs.existsSync(path.join(root, directory))) {
      throw new Error(`Incomplete Seed: missing ${directory}`);
    }

    visit(directory);
  }
  return entries;
}
export function durableDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
export function create(root: string): SeedManifest {
  const manifest: SeedManifest = {
    format: 'system-bootstrapper-seed-v2',
    completedAt: new Date().toISOString(),
    consistency: 'gitlab-stopped',
    gitlabImage: process.env.GITLAB_IMAGE || '',
    gitlabImageId: process.env.GITLAB_IMAGE_ID || '',
    runnerImage: process.env.GITLAB_RUNNER_IMAGE || '',
    entries: inventory(root),
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest) + '\n', {
    mode: 0o600,
    flush: true,
  });
  manifest.entries
    .filter((entry) => entry.type === 'directory')
    .reverse()
    .forEach((entry) => durableDirectory(path.join(root, entry.path)));
  durableDirectory(root);
  return manifest;
}
export function verify(root: string, verifyImage = true): SeedManifest {
  const manifest: SeedManifest = JSON.parse(
    fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'),
  );
  requireValue(
    manifest.format === 'system-bootstrapper-seed-v2' && manifest.consistency === 'gitlab-stopped',
    'seed-payload-invalid',
  );
  requireValue(
    JSON.stringify(inventory(root)) === JSON.stringify(manifest.entries),
    'seed-payload-invalid',
  );

  if (verifyImage && manifest.gitlabImage && manifest.gitlabImage !== process.env.GITLAB_IMAGE) {
    throw new Error('Restore requires the harvested GitLab version and edition');
  }

  return manifest;
}
export function publish(seed: string, stage: string) {
  verify(stage);
  const relative = path.posix.join('snapshots', path.basename(stage).replace(/^\.harvest-/, ''));
  fs.mkdirSync(path.join(seed, 'snapshots'), { recursive: true, mode: 0o700 });
  fs.renameSync(stage, path.join(seed, relative));
  durableDirectory(path.join(seed, 'snapshots'));
  const next = path.join(seed, '.current-next');

  if (
    fs.existsSync(next) ||
    (() => {
      try {
        return fs.lstatSync(next).isSymbolicLink();
      } catch {
        return false;
      }
    })()
  ) {
    fs.unlinkSync(next);
  }

  fs.symlinkSync(relative, next);
  fs.renameSync(next, path.join(seed, 'current'));
  durableDirectory(seed);
}
export function current(seed: string, verifyImage = true) {
  const link = path.join(seed, 'current');

  if (!fs.lstatSync(link).isSymbolicLink()) {
    throw new Error('Seed current must be a snapshot link');
  }

  const relative = fs.readlinkSync(link);

  if (!/^snapshots\/[A-Za-z0-9.-]+$/.test(relative)) {
    throw new Error('Invalid Seed snapshot path');
  }

  const root = path.join(seed, relative);

  if (fs.realpathSync(root) !== path.resolve(seed, relative)) {
    throw new Error('Seed snapshot escapes its root');
  }

  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error('Unsafe Seed snapshot');
  }

  verify(root, verifyImage);
  return root;
}
export function markRestore(srv: string, io = fs) {
  const directory = path.join(srv, 'gitlab/data');
  const marker = path.join(directory, '.system-bootstrapper-restore-incomplete');
  const descriptor = io.openSync(marker, 'w', 0o600);
  try {
    io.writeFileSync(descriptor, 'system-bootstrapper-restore-incomplete\n');
    io.fsyncSync(descriptor);
  } finally {
    io.closeSync(descriptor);
  }
  const parent = io.openSync(directory, 'r');
  try {
    io.fsyncSync(parent);
  } finally {
    io.closeSync(parent);
  }
}
export function finishRestore(source: string, srv: string, ssl: string, certbot: string, io = fs) {
  const manifest: SeedManifest = JSON.parse(
    io.readFileSync(path.join(source, 'manifest.json'), 'utf8'),
  );
  const roots: Record<string, string> = { srv, ssl, letsencrypt: certbot };
  // rsync --fsync persists file bytes; persist destination directory entries,
  // including symlinks and removals, before clearing the restore barrier.
  for (const entry of manifest.entries.filter((entry) => entry.type === 'directory').reverse()) {
    const [root, ...relative] = entry.path.split('/');

    if (!roots[root] || relative.some((part) => part === '..' || !part)) {
      throw new Error('Invalid restore directory');
    }

    const descriptor = io.openSync(path.join(roots[root], ...relative), 'r');
    try {
      io.fsyncSync(descriptor);
    } finally {
      io.closeSync(descriptor);
    }
  }
  const directory = path.join(srv, 'gitlab/data');
  io.unlinkSync(path.join(directory, '.system-bootstrapper-restore-incomplete'));
  const descriptor = io.openSync(directory, 'r');
  try {
    io.fsyncSync(descriptor);
  } finally {
    io.closeSync(descriptor);
  }
}
