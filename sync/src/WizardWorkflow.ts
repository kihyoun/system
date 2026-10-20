import {wizardConfigPath} from './StatePaths';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {rails, readReceipt, writeReceipt, startJob, lookupJob, withProjectLock, validateProject} from './ProjectBootstrap';
import {wizardCi} from './DefaultWizard';

const snapshotModule = require('../../project-bootstrap/wizard-source/package');
const snapshotPath = path.resolve(__dirname, '../../project-bootstrap/wizard-source/snapshot.json');
const configPath = () => wizardConfigPath();
function context() {
  const content = fs.readFileSync(configPath(), 'utf8');
  const receipt = readReceipt(content);
  if (receipt?.repository?.managementMode === 'source-primary') {
    throw new Error('The Wizard is developed directly in its source-primary repository. Source import is disabled.');
  }
  if (!receipt?.defaultProject || receipt.template !== 'wizard' || receipt.state !== 'complete' ||
    !receipt.repository?.systemProject || !receipt.repository.id || !receipt.namespaceId || !receipt.operation ||
    receipt.repository.ciPath !== '.system-bootstrapper/ci.yml' || receipt.repository.generatedCi !== wizardCi()) {
    throw new Error('Fetch the completed managed Wizard registration before initializing source.');
  }
  validateProject({projectKey: 'wizard', namespaceId: receipt.namespaceId, template: 'wizard', data: content, ci: wizardCi()});
  if (!fs.existsSync(snapshotPath)) { throw new Error('Wizard source snapshot is missing. Prepare the pinned source and rebuild the System image.'); }
  const snapshot = snapshotModule.validate(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
  const previous = receipt.wizardWorkflow;
  if (previous && (previous.version !== 1 || previous.manifestHash !== snapshot.manifestHash || previous.sourceRevision !== snapshot.sourceRevision)) {
    throw new Error('A different Wizard source revision is already reserved. Source upgrades require a separate reviewed operation.');
  }
  return {content, data: content.split('\n').filter((line) => !line.startsWith('# BOOTSTRAPPER_PROJECT=')).join('\n'), receipt, snapshot};
}
export function previewWizardSource() {
  const content = fs.readFileSync(configPath(), 'utf8');
  const currentReceipt = readReceipt(content);
  if (currentReceipt?.repository?.managementMode === 'source-primary') {
    const binding = require('../../project-bootstrap/wizard-source-primary/binding');
    binding.validate(binding.read(configPath()).receipt);
    return {mode: 'source-primary', sourceRevision: currentReceipt.wizardWorkflow.sourceRevision, repository: currentReceipt.repository,
      workflow: currentReceipt.wizardWorkflow, canInitialize: false,
      message: 'The Wizard already uses its canonical source repository. Develop through native merge requests; source import is disabled.'};
  }
  const {receipt, snapshot} = context();
  return {sourceRevision: snapshot.sourceRevision, manifestHash: snapshot.manifestHash,
    fileCount: snapshot.files.length, repository: receipt.repository,
    workflow: receipt.wizardWorkflow, message: 'Imports source only. Builds, Review and Production deployment remain disabled.'};
}
export function initializeWizardSource(input: any) {
  const {content, data, receipt, snapshot} = context();
  let expectedContent = content;
  const persist = () => {
    const lock = configPath() + '.environments.lock'; fs.mkdirSync(lock, {mode: 0o700});
    try {
      if (fs.readFileSync(configPath(), 'utf8') !== expectedContent) throw new Error('Wizard configuration changed during source initialization. Fetch and inspect before retrying.');
      writeReceipt(configPath(), data, receipt); expectedContent = fs.readFileSync(configPath(), 'utf8');
    } finally { fs.rmdirSync(lock); }
  };
  if (input?.manifestHash !== snapshot.manifestHash) { throw new Error('Preview the current Wizard source before initialization.'); }
  const workflow = receipt.wizardWorkflow || {version: 1, operation: crypto.randomBytes(24).toString('hex'),
    sourceRevision: snapshot.sourceRevision, manifestHash: snapshot.manifestHash, phase: 'pending'};
  const previous = lookupJob(workflow.operation);
  if (previous?.state === 'running') { return previous; }
  return withProjectLock(workflow.operation, () => {
    receipt.wizardWorkflow = {...workflow, phase: 'pending', message: ''};
    persist();
    return startJob(workflow.operation, async () => {
      try {
        const result = await rails({action: 'wizard-source', projectKey: 'wizard', namespaceId: receipt.namespaceId,
          operation: receipt.operation, repository: receipt.repository, expectedCi: wizardCi(), snapshot});
        if (result.state === 'failed') { throw new Error(result.message); }
        receipt.wizardWorkflow = {...workflow, phase: 'source-imported', importCommit: result.importCommit, message: ''};
        persist();
        return {repository: receipt.repository, workflow: receipt.wizardWorkflow,
          message: 'Pinned Wizard source imported. The running interface and disabled CI are unchanged.'};
      } catch (error) {
        receipt.wizardWorkflow = {...workflow, phase: 'failed', message: error.message};
        persist();
        throw error;
      }
    });
  });
}
