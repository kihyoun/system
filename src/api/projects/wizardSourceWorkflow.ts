import { wizardConfigPath } from '../../modules/configuration/statePaths';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  rails,
  readReceipt,
  writeReceipt,
  startJob,
  lookupJob,
  withProjectLock,
  validateProject,
} from '../../modules/project-workflow/projectWorkflow';
import { wizardCi } from './defaultWizard';

import * as snapshotModule from '../../modules/source-preparation/wizardSource.service';
import * as binding from '../../modules/project-lifecycle/sourcePrimaryBinding';
import { checkoutPath } from '../../common/runtime/installationPaths';
import { failureMessage } from '../../common/runtime/operationError';
import { sourceInitializationInput } from '../../modules/project-workflow/projectInputs';
import type { WizardWorkflow } from '../../modules/project-workflow/projectContracts';
const snapshotPath = checkoutPath('assets/wizard-source/snapshot.json');
const configPath = () => wizardConfigPath();
function context() {
  const content = fs.readFileSync(configPath(), 'utf8');
  const receipt = readReceipt(content);

  if (receipt?.repository?.managementMode === 'source-primary') {
    throw new Error(
      'The Wizard is developed directly in its source-primary repository. Source import is disabled.',
    );
  }

  if (
    !receipt?.defaultProject ||
    receipt.template !== 'wizard' ||
    receipt.state !== 'complete' ||
    !receipt.repository?.systemProject ||
    !receipt.repository.id ||
    !receipt.namespaceId ||
    !receipt.operation ||
    receipt.repository.ciPath !== '.system-bootstrapper/ci.yml' ||
    receipt.repository.generatedCi !== wizardCi()
  ) {
    throw new Error('Fetch the completed managed Wizard registration before initializing source.');
  }

  validateProject({
    projectKey: 'wizard',
    namespaceId: receipt.namespaceId,
    template: 'wizard',
    data: content,
    ci: wizardCi(),
  });

  if (!fs.existsSync(snapshotPath)) {
    throw new Error(
      'Wizard source snapshot is missing. Prepare the pinned source and rebuild the System image.',
    );
  }

  const snapshot = snapshotModule.validate(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
  const previous = receipt.wizardWorkflow;

  if (
    previous &&
    (previous.version !== 1 ||
      previous.manifestHash !== snapshot.manifestHash ||
      previous.sourceRevision !== snapshot.sourceRevision)
  ) {
    throw new Error(
      'A different Wizard source revision is already reserved. Source upgrades require a separate reviewed operation.',
    );
  }

  const reservedWorkflow = previous ? sourceReservation(previous) : undefined;

  return {
    content,
    data: content
      .split('\n')
      .filter((line) => !line.startsWith('# BOOTSTRAPPER_PROJECT='))
      .join('\n'),
    receipt,
    snapshot,
    reservedWorkflow,
  };
}
function sourceReservation(workflow: WizardWorkflow) {
  if (typeof workflow.operation !== 'string' || !workflow.operation) {
    throw new Error(
      'A different Wizard source revision is already reserved. Source upgrades require a separate reviewed operation.',
    );
  }

  return { ...workflow, operation: workflow.operation };
}
export function previewWizardSource() {
  const content = fs.readFileSync(configPath(), 'utf8');
  const currentReceipt = readReceipt(content);

  if (currentReceipt?.repository?.managementMode === 'source-primary') {
    binding.validate(binding.read(configPath()).receipt);
    return {
      mode: 'source-primary',
      sourceRevision: currentReceipt.wizardWorkflow?.sourceRevision,
      repository: currentReceipt.repository,
      workflow: currentReceipt.wizardWorkflow,
      canInitialize: false,
      message:
        'The Wizard already uses its canonical source repository. Develop through native merge requests; source import is disabled.',
    };
  }

  const { receipt, snapshot } = context();
  return {
    ...snapshotModule.sourceMetadata(snapshot),
    sourceRevision: snapshot.sourceRevision,
    manifestHash: snapshot.manifestHash,
    fileCount: snapshot.files.length,
    repository: receipt.repository,
    workflow: receipt.wizardWorkflow,
    message: 'Imports source only. Builds, Review and Production deployment remain disabled.',
  };
}
export function initializeWizardSource(input: unknown) {
  const { content, data, receipt, snapshot, reservedWorkflow } = context();
  const request = sourceInitializationInput(input);
  let expectedContent = content;
  const persist = () => {
    const lock = configPath() + '.environments.lock';
    fs.mkdirSync(lock, { mode: 0o700 });
    try {
      if (fs.readFileSync(configPath(), 'utf8') !== expectedContent) {
        throw new Error(
          'Wizard configuration changed during source initialization. Fetch and inspect before retrying.',
        );
      }

      writeReceipt(configPath(), data, receipt);
      expectedContent = fs.readFileSync(configPath(), 'utf8');
    } finally {
      fs.rmdirSync(lock);
    }
  };

  if (request.manifestHash !== snapshot.manifestHash) {
    throw new Error('Preview the current Wizard source before initialization.');
  }

  const workflow = reservedWorkflow || {
    version: 1,
    operation: crypto.randomBytes(24).toString('hex'),
    ...snapshotModule.sourceMetadata(snapshot),
    sourceRevision: snapshot.sourceRevision,
    manifestHash: snapshot.manifestHash,
    phase: 'pending',
  };
  const previous = lookupJob(workflow.operation);

  if (previous?.state === 'running') {
    return previous;
  }

  return withProjectLock(workflow.operation, () => {
    receipt.wizardWorkflow = { ...workflow, phase: 'pending', message: '' };
    persist();
    return startJob(workflow.operation, async () => {
      try {
        const result = await rails({
          action: 'wizard-source',
          projectKey: 'wizard',
          namespaceId: receipt.namespaceId,
          operation: receipt.operation,
          repository: receipt.repository,
          expectedCi: wizardCi(),
          snapshot,
        });

        if (result.state === 'failed') {
          throw new Error(result.message);
        }

        if (typeof result.importCommit !== 'string' || !result.importCommit) {
          throw new Error('Invalid GitLab operation response.');
        }

        receipt.wizardWorkflow = {
          ...workflow,
          phase: 'source-imported',
          importCommit: result.importCommit,
          message: '',
        };
        persist();
        return {
          repository: receipt.repository,
          workflow: receipt.wizardWorkflow,
          message:
            'Pinned Wizard source imported. The running interface and disabled CI are unchanged.',
        };
      } catch (error) {
        receipt.wizardWorkflow = { ...workflow, phase: 'failed', message: failureMessage(error) };
        persist();
        throw error;
      }
    });
  });
}
