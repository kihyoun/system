import {mainConfigPath, wizardConfigPath} from './StatePaths';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {rails, readReceipt, writeReceipt, startJob, lookupJob, withProjectLock, validateProject} from './ProjectBootstrap';
import {wizardCi, readSettings} from './DefaultWizard';
import Helper from './Helper';

const recipes = require('../../project-bootstrap/wizard-build/recipe');
const sourcePrimary = require('../../project-bootstrap/wizard-source-primary/binding');
const configPath = () => wizardConfigPath();
function context() {
  const content = fs.readFileSync(configPath(), 'utf8');
  const receipt = readReceipt(content);
  if (sourcePrimary.primary(receipt)) {
    if (sourcePrimary.read(configPath()).text !== content) throw new Error('Canonical Wizard configuration changed during inspection.');
    sourcePrimary.validate(receipt);
    const settings = readSettings(fs.readFileSync(mainConfigPath(), 'utf8'));
    const registry = new URL(settings.GITLAB_REGISTRY_URL);
    if (!['http:', 'https:'].includes(registry.protocol) || registry.username || registry.password || registry.pathname !== '/' || registry.search || registry.hash) throw new Error('Invalid local GitLab registry configuration.');
    if (Number(settings.GITLAB_REGISTRY_DOMAIN_MODE || 0) < 2) registry.port = '5050';
    return {content, data: content.split('\n').filter(line => !line.startsWith('# BOOTSTRAPPER_PROJECT=')).join('\n'), receipt,
      recipe: recipes.select(Helper.textLogo, receipt.wizardWorkflow.build.recipeHash), registryPrefix: registry.host + '/' + receipt.repository.path};
  }
  if (!receipt?.defaultProject || receipt.state !== 'complete' || receipt.template !== 'wizard' ||
    !receipt.repository?.systemProject || !receipt.repository.id || !receipt.namespaceId || !receipt.operation ||
    receipt.repository.ciPath !== '.system-bootstrapper/ci.yml' || receipt.repository.generatedCi !== wizardCi() ||
    receipt.wizardWorkflow?.version !== 1 || receipt.wizardWorkflow.phase !== 'source-imported' ||
    !/^[a-f0-9]{40}$/.test(receipt.wizardWorkflow.importCommit || '')) {
    throw new Error('Initialize the managed Wizard source before enabling its build pipeline.');
  }
  const data = content.split('\n').filter(line => !line.startsWith('# BOOTSTRAPPER_PROJECT=')).join('\n');
  validateProject({projectKey: 'wizard', namespaceId: receipt.namespaceId, template: 'wizard', data, ci: wizardCi()});
  const build = receipt.wizardWorkflow.build;
  const recipe = build ? recipes.select(Helper.textLogo, build.recipeHash) :
    recipes.forSource(Helper.textLogo, receipt.wizardWorkflow.sourceRevision);
  if (build && (build.version !== 1 || build.recipeHash !== recipe.recipeHash)) {
    throw new Error('A different build recipe is reserved. Use a reviewed versioned recipe upgrade.');
  }
  const settings = readSettings(fs.readFileSync(mainConfigPath(), 'utf8'));
  let registry;
  try { registry = new URL(settings.GITLAB_REGISTRY_URL); } catch (_) {
    throw new Error('Configure the local GitLab registry before enabling Wizard builds.');
  }
  if (!['http:', 'https:'].includes(registry.protocol) || registry.username || registry.password ||
    registry.pathname !== '/' || registry.search || registry.hash) {
    throw new Error('Invalid local GitLab registry configuration.');
  }
  // Keep artifact identity aligned with gitlab/start.sh and gitlab.rb: HTTP
  // registry modes advertise port 5050 even when the external proxy URL has no port.
  if (Number(settings.GITLAB_REGISTRY_DOMAIN_MODE || 0) < 2) { registry.port = '5050'; }
  return {content, data, receipt, recipe, registryPrefix: registry.host + '/' + receipt.repository.path};
}
const historicalMessage = 'Phase B evidence is historical while the environment CI migration owns the recipe. ' +
  'Use environment status for the current recipe; Phase B reactivation is disabled.';
