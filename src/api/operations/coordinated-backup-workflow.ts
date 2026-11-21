import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { configDirectory } from '../config/state-paths';
import * as native from '../../modules/storage/coordinated-backup';
import { checkoutRoot, cliArguments } from '../../common/runtime/installation-paths';
const active = new Set<string>();
function operationDirectory(id: string): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw Error('invalid-backup-operation');
  const parent = path.resolve(configDirectory(), '.coordinated-backups');
  const root = path.resolve(parent, path.basename(id));
  if (
    path.dirname(root) !== parent ||
    fs.lstatSync(parent).isSymbolicLink() ||
    fs.lstatSync(root).isSymbolicLink()
  )
    throw Error('unsafe-backup-directory');
  return root;
}

/** Call only after authentication and ordinary operation-busy guards. */
export function startBackupWorkflow(onFinished: () => void = () => undefined): any {
  if (active.size || fs.existsSync(path.join(configDirectory(), '.storage-operation-lock')))
    throw Error('storage-operation-busy');
  const id = crypto.randomBytes(16).toString('hex');
  const root = native.directory(configDirectory(), id);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  native.writeStatus(root, {
    format: 'system-coordinated-backup-v1',
    id,
    state: 'working',
    phase: 'preflight',
    startedAt: new Date().toISOString(),
    seed: null,
    configuration: { status: 'pending' },
  });
  active.add(id);
  execFile(
    process.execPath,
    cliArguments('storage', ['launch', 'harvest']),
    {
      cwd: checkoutRoot(),
      env: { ...process.env, SYSTEM_COORDINATED_BACKUP: id },
      maxBuffer: 1024 * 1024,
      timeout: 3600000,
    },
    () => {
      active.delete(id);
      onFinished();
      try {
        const status = backupWorkflowStatus(id);
        if (['working', 'interrupted'].includes(status.state))
          native.writeStatus(root, {
            ...status,
            state: 'interrupted',
            phase: 'needs-inspection',
            error: 'backup-helper-completion-unconfirmed',
            configuration: { status: 'unavailable' },
          });
      } catch {
        // A removed/corrupt private checkpoint must not crash the control API.
      }
    },
  );
  return backupWorkflowStatus(id);
}

export function backupWorkflowStatus(id: string): any {
  const root = operationDirectory(id);
  const status = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8'));
  if (status.state === 'ready' && !status.helperCompletedAt)
    return {
      ...status,
      state: active.has(id) ? 'working' : 'interrupted',
      phase: active.has(id) ? 'releasing-leases' : 'needs-inspection',
    };
  if (status.state === 'working' && !active.has(id))
    return { ...status, state: 'interrupted', phase: 'needs-inspection' };
  return status;
}

/** A response finish confirms transfer only; the browser must confirm saving. */
export function backupWorkflowDownload(id: string): {
  filename: string;
  sha256: string;
  bytes: Buffer;
} {
  const status = backupWorkflowStatus(id);
  if (status.state !== 'ready' || status.configuration.status !== 'ready')
    throw Error('configuration-backup-unavailable');
  const filename = path.join(operationDirectory(id), 'bootstrapper.zip');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 50 * 1024 * 1024)
      throw Error('configuration-backup-checksum-mismatch');
    const bytes = fs.readFileSync(descriptor);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== status.configuration.sha256)
      throw Error('configuration-backup-checksum-mismatch');
    return { filename, sha256: status.configuration.sha256, bytes };
  } finally {
    fs.closeSync(descriptor);
  }
}
