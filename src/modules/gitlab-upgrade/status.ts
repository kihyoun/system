import fs from 'node:fs';
import path from 'node:path';

/** Passive failure evidence; this does not inspect or adopt a live process. */
export function upgradeChildOutcome(state: string) {
  const read = (name: string): Record<string, unknown> => {
    const file = path.join(state, '.gitlab-upgrade-lock', name);
    const descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) !== 0)
        throw Error('upgrade-status-child-invalid');
      const bytes = Buffer.alloc(4097);
      const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
      if (length > 4096) throw Error('upgrade-status-child-invalid');
      const value: unknown = JSON.parse(bytes.subarray(0, length).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('upgrade-status-child-invalid');
      return value as Record<string, unknown>;
    } finally {
      fs.closeSync(descriptor);
    }
  };
  const owner = read('upgrade-owner.json'),
    child = read('child.json');
  if (
    owner.format !== 'system-gitlab-upgrade-lock-v1' ||
    typeof owner.operation !== 'string' ||
    !/^[a-f0-9]{32}$/.test(owner.operation) ||
    child.format !== 'system-gitlab-upgrade-child-v1' ||
    child.operation !== owner.operation ||
    typeof child.phase !== 'string' ||
    !['running', 'completed'].includes(child.phase) ||
    (child.phase === 'completed' &&
      (typeof child.exitCode !== 'number' ||
        !Number.isInteger(child.exitCode) ||
        child.exitCode < 0 ||
        child.exitCode > 255))
  )
    throw Error('upgrade-status-child-invalid');
  return {
    phase: child.phase as 'running' | 'completed',
    ...(child.phase === 'completed' ? { exitCode: child.exitCode as number } : {}),
  };
}

/** Read-only status is available even when the original controller no longer exists. */
export function upgradeStatus(checkpoints: string, state: string) {
  const read = (filename: string): Record<string, unknown> => {
    if (!fs.existsSync(filename)) return {};
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 4 * 1024 ** 2 || (stat.mode & 0o077) !== 0)
        throw Error('upgrade-status-receipt-invalid');
      const value: unknown = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('upgrade-status-receipt-invalid');
      return value as Record<string, unknown>;
    } finally {
      fs.closeSync(descriptor);
    }
  };
  const operation = read(path.join(checkpoints, 'operation.json')),
    owner = read(path.join(state, '.gitlab-upgrade-lock/upgrade-owner.json'));
  return {
    phase: operation.phase || owner.phase || 'not-checkpointed',
    locked: !!owner.operation,
    checkpointSha256: operation.checkpointSha256 || owner.checkpointSha256,
    planSha256: owner.planSha256,
  };
}
