import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {configDirectory} from './StatePaths';
const native = require('../../system/coordinated-backup');
const active = new Set<string>();

/** Call only after authentication and ordinary operation-busy guards. */
export function startBackupWorkflow(onFinished: () => void = () => undefined): any {
  if (active.size || fs.existsSync(path.join(configDirectory(), '.storage-operation-lock'))) throw Error('storage-operation-busy');
  const id = crypto.randomBytes(16).toString('hex');
  const root = native.directory(configDirectory(), id);
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  native.writeStatus(root, {format: 'system-coordinated-backup-v1', id, state: 'working', phase: 'preflight',
    startedAt: new Date().toISOString(), seed: null, configuration: {status: 'pending'}});
  active.add(id);
  execFile(process.execPath, [path.resolve(__dirname, '../../system/seed-operation.js'), 'launch', 'harvest'],
    {env: {...process.env, SYSTEM_COORDINATED_BACKUP: id}, maxBuffer: 1024 * 1024, timeout: 3600000}, () => {
      active.delete(id);
      onFinished();
      try {
        const status = backupWorkflowStatus(id);
        if (['working', 'interrupted'].includes(status.state)) native.writeStatus(root, {...status, state: 'interrupted',
          phase: 'needs-inspection', error: 'backup-helper-completion-unconfirmed', configuration: {status: 'unavailable'}});
      } catch {
        // A removed/corrupt private checkpoint must not crash the control API.
      }
    });
  return backupWorkflowStatus(id);
}

export function backupWorkflowStatus(id: string): any {
  const root = native.directory(configDirectory(), id);
  const status = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8'));
  if (status.state === 'ready' && !status.helperCompletedAt) return {...status, state: active.has(id) ? 'working' : 'interrupted', phase: active.has(id) ? 'releasing-leases' : 'needs-inspection'};
  if (status.state === 'working' && !active.has(id)) return {...status, state: 'interrupted', phase: 'needs-inspection'};
  return status;
}

/** A response finish confirms transfer only; the browser must confirm saving. */
export function backupWorkflowDownload(id: string): {filename: string; sha256: string} {
  const status = backupWorkflowStatus(id);
  if (status.state !== 'ready' || status.configuration.status !== 'ready') throw Error('configuration-backup-unavailable');
  const filename = path.join(native.directory(configDirectory(), id), 'bootstrapper.zip');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') !== status.configuration.sha256)
    throw Error('configuration-backup-checksum-mismatch');
  return {filename, sha256: status.configuration.sha256};
}
