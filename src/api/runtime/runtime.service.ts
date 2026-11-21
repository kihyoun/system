import { failureMessage } from '../../common/runtime/operation-error';
import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { wizardConfigPath } from '../config/state-paths';
import { projectBusy } from '../projects/project-workflow';
import { ensureDefaultWizard } from '../projects/default-wizard';

@Injectable()
export class RuntimeService {
  readonly status = {
    needRestart: false,
    runnerSetupInProgress: false,
    harvestInProgress: false,
    defaultWizardSetupInProgress: false,
    defaultWizardProject: { state: 'not-started', message: '' },
  };
  private started = false;

  environmentHelperBusy() {
    return fs.existsSync(wizardConfigPath() + '.environments.lock');
  }

  storageOperationBusy() {
    return fs.existsSync(
      path.join(process.env.SYSTEM_CONFIG_DIR || '/state', '.storage-operation-lock'),
    );
  }

  upgradeBusy() {
    return fs.existsSync(
      path.join(process.env.SYSTEM_CONFIG_DIR || '/state', '.gitlab-upgrade-lock'),
    );
  }

  operationBusy() {
    return (
      this.storageOperationBusy() ||
      this.status.harvestInProgress ||
      this.status.runnerSetupInProgress ||
      this.status.defaultWizardSetupInProgress ||
      projectBusy() ||
      this.environmentHelperBusy()
    );
  }

  snapshot() {
    return { ...this.status, projectOperationInProgress: projectBusy() };
  }

  /** Start registration only after the listening socket makes the interface available. */
  startDefaultWizard() {
    if (this.started) return;
    this.started = true;
    this.status.defaultWizardSetupInProgress = true;
    void ensureDefaultWizard()
      .then((result) => {
        this.status.defaultWizardProject = { state: result.state, message: '' };
        console.log('System Wizard project: ' + result.state);
      })
      .catch((error) => {
        this.status.defaultWizardProject = { state: 'failed', message: failureMessage(error) };
        console.error(
          'System Wizard registration failed: ' +
            failureMessage(error) +
            ' The existing interface remains available; restart to retry.',
        );
      })
      .finally(() => {
        this.status.defaultWizardSetupInProgress = false;
      });
  }

  restartAfterResponse(response: Response) {
    response.once('finish', () =>
      setImmediate(() => {
        console.log('Restarting System...');
        process.exit(0);
      }),
    );
  }
}
