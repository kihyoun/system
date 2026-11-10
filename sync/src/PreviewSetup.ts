import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {configDirectory, mainConfigPath, wizardConfigPath} from './StatePaths';
import {rails, readReceipt, startJob, lookupJob, projectBusy, withProjectLock} from './ProjectBootstrap';
import {readSettings} from './DefaultWizard';
import {preflightWizardEnvironmentSettings, previewWizardEnvironments, configureWizardEnvironments} from './WizardEnvironments';
const native = require('../../project-bootstrap/preview-setup/settings');
const source = require('../../project-bootstrap/preview-setup/source');
const {Adoption} = require('../../project-bootstrap/wizard-source-primary/run');
const {StorageLease} = require('../../system/seed-operation');
const {validateProducers, approvedProducers} = require('../../project-bootstrap/preview-setup/producers');
const binding = require('../../project-bootstrap/wizard-source-primary/binding');
const {batchedReads} = require('../../project-bootstrap/preview-setup/reads');
const stateFile = () => path.join(configDirectory(), 'preview-setup.json');
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const environments = (settings: any) => Object.fromEntries(['review', 'beta'].map(name => [name, {enabled: settings[name].enabled, host: settings[name].host, domainMode: 2, ssl: settings[name].ssl, sslKey: settings[name].sslKey}]));
const sources = (settings: any) => [{...settings.wizard, kind: 'wizard', ciPath: '.gitlab/primary.yml'}, ...(settings.system ? [{...settings.system, kind: 'system', ciPath: '.gitlab-ci.yml'}] : [])];
function state() { return fs.existsSync(stateFile()) ? JSON.parse(fs.readFileSync(stateFile(), 'utf8')) : undefined; }
function persist(value: any) {
  const file = stateFile(), temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value), {mode: 0o600}); fs.renameSync(temporary, file);
}
function context(settings: any) {
  const main = fs.readFileSync(mainConfigPath(), 'utf8');
  const config = fs.readFileSync(wizardConfigPath(), 'utf8');
  const receipt = binding.read(wizardConfigPath()).receipt, platform = readSettings(main);
  if (binding.primary(receipt)) binding.validate(receipt);
  if (!receipt?.defaultProject || receipt.state !== 'complete' || receipt.template !== 'wizard' || !receipt.repository?.systemProject) throw Error('Complete General configuration and managed Wizard registration first.');
  const gitlab = new URL(platform.GITLAB_EXTERNAL_URL || 'https://' + platform.GITLAB_HOST);
  if (gitlab.protocol !== 'https:' || gitlab.host !== platform.GITLAB_HOST || gitlab.username || gitlab.password || gitlab.pathname !== '/' || !platform.GITLAB_REGISTRY_URL) throw Error('Configure TLS GitLab, its registry and runners before development previews.');
  const helper = process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE || '';
  if (!/^sha256:[a-f0-9]{64}$/.test(helper) || (process.env.SYSTEM_WIZARD_CANONICAL_CONTROLLER || 'system_bootstrapper_1') !== 'system_bootstrapper_1') throw Error('Provision the reviewed immutable System helper and canonical controller before preview setup.');
  if (receipt.repository.managementMode !== 'source-primary') {
    if (receipt.wizardWorkflow || receipt.repository.ciPath !== '.system-bootstrapper/ci.yml') throw Error('Existing managed source history requires its native adoption/upgrade path; initial setup never replaces it.');
    new Adoption({config: wizardConfigPath(), mainConfig: mainConfigPath(), request: async (): Promise<any> => undefined}).retainedInstallation(main);
  }
  const previous = state();
  if (previous && hash(JSON.stringify(previous.settings)) !== hash(JSON.stringify(settings))) throw Error('A different setup is already reserved. Inspect its recorded source projects before changing intent.');
  if (previous?.uncertain === true || previous?.phase === 'needs-inspection') throw Error('The recorded setup mutation has no confirmed completion. Inspect its exact operation and retained leases before resuming.');
  if (previous && previous.mainHash !== hash(main)) throw Error('Production configuration changed during setup. Inspect the saved operation before repairing it.');
  return {main, config, receipt, platform, gitlab, helper, previous,
    previewHash: hash(JSON.stringify({version: 1, main, config, settings, helper, previous}))};
}
function publicState(value: any) {
  if (!value) return {version: 1, phase: 'not-started'};
  return {version: 1, operation: value.operation, phase: value.phase, uncertain: value.uncertain === true, settings: value.settings, projects: value.projects,
    pipeline: value.pipeline, message: value.message, previewUrl: value.phase === 'ready' ? 'https://' + value.settings.review.host : undefined,
    deployment: 'Use the native manual Deploy/Stop jobs. Setup does not deploy a preview or promote Production.'};
}
export function previewSetupStatus() {
  const saved = state();
  let issue = '', inspectionRequired = saved?.uncertain === true || saved?.phase === 'needs-inspection', leaseOperation: string | undefined;
  if (saved) {
    try {
      const receipt = binding.read(wizardConfigPath()).receipt;
      if (saved.phase === 'ready' && (!binding.primary(receipt) || receipt.repository.id !== saved.projects?.wizard?.id || receipt.repository.path !== saved.projects?.wizard?.path)) issue = 'The configured canonical source binding is missing or stale. Run explicit preflight and inspect the native setup/repair path.';
    } catch (_) { issue = 'The configured canonical Wizard receipt is missing or invalid. Use explicit native setup/repair after inspecting ownership.'; }
  }
  try {
    const lease = JSON.parse(fs.readFileSync(path.join(configDirectory(), '.storage-operation-lock/operation.json'), 'utf8'));
    if (lease.helperName === 'wizard-preview-setup' && (!saved || lease.operation === saved.operation) && lease.completion === 'uncertain') {
      leaseOperation = lease.operation; inspectionRequired = true; issue = 'Setup mutation completion is unconfirmed. Inspect the exact recorded operation and retained leases before any resumption.';
    }
  } catch (_) { /* Ordinary read-only status also works without a live lease. */ }
  return {...publicState(saved), ...(leaseOperation ? {operation: leaseOperation} : {}), ...(issue ? {phase: inspectionRequired ? 'needs-inspection' : 'needs-attention', ...(inspectionRequired ? {uncertain: true} : {})} : {}), productionChanged: false, manualDeployment: true,
    message: issue || saved?.message || 'Optional development previews require ready GitLab, registry, runners, DNS and certificates. Importing saved settings never starts setup.'};
}
export async function preflightPreviewSetup(input: any) {
  if (!input || Object.keys(input).some(key => key !== 'settings')) throw Error('Provide desired preview settings only.');
  const settings = native.settings(input.settings), value = context(settings);
  await preflightWizardEnvironmentSettings(environments(settings));
  for (const selected of sources(settings)) if (selected.mode === 'import') await source.originPreflight(selected.origin);
  const operation = value.previous?.operation || hash(JSON.stringify({settings, initialConfig: value.config, main: value.main})).slice(0, 48);
  const result = await rails({action: 'preview-setup-preflight', namespace: settings.namespace, sources: sources(settings), operation});
  if (result.state === 'failed') throw Error(result.message);
  if (context(settings).previewHash !== value.previewHash) throw Error('Configuration changed during preflight. Review a fresh setup plan.');
  return {version: 1, settings, previewHash: value.previewHash, namespaceId: result.namespaceId, runnerReady: true,
    productionChanged: false, manualDeployment: true, message: 'DNS, exact-host certificates, source availability and runner access checked. Confirm setup to import source and start its native push pipeline. Builds and browser checks take additional time.'};
}
async function wait(job: any) {
  while (job.state === 'running') await new Promise(resolve => setTimeout(resolve, 100));
  if (job.state === 'failed') throw Object.assign(Error(job.message), {uncertain: job.uncertain === true, action: job.uncertainAction}); return job;
}
export function applyPreviewSetup(input: any) {
  if (!input || Object.keys(input).some(key => !['settings', 'previewHash'].includes(key))) throw Error('Confirm desired settings and their exact preflight hash.');
  const settings = native.settings(input.settings), value = context(settings);
  if (value.previewHash !== input.previewHash) throw Error('Run preflight again before confirming this setup.');
  const previousJob = value.previous && lookupJob(value.previous.operation);
  if (previousJob?.state === 'running') return previousJob;
  if (projectBusy()) throw Error('Another project operation is running. Wait and refresh setup.');
  if (['.storage-operation-lock', '.gitlab-upgrade-lock'].some(name => fs.existsSync(path.join(configDirectory(), name)))) throw Error('A storage, backup or GitLab upgrade operation is running. Wait before preview setup.');
  const operation = value.previous?.operation || hash(JSON.stringify({settings, initialConfig: value.config, main: value.main})).slice(0, 48);
  const lock = stateFile() + '.lock';
  try { fs.mkdirSync(lock, {mode: 0o700}); } catch (_) { throw Error('A setup operation owns its lock. Inspect the exact recorded operation after an interruption before clearing its lock.'); }
  const lockOwner = JSON.stringify({operation, pid: process.pid, startedAt: new Date().toISOString()});
  fs.writeFileSync(path.join(lock, 'owner.json'), lockOwner, {mode: 0o600, flag: 'wx'});
  const lockIdentity = fs.statSync(lock);
  let storage: any;
  try { storage = new StorageLease(configDirectory(), {helperName: 'wizard-preview-setup', imageId: value.helper, operation}); }
  catch (error) { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); throw error; }
  const storageOwner = fs.readFileSync(storage.owner, 'utf8'), storageIdentity = fs.statSync(storage.directory);
  const owned = (directory: string, identity: fs.Stats, owner: string, expected: string) => {
    try {
      const actual = fs.lstatSync(directory), file = fs.lstatSync(owner);
      return actual.isDirectory() && actual.dev === identity.dev && actual.ino === identity.ino &&
        file.isFile() && !file.isSymbolicLink() && fs.readFileSync(owner, 'utf8') === expected;
    } catch (_) { return false; }
  };
  const ownsStorage = () => owned(storage.directory, storageIdentity, storage.owner, storageOwner);
  const ownsPreview = () => owned(lock, lockIdentity, path.join(lock, 'owner.json'), lockOwner);
  return withProjectLock(operation, () => startJob(operation, async () => {
    let uncertain = false, uncertainAction: string | undefined;
    let current = value.previous || {version: 1, operation, settings, mainHash: hash(value.main), initialConfigHash: hash(value.config), phase: 'preflight', projects: {}};
    const save = (patch: any) => { current = {...current, ...patch}; persist(current); };
    const checked = async (data: any) => {
      try { const result = await rails(data); if (result.state === 'failed') throw Error(result.message); return result; }
      catch (error) { if (error.uncertain === true) { uncertain = true; uncertainAction = data.action; } throw error; }
    };
    const saveInspection = (patch: any) => {
      try { save(patch); } catch (error) { error.uncertain = true; error.action = uncertainAction; throw error; }
    };
    const inspection = () => ({reason: 'mutation-completion-unconfirmed', action: uncertainAction,
      storageOwnerHash: hash(storageOwner), previewOwnerHash: hash(lockOwner)});
    try {
      // This explicit action repeats every preflight before its first write.
      await preflightPreviewSetup({settings});
      save({phase: 'source-registration', message: ''});
      for (const selected of sources(settings)) {
        if (current.projects[selected.kind]) continue;
        const result = await checked({action: 'preview-setup-project', namespace: settings.namespace, operation, source: selected});
        const project = result.project;
        if (selected.mode === 'import') {
          try {
            await source.transfer({origin: selected.origin, destination: value.gitlab.origin + '/' + project.path_with_namespace + '.git', token: result.credential.token, approvedFiles: selected.kind === 'wizard' ? approvedProducers() : []});
          } catch (error) {
            // A failed revoke in finally must not replace an earlier lost push
            // completion witness and allow the shared storage lease to clear.
            if (error.uncertain === true) { uncertain = true; uncertainAction = error.action || 'preview-source-push'; }
            throw error;
          } finally {
            await checked({action: 'preview-setup-revoke', operation, projectId: project.id, tokenId: result.credential.id});
          }
        }
        // Only fresh own-instance IDs are retained, outside portable intent.
        save({projects: {...current.projects, [selected.kind]: {id: project.id, path: project.path_with_namespace, namespaceId: project.namespace.id}}});
      }
      const projects: any[] = Object.values(current.projects);
      const request = batchedReads(async (routes: string[]) => (await checked({action: 'preview-setup-read-many', routes,
        projectIds: [...projects.map(project => project.id), value.receipt.repository.id]})).values);
      const selected = current.projects.wizard;
      // Resolve dependent native reads in one bounded, read-only Rails call.
      // This context belongs only to this apply; adoption still reads afresh.
      const {project, branch, pipeline: nativePipeline, jobs, trees} = await checked({action: 'preview-setup-source-context',
        projectId: selected.id, projectIds: [...projects.map(project => project.id), value.receipt.repository.id]});
      const pipeline = nativePipeline ?? undefined;
      const commit = branch.commit.id;
      if (!pipeline || !['success', 'failed'].includes(pipeline.status)) {
        save({phase: 'waiting-build', pipeline: pipeline && {id: pipeline.id, status: pipeline.status, webUrl: pipeline.web_url}, message: 'Wait for the current native default-branch push pipeline, then run preflight and resume. Existing projects require a normal source push; setup never fabricates a successful pipeline.'});
        return publicState(current);
      }
      binding.pipelineChecks({...pipeline, ref: project.default_branch}, jobs);
      const buildJob = jobs.find((job: any) => job.name === 'build:wizard');
      if (!Array.isArray(trees) || trees.length !== 2 || trees.some(rows => !Array.isArray(rows) || rows.length >= 100))
        throw Error('The approved CI manifest is too large. Review it through the native source-primary tool.');
      const blobs = trees.flat().filter((row: any) => row.type === 'blob');
      // Job validation above must finish before any artifact is requested.
      const [artifact, ciFiles]: [any, any[]] = await Promise.all([
        request('projects/' + selected.id + '/jobs/' + buildJob.id + '/artifacts/build-evidence.json'),
        Promise.all(blobs.map(async (row: any) => {
          const file = await request('projects/' + selected.id + '/repository/files/' + encodeURIComponent(row.path) + '?ref=' + commit);
          return {path: row.path, sha256: hash(Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8'))};
        }))
      ]);
      ciFiles.sort((a, b) => a.path.localeCompare(b.path));
      validateProducers(ciFiles);
      const canonical = readReceipt(fs.readFileSync(wizardConfigPath(), 'utf8'));
      if (canonical.repository.managementMode !== 'source-primary') {
        if (hash(fs.readFileSync(wizardConfigPath(), 'utf8')) !== current.initialConfigHash) throw Error('Managed Wizard registration changed during setup. Preserve operator edits and inspect before repair.');
        const adoption = new Adoption({config: wizardConfigPath(), mainConfig: mainConfigPath(), directory: path.join(configDirectory(), 'wizard-source-primary'), request});
        const adoptionInput = {version: 1, action: 'bootstrap-previews', buildProfile: 'node24-vite8-quickstart-v5', projectId: selected.id, projectPath: selected.path,
          namespaceId: selected.namespaceId, defaultBranch: project.default_branch, pipelineId: pipeline.id, sourceCommit: commit, imageRef: artifact.imageRef, helperImage: value.helper, ciFiles};
        save({phase: 'binding', pipeline: {id: pipeline.id, status: pipeline.status, webUrl: pipeline.web_url}});
        const plan = await adoption.plan(adoptionInput); await adoption.apply(adoptionInput, plan.planHash);
      } else if (canonical.repository.id !== selected.id || canonical.repository.path !== selected.path) throw Error('A different canonical Wizard source was adopted. Reconcile the selected setup.');
      // Reuse native evidence and environment guards, including singleton Review
      // lease, generation floors and exact server-owned immutable helper identity.
      const envPreview = previewWizardEnvironments();
      if (envPreview.capabilities.canUpdate || envPreview.capabilities.canActivate) {
        save({phase: 'environments'});
        await wait(configureWizardEnvironments({previewHash: envPreview.previewHash, settings: environments(settings)}, operation));
      } else if (envPreview.environments?.phase !== 'ready' || JSON.stringify(envPreview.settings) !== JSON.stringify(environments(settings))) throw Error(envPreview.capabilities.reasons[0] || 'The canonical environment binding needs native repair.');
      if (current.projects.system) await checked({action: 'preview-setup-system', projectId: current.projects.system.id, projectPath: current.projects.system.path,
        namespaceId: current.projects.system.namespaceId, reviewHost: settings.review.host});
      if (fs.readFileSync(mainConfigPath(), 'utf8') !== value.main) throw Error('Production configuration changed during setup. Inspect before continuing.');
      save({phase: 'ready', message: 'Canonical Review/Beta setup is ready. Use the native manual deploy and stop jobs after successful candidate checks. Production retains its accepted public release.'});
      return publicState(current);
    } catch (error) {
      uncertain = uncertain || error.uncertain === true;
      uncertainAction = uncertainAction || error.action;
      if (uncertain) error.uncertain = true;
      (uncertain ? saveInspection : save)({phase: uncertain ? 'needs-inspection' : 'needs-attention', uncertain, message: uncertain
        ? 'Setup mutation completion is unconfirmed. Its exact live-state and preview leases remain held. Inspect the recorded operation before any resumption or targeted recovery.'
        : error.message, ...(uncertain ? {inspection: inspection()} : {})});
      throw error;
    } finally {
      // Never rewrite or remove a lease whose identity changed. A Docker-client
      // timeout can leave Rails running; process completion is then an operator
      // inspection boundary, not an ordinary automatically resumable failure.
      const storageOwned = ownsStorage(), previewOwned = ownsPreview();
      if (!storageOwned || !previewOwned) {
        if (storageOwned) storage.release(false);
        saveInspection({phase: 'needs-inspection', uncertain: true, inspection: inspection(), message: 'Setup lease ownership changed. No replacement lease was cleared; inspect the exact recorded operation.'});
        throw Object.assign(Error('Setup lease ownership changed; inspection is required.'), {uncertain: true});
      }
      try { storage.release(!uncertain); }
      catch (error) {
        saveInspection({phase: 'needs-inspection', uncertain: true, inspection: inspection(), message: 'Setup lease cleanup could not be confirmed. Inspect the exact recorded operation; its preview lease was retained.'});
        throw Object.assign(error, {uncertain: true});
      }
      if (!uncertain) { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); }
    }
  }));
}