function migrationOwnsCi(receipt: any) {
  const environment = receipt.wizardWorkflow.environments;
  return !!environment && (!!environment.activationCommit || environment.externalAttempted === true ||
    environment.phase === 'requires-reconciliation');
}
function historicalBuild(build: any) {
  return {...build, historical: true, historicalPhase: build.phase, phase: 'historical', message: historicalMessage};
}
export function previewWizardBuild() {
  const {receipt, recipe} = context();
  if (sourcePrimary.primary(receipt)) {
    return {version: 1, mode: 'source-primary', repository: receipt.repository, sourceRevision: receipt.wizardWorkflow.sourceRevision,
      build: receipt.wizardWorkflow.build,
      message: 'Develop and review in the canonical repository. Native pipeline status is read-only; source import and legacy activation are disabled.'};
  }
  const historical = migrationOwnsCi(receipt);
  return {version: recipe.version, recipeHash: recipe.recipeHash, sourceRevision: receipt.wizardWorkflow.sourceRevision,
    importCommit: receipt.wizardWorkflow.importCommit, repository: receipt.repository,
    build: historical ? historicalBuild(receipt.wizardWorkflow.build) : receipt.wizardWorkflow.build,
    message: historical ? historicalMessage :
      'Enables verified Wizard toolchain checks and candidate artifacts only; Production deployment remains disabled.'};
}
function operation(mode: 'activate' | 'status', input?: any) {
  const {content, data, receipt, recipe, registryPrefix} = context();
  if (sourcePrimary.primary(receipt)) {
    if (mode === 'activate') throw new Error('Source-primary Wizard builds run through native repository pipelines.');
    return withProjectLock('source-primary-' + receipt.repository.id, () => startJob('source-primary-' + receipt.repository.id, async () => {
      const result = await rails({action: 'wizard-source-primary-status', projectKey: 'wizard', namespaceId: receipt.namespaceId,
        operation: receipt.operation, repository: receipt.repository, sourcePrimary: receipt.sourcePrimary, build: receipt.wizardWorkflow.build, registryPrefix});
      if (result.state === 'failed') throw new Error(result.message);
      const lock = configPath() + '.environments.lock'; fs.mkdirSync(lock, {mode: 0o700});
      try {
        if (fs.readFileSync(configPath(), 'utf8') !== content) throw new Error('Canonical Wizard configuration changed while reading native pipeline status.');
        const next = {...receipt, wizardWorkflow: {...receipt.wizardWorkflow, sourceRevision: result.sourceRevision, build: result.build}};
        writeReceipt(configPath(), data, next);
      } finally { fs.rmdirSync(lock); }
      return {build: result.build, sourceRevision: result.sourceRevision, message: result.message};
    }));
  }
  if (migrationOwnsCi(receipt)) {
    if (mode === 'activate') {
      throw new Error('Environment CI migration owns the current recipe. Phase B build activation is disabled; refresh environment status instead.');
    }
    return {state: 'historical', build: historicalBuild(receipt.wizardWorkflow.build), message: historicalMessage};
  }
  let expectedContent = content;
  const persist = (nextReceipt: any) => {
    const lock = configPath() + '.environments.lock'; fs.mkdirSync(lock, {mode: 0o700});
    try {
      if (fs.readFileSync(configPath(), 'utf8') !== expectedContent) {
        throw new Error('Wizard configuration or receipt changed during the build operation. Fetch and inspect before retrying.');
      }
      writeReceipt(configPath(), data, nextReceipt);
      expectedContent = fs.readFileSync(configPath(), 'utf8');
    } finally { fs.rmdirSync(lock); }
  };
  const workflow = receipt.wizardWorkflow;
  if (mode === 'activate' && input?.recipeHash !== recipe.recipeHash) { throw new Error('Preview the current build recipe before activation.'); }
  if (mode === 'status' && !workflow.build) { return {state: 'not-activated', message: 'Build pipeline has not been enabled.'}; }
  const build = workflow.build || {version: 1, operation: crypto.randomBytes(24).toString('hex'), recipeHash: recipe.recipeHash, phase: 'pending'};
  const previous = lookupJob(build.operation);
  if (previous?.state === 'running') { return previous; }
  return withProjectLock(build.operation, () => {
    receipt.wizardWorkflow = {...workflow, build};
    persist(receipt);
    return startJob(build.operation, async () => {
      try {
        const result = await rails({action: mode === 'activate' ? 'wizard-build' : 'wizard-build-status',
          projectKey: 'wizard', namespaceId: receipt.namespaceId, operation: receipt.operation,
          repository: receipt.repository, workflow, build, expectedCi: wizardCi(), recipe, registryPrefix});
        if (result.state === 'failed') { throw new Error(result.message); }
        receipt.wizardWorkflow = {...workflow, build: {...build, ...result.build,
          message: result.build?.phase === 'requires-reconciliation' ? result.message : ''}};
        persist(receipt);
        return {build: receipt.wizardWorkflow.build, message: result.message};
      } catch (error) {
        const unverified = {...build, phase: 'verification-failed', message: error.message};
        delete unverified.artifact;
        receipt.wizardWorkflow = {...workflow, build: unverified};
        persist(receipt);
        throw error;
      }
    });
  });
}
export const activateWizardBuild = (input: any) => operation('activate', input);
export const refreshWizardBuild = () => operation('status');
