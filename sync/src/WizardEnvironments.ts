import {mainConfigPath, wizardConfigPath} from './StatePaths';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dns from 'dns/promises';
import {rails, readReceipt, writeReceipt, startJob, lookupJob, withProjectLock, validateProject} from './ProjectBootstrap';
import {wizardCi, readSettings, wizardConfiguration} from './DefaultWizard';
import Helper from './Helper';

const legacyRecipes = require('../../project-bootstrap/wizard-build/recipe');
const configPath = () => wizardConfigPath();
const mainPath = () => mainConfigPath();
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const environments = ['review', 'beta'] as const;
let preparing: {operation: string, previewHash: string, settingsHash: string} | undefined;
const safeController = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/.test(value);
const imageId = (value: string) => /^sha256:[a-f0-9]{64}$/.test(value || '');

export const environmentAdapters = {
  resolve: async (host: string): Promise<string[]> => (await dns.lookup(host, {all: true})).map(row => row.address),
  certificate: async (host: string, certificate: string, key: string) => {
    const certFile = fs.realpathSync(certificate);
    const keyFile = fs.realpathSync(key);
    if (!certFile.startsWith('/ssl/') || !keyFile.startsWith('/ssl/') || !fs.statSync(keyFile).isFile()) {
      throw new Error('Use certificate and key files from the platform SSL volume.');
    }
    const cert = new crypto.X509Certificate(fs.readFileSync(certFile));
    const privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile));
    if (!cert.checkPrivateKey(privateKey)) { throw new Error('The environment certificate and private key do not match.'); }
    if (cert.checkHost(host, {subject: 'never', wildcards: false}) !== host ||
      Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) {
      throw new Error('An enabled environment requires a valid certificate for its exact HTTPS host.');
    }
  },
  recipe: (logo: string, input: any): any => require('../../project-bootstrap/wizard-environments/recipe').generate(logo, input)
};

function canonicalSettings(input: any, platform: any): any {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !environments.includes(key as any))) {
    throw new Error('Provide explicit Review and Beta environment settings.');
  }
  const selected: any = {};
  for (const name of environments) {
    const value = input[name];
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['enabled', 'host', 'domainMode', 'ssl', 'sslKey'].includes(key)) ||
      typeof value.enabled !== 'boolean' || value.domainMode !== 2 || typeof value.host !== 'string' ||
      typeof value.ssl !== 'string' || typeof value.sslKey !== 'string') {
      throw new Error('Review and Beta require enabled, exact host, HTTPS domainMode 2, certificate and key settings.');
    }
    const host = value.host.toLowerCase();
    if ((value.enabled || host) && (host.length > 253 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host))) {
      throw new Error('Configure an exact DNS hostname for each optional environment.');
    }
    const validPath = (file: string) => /^\/ssl\/[A-Za-z0-9_./-]+$/.test(file) &&
      !file.split('/').includes('..') && !file.endsWith('/');
    if (((value.enabled || value.ssl) && !validPath(value.ssl)) ||
      ((value.enabled || value.sslKey) && !validPath(value.sslKey)) ||
      (value.ssl && value.ssl === value.sslKey)) {
      throw new Error('Use distinct absolute certificate and key paths within /ssl.');
    }
    selected[name] = {enabled: value.enabled, host, domainMode: 2, ssl: value.ssl, sslKey: value.sslKey};
    if (value.enabled && Object.entries(platform).some(([key, hostValue]) => key.endsWith('_HOST') &&
      typeof hostValue === 'string' && hostValue.toLowerCase() === host)) {
      throw new Error('An environment host conflicts with an existing platform service.');
    }
  }
  if (selected.review.enabled && selected.beta.enabled && selected.review.host === selected.beta.host) {
    throw new Error('Review and Beta must use different HTTPS hosts.');
  }
  const directory = path.dirname(configPath());
  if (fs.existsSync(directory)) {
    for (const filename of fs.readdirSync(directory)) {
      if (filename === '.wizard.env' || !filename.endsWith('.env')) { continue; }
      const settings = readSettings(fs.readFileSync(path.join(directory, filename), 'utf8'));
      for (const name of environments) {
        if (!selected[name].enabled) { continue; }
        for (const environment of ['PROD', 'BETA', 'REVIEW']) {
          if (settings['USE_' + environment + '_HOST'] === 'true' &&
            settings[environment + '_HOST']?.toLowerCase() === selected[name].host) {
            throw new Error('An environment host is already assigned to another project.');
          }
        }
      }
    }
  }
  return selected;
}

