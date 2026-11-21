import fs from 'node:fs';
import path from 'node:path';
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
