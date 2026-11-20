import { Injectable } from '@nestjs/common';
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { RuntimeService } from '../runtime/runtime.service';
import {
  startBackupWorkflow,
  backupWorkflowStatus,
  backupWorkflowDownload,
} from '../BackupWorkflow';
import { tokenOverview } from '../TokenOverview';
import { operationFailed, SyncHttpError } from '../http/sync-http-error';

@Injectable()
export class OperationsService {
  constructor(private readonly runtime: RuntimeService) {}
  status() {
    return this.runtime.snapshot();
  }
  private ensureIdle() {
    if (this.runtime.operationBusy())
      throw new SyncHttpError(409, {
        message: 'Wait for the current platform operation to finish.',
      });
  }
  credentials() {
    this.ensureIdle();
    try {
      return tokenOverview();
    } catch {
      throw new SyncHttpError(409, {
        message:
          'Credential metadata is unavailable. Check monitoring settings and GitLab readiness.',
      });
    }
  }
  backup() {
    this.ensureIdle();
    this.runtime.status.harvestInProgress = true;
    try {
      return startBackupWorkflow(() => {
        this.runtime.status.harvestInProgress = false;
      });
    } catch {
      this.runtime.status.harvestInProgress = false;
      throw new SyncHttpError(409, {
        message:
          'The coordinated backup could not be started. Check backup storage and operation status.',
      });
    }
  }
  backupStatus(id: string) {
    try {
      return backupWorkflowStatus(id);
    } catch {
      throw new SyncHttpError(404, { message: 'Backup operation not found.' });
    }
  }
  backupDownload(id: string) {
    try {
      return backupWorkflowDownload(id);
    } catch {
      throw new SyncHttpError(409, {
        message: 'The matching configuration backup is not available for download.',
      });
    }
  }
  patch() {
    try {
      console.log('Stopping intermediate services...');
      const out = execFileSync(process.execPath, [
        path.resolve('../operations/dist/lifecycle/entry.js'),
        'refresh-source',
        path.resolve('..'),
      ]);
      this.runtime.status.needRestart = true;
      return {
        message: 'Repository updated.',
        status: this.runtime.status,
        output: out.toString(),
      };
    } catch {
      throw operationFailed();
    }
  }
  seed() {
    try {
      // The helper validates fresh storage and cold GitLab under its own lease.
      const out = execFileSync(
        process.execPath,
        [path.resolve('../operations/dist/storage/entry.js'), 'launch', 'restore'],
        { cwd: path.resolve('../system') },
      );
      this.runtime.status.needRestart = true;
      return {
        message: 'Seed has been applied. Restarting system.',
        status: this.runtime.status,
        output: out.toString(),
      };
    } catch {
      throw operationFailed();
    }
  }
  restart() {
    try {
      console.log('Stopping intermediate services...');
      const out = execFileSync(process.execPath, [
        path.resolve('../operations/dist/lifecycle/entry.js'),
        'stop-intermediate',
        path.resolve('..'),
      ]);
      return { message: 'Restarting system.', status: this.runtime.status, output: out.toString() };
    } catch {
      throw operationFailed();
    }
  }
  harvest() {
    this.runtime.status.harvestInProgress = true;
    return new Promise((resolve, reject) => {
      // Keep authenticated status and Fetch responsive while the helper copies.
      execFile(
        process.execPath,
        [path.resolve('../operations/dist/storage/entry.js'), 'launch', 'harvest'],
        { cwd: path.resolve('../system'), maxBuffer: 1024 * 1024 },
        (error, out) => {
          this.runtime.status.harvestInProgress = false;
          if (error) {
            reject(
              new SyncHttpError(500, {
                message:
                  'Harvest failed. Previous completed Seed remains available; check service restart and operation locks.',
              }),
            );
            return;
          }
          resolve({
            message: 'Harvesting complete.',
            status: this.runtime.status,
            output: out.toString(),
          });
        },
      );
    });
  }
  registerRunners() {
    this.runtime.status.runnerSetupInProgress = true;
    return new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.resolve('../operations/dist/lifecycle/entry.js'), 'runner-start', path.resolve('..')],
        { cwd: path.resolve('../gitlab-runner'), timeout: 900000 },
        (error, out) => {
          this.runtime.status.runnerSetupInProgress = false;
          if (error) {
            reject(
              new SyncHttpError(500, {
                message:
                  'Runner setup failed. Check GitLab readiness, version and runner configuration.',
              }),
            );
            return;
          }
          resolve({
            message: 'Runner registration completed.',
            status: this.runtime.status,
            output: out.toString(),
          });
        },
      );
    });
  }
  unregisterRunners() {
    try {
      const out = execFileSync(process.execPath, [
        path.resolve('../operations/dist/lifecycle/entry.js'),
        'runner-unregister',
        path.resolve('..'),
      ]);
      return {
        message: 'Runner unregistered.',
        status: this.runtime.status,
        output: out.toString(),
      };
    } catch {
      throw operationFailed();
    }
  }
}