function defaults(settings: any) {
  const host = settings.WIZARD_HOST || '';
  const result: any = {};
  for (const name of environments) {
    const hostname = name + '.' + host;
    result[name] = {enabled: false, host: hostname, domainMode: 2,
      ssl: '/ssl/live/' + hostname + '/fullchain.pem', sslKey: '/ssl/live/' + hostname + '/privkey.pem'};
  }
  return result;
}
function hasDeployments(value: any): boolean {
  return environments.some(name => !!value?.deployments?.[name]?.active || !!value?.deployments?.[name]?.pending);
}
function context() {
  const content = fs.readFileSync(configPath(), 'utf8');
  const receipt = readReceipt(content);
  if (!receipt?.defaultProject || receipt.template !== 'wizard' || receipt.state !== 'complete' ||
    !receipt.repository?.systemProject || !receipt.repository.id || !receipt.namespaceId || !receipt.operation ||
    receipt.repository.ciPath !== '.system-bootstrapper/ci.yml' || receipt.repository.generatedCi !== wizardCi() ||
    receipt.wizardWorkflow?.version !== 1 || receipt.wizardWorkflow.phase !== 'source-imported' ||
    !/^[a-f0-9]{40}$/.test(receipt.wizardWorkflow.importCommit || '')) {
    throw new Error('Initialize the managed Wizard source before configuring Review and Beta.');
  }
  validateProject({projectKey: 'wizard', namespaceId: receipt.namespaceId, template: 'wizard', data: content, ci: wizardCi()});
  const mainContent = fs.readFileSync(mainPath(), 'utf8');
  const platform = readSettings(mainContent);
  const current = receipt.wizardWorkflow.environments;
  const settings = canonicalSettings(current?.settings || defaults(platform), platform);
  const settingsHash = digest(JSON.stringify(settings));
  if (current && (current.version !== 1 || current.settingsHash !== settingsHash || !imageId(current.helperImage) ||
    !safeController(current.controller || '') || !/^[a-f0-9]{48}$/.test(current.operation || ''))) {
    throw new Error('The environment reservation changed. Inspect the server-owned receipt before continuing.');
  }
  const helperImage = process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE || '';
  const controller = process.env.SYSTEM_WIZARD_CANONICAL_CONTROLLER || 'system_bootstrapper_1';
  const legacyRecipe = legacyRecipes.generate(Helper.textLogo);
  const build = receipt.wizardWorkflow.build;
  let registry: URL;
  try { registry = new URL(platform.GITLAB_REGISTRY_URL); }
  catch (_) { throw new Error('Configure the local GitLab registry before enabling environments.'); }
  if (!['http:', 'https:'].includes(registry.protocol) || registry.username || registry.password ||
    registry.pathname !== '/' || registry.search || registry.hash) {
    throw new Error('Invalid local GitLab registry configuration.');
  }
  if (Number(platform.GITLAB_REGISTRY_DOMAIN_MODE || 0) < 2) { registry.port = '5050'; }
  const registryPrefix = registry.host + '/' + receipt.repository.path;
  const artifact = build?.artifact;
  const expectedRef = registryPrefix + '@sha256:';
  const initialVerified = build?.version === 1 && build.recipeHash === legacyRecipe.recipeHash &&
    build.phase === 'candidate-verified' && /^[a-f0-9]{40}$/.test(build.activationCommit || '') &&
    build.pipeline?.status === 'success' && build.pipeline.sha === build.activationCommit &&
    artifact?.sourceCommit === build.activationCommit && artifact.pipelineId === build.pipeline.id &&
    typeof artifact.imageRef === 'string' && artifact.imageRef.startsWith(expectedRef) &&
    /^[a-f0-9]{64}$/.test(artifact.imageRef.slice(expectedRef.length));
  const reasons: string[] = [];
  if (!current && !initialVerified) { reasons.push('Verify the Phase B candidate before enabling environments.'); }
  if (!imageId(helperImage)) { reasons.push('The operator must configure an immutable clean System helper image ID.'); }
  if (!safeController(controller)) { reasons.push('The canonical System controller is not configured safely.'); }
  if (current?.phase === 'requires-reconciliation') { reasons.push('Reconcile the recorded environment operation before another activation.'); }
  const canUpdate = !!current && current.phase === 'ready' && !hasDeployments(current);
  if (hasDeployments(current)) { reasons.push('Stop all active or pending Review and Beta deployments before changing settings.'); }
  const previewHash = digest(JSON.stringify({version: 1, content, mainContent, helperImage, controller}));
  return {content, receipt, mainContent, platform, current, settings, settingsHash, helperImage,
    controller, legacyRecipe, registryPrefix, initialVerified, reasons, canUpdate, previewHash};
}
export function previewWizardEnvironments() {
  const value = context();
  return {version: 1, previewHash: value.previewHash, settingsHash: value.settingsHash, settings: value.settings,
    environments: value.current, repository: value.receipt.repository,
    capabilities: {canActivate: value.reasons.length === 0 && (!value.current || value.current.phase !== 'ready'),
      canUpdate: value.reasons.length === 0 && value.canUpdate, reasons: value.reasons,
      reviewLease: 'single-active-mr', manualJobsOnly: true, productionDeployment: false},
    message: 'Review uses one explicitly leased HTTPS host shared over time. Another merge request cannot overwrite its owner. Review and Beta deploy and stop only through manual GitLab jobs; Production is unchanged.'};
}

