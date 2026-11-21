import { Injectable } from '@nestjs/common';
import { execFile, execFileSync } from 'node:child_process';
import { checkoutRoot, cliArguments } from '../../common/runtime/installation-paths';
import { RuntimeService } from '../runtime/runtime.service';
import {
  startBackupWorkflow,
  backupWorkflowStatus,
  backupWorkflowDownload,
} from './coordinated-backup-workflow';
import { tokenOverview } from './token-overview';
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
      const out = execFileSync(
        process.execPath,
        cliArguments('lifecycle', ['refresh-source', checkoutRoot()]),
        { cwd: checkoutRoot() },
      );
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
      const out = execFileSync(process.execPath, cliArguments('storage', ['launch', 'restore']), {
        cwd: checkoutRoot(),
      });
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
      const out = execFileSync(
        process.execPath,
        cliArguments('lifecycle', ['stop-intermediate', checkoutRoot()]),
        { cwd: checkoutRoot() },
      );
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
        cliArguments('storage', ['launch', 'harvest']),
        { cwd: checkoutRoot(), maxBuffer: 1024 * 1024 },
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
        cliArguments('lifecycle', ['runner-start', checkoutRoot()]),
        { cwd: checkoutRoot(), timeout: 900000 },
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
      const out = execFileSync(
        process.execPath,
        cliArguments('lifecycle', ['runner-unregister', checkoutRoot()]),
        { cwd: checkoutRoot() },
      );
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