async function preflight(settings: any, platform: any) {
  const enabled = environments.some(name => settings[name].enabled);
  let expected: string[] = [];
  if (enabled) {
    try { expected = await environmentAdapters.resolve(platform.WIZARD_HOST || ''); }
    catch (_) { throw new Error('Verify public DNS for the existing Production Wizard host before enabling environments.'); }
    if (!expected.length) { throw new Error('The existing Production Wizard host has no public DNS addresses.'); }
  }
  for (const name of environments) {
    const value = settings[name];
    if (!value.enabled) { continue; }
    try {
      const addresses = await environmentAdapters.resolve(value.host);
      if (!addresses.length || addresses.some(address => !expected.includes(address))) {
        throw new Error('DNS does not resolve exclusively to the configured Bootstrapper IP.');
      }
      await environmentAdapters.certificate(value.host, value.ssl, value.sslKey);
    } catch (_) {
      throw new Error('Validate DNS and the exact-host HTTPS certificate/key for ' + name + ' before activation.');
    }
  }
}
function recipeFor(environments: any) {
  return environmentAdapters.recipe(Helper.textLogo, {settings: environments.settings, settingsHash: environments.settingsHash,
    helperImage: environments.helperImage, operation: environments.operation, controller: environments.controller});
}
function withoutDeployments(content: string) {
  const receipt = readReceipt(content);
  if (receipt?.wizardWorkflow?.environments) { delete receipt.wizardWorkflow.environments.deployments; }
  const data = content.split('\n').filter(line => !line.startsWith('# BOOTSTRAPPER_PROJECT=')).join('\n');
  return {data, receipt};
}
function operation(mode: 'activate' | 'status', input?: any) {
  if (mode === 'activate' && (!input || Object.keys(input).some(key => !['previewHash', 'settings'].includes(key)))) {
    throw new Error('Confirm only previewHash and environment settings; helper identity is server-owned.');
  }
  const value = context();
  const selected = mode === 'activate' ? canonicalSettings(input?.settings, value.platform) : value.settings;
  const selectedHash = digest(JSON.stringify(selected));
  const preparingJob = preparing && lookupJob(preparing.operation);
  if (preparingJob?.state === 'running') {
    if (mode === 'activate' && (selectedHash !== preparing.settingsHash ||
      ![preparing.previewHash, value.previewHash].includes(input?.previewHash))) {
      throw new Error('The active environment preparation has different settings or a stale preview.');
    }
    return preparingJob;
  }
  const previousJob = value.current && lookupJob(value.current.operation);
  if (previousJob?.state === 'running') {
    if (mode === 'activate' && selectedHash !== value.current.settingsHash) { throw new Error('The active environment reservation has different settings.'); }
    return previousJob;
  }
  if (mode === 'status' && !value.current) {
    return {state: 'not-activated', message: 'Review and Beta have not been configured.'};
  }
  if (mode === 'activate') {
    if (input?.previewHash !== value.previewHash) { throw new Error('Fetch a fresh environment preview before confirmation.'); }
    if (value.reasons.length) { throw new Error(value.reasons[0]); }
    if (value.current && selectedHash !== value.current.settingsHash && !value.canUpdate) {
      throw new Error('Settings are immutable during a pending operation or deployment. Stop deployments and reconcile status before updating.');
    }
  }
  const updating = !!value.current && selectedHash !== value.current.settingsHash;
  let environments = value.current;
  if (!environments || updating) {
    const previous = value.current ? {...value.current} : undefined;
    if (previous) { delete previous.previous; }
    environments = {version: 1, operation: crypto.randomBytes(24).toString('hex'), settings: selected,
      settingsHash: selectedHash, phase: 'pending', helperImage: value.helperImage, controller: value.controller,
      ...(previous ? {previous, deployments: previous.deployments || {}} : {})};
  } else if (mode === 'activate' &&
    (environments.helperImage !== value.helperImage || environments.controller !== value.controller)) {
    throw new Error('The reserved helper identity changed. Restore it and reconcile before continuing.');
  }
  const recipe = recipeFor(environments);
  if (environments.recipeHash && environments.recipeHash !== recipe.recipeHash) {
    throw new Error('The reserved environment recipe changed. Use a reviewed recipe migration.');
  }
  environments = {...environments, recipeHash: recipe.recipeHash};
  let expectedContent = value.content;
  let receipt = value.receipt;
  const persist = (next: any, settingsData?: string) => {
    const lock = configPath() + '.environments.lock';
    try { fs.mkdirSync(lock, {mode: 0o700}); }
    catch (_) { throw new Error('An environment helper owns the configuration lock. Wait for it to finish and refresh status.'); }
    try {
      const actual = fs.readFileSync(configPath(), 'utf8');
      if (fs.readFileSync(mainPath(), 'utf8') !== value.mainContent ||
        (actual !== expectedContent && !same(withoutDeployments(actual), withoutDeployments(expectedContent)))) {
        throw new Error('Wizard configuration or receipt changed during the environment operation. Fetch and inspect before retrying.');
      }
      const live = readReceipt(actual);
      const liveEnvironments = live?.wizardWorkflow?.environments;
      if (updating && liveEnvironments?.operation !== next.operation && hasDeployments(liveEnvironments)) {
        throw new Error('A deployment started before settings were reserved. Stop it and fetch a fresh preview.');
      }
      if (liveEnvironments?.operation === next.operation && liveEnvironments.deployments !== undefined) {
        next = {...next, deployments: liveEnvironments.deployments};
      }
      receipt = {...receipt, wizardWorkflow: {...receipt.wizardWorkflow, environments: next}};
      const data = settingsData === undefined
        ? actual.split('\n').filter(line => !line.startsWith('# BOOTSTRAPPER_PROJECT=')).join('\n')
        : settingsData;
      writeReceipt(configPath(), data, receipt);
      expectedContent = fs.readFileSync(configPath(), 'utf8');
      environments = next;
    } finally { fs.rmdirSync(lock); }
  };
  if (mode === 'activate' && fs.existsSync(configPath() + '.environments.lock')) {
    throw new Error('An environment helper owns the configuration lock. Wait for it to finish and refresh status.');
  }
  return withProjectLock(environments.operation, () => {
    if (mode === 'activate') {
      preparing = {operation: environments.operation, previewHash: value.previewHash, settingsHash: selectedHash};
    }
    let reserved = false;
    return startJob(environments.operation, async () => {
      try {
        if (mode === 'activate') {
          // Local validation cannot create a durable reservation. A corrected
          // host/certificate can be confirmed afresh if no external call ran.
          await preflight(selected, value.platform);
          const fresh = context();
          if (fresh.previewHash !== value.previewHash) {
            throw new Error('Wizard configuration or receipt changed during local validation. Fetch a fresh preview before retrying.');
          }
          // Record external intent before Rails. After process death or a lost
          // response the operation remains conservative, never blindly repeated.
          persist({...environments, externalAttempted: true});
          reserved = true;
        }
        const previousEnvironments = environments.previous;
        const result = await rails({action: mode === 'activate' ? 'wizard-environments' : 'wizard-environments-status',
          projectKey: 'wizard', namespaceId: receipt.namespaceId, operation: receipt.operation,
          repository: receipt.repository, workflow: receipt.wizardWorkflow, build: receipt.wizardWorkflow.build,
          environments, expectedCi: wizardCi(), legacyRecipe: value.legacyRecipe, recipe,
          previousEnvironments, previousRecipe: previousEnvironments ? recipeFor(previousEnvironments) : undefined,
          controller: environments.controller, registryPrefix: value.registryPrefix});
        if (result.state === 'failed') { throw new Error(result.message || 'Environment operation failed.'); }
        const next = {...environments, ...result.environments};
        // Rails can report readiness but cannot change ownership or immutable settings.
        if (next.operation !== environments.operation || next.settingsHash !== environments.settingsHash ||
          next.recipeHash !== recipe.recipeHash || !same(next.settings, environments.settings) ||
          next.helperImage !== environments.helperImage || next.controller !== environments.controller ||
          (environments.activationCommit && next.activationCommit !== environments.activationCommit)) {
          throw new Error('The environment operation returned a different reservation identity.');
        }
        const installed = /^[a-f0-9]{40}$/.test(next.activationCommit || '');
        if (next.phase === 'ready' && !installed) { throw new Error('Environment readiness has no verified installation commit.'); }
        if (value.current?.phase === 'requires-reconciliation' &&
          !(installed && ['recipe-installed', 'ready'].includes(next.phase))) {
          next.phase = 'requires-reconciliation';
        }
        // Both activation and read-only refresh verify installed CI. No deployed
        // route is required, so a verified recipe remains usable by Deploy/Stop.
        if (installed && next.phase === 'recipe-installed') { next.phase = 'ready'; next.message = ''; }
        const installedData = installed ? wizardConfiguration(value.platform, next.settings) : undefined;
        persist(next, installedData);
        return {environments, message: result.message || 'Environment state verified. Production is unchanged.'};
      } catch (error) {
        if (reserved || mode === 'status') {
          const uncertain = environments.phase === 'requires-reconciliation' ||
            value.current?.phase === 'requires-reconciliation';
          persist({...environments, phase: uncertain ? 'requires-reconciliation' : 'verification-failed',
            message: error.message});
        }
        throw error;
      } finally {
        if (preparing?.operation === environments.operation) { preparing = undefined; }
      }
    });
  });
}
export const configureWizardEnvironments = (input: any) => operation('activate', input);
export const refreshWizardEnvironments = () => operation('status');

