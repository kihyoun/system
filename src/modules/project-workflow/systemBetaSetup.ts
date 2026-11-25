import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { configDirectory, mainConfigPath, wizardConfigPath } from '../configuration/statePaths';
import { readReceipt, writeReceipt, rails, startJob, withProjectLock } from './projectWorkflow';
import type { EnvironmentSettings } from '../../modules/wizard-environments/types';
import type { PreviewSourceProject, ProjectReceipt } from './projectContracts';
import { inputRecord } from './projectInputs';
import { StorageLease } from '../../modules/storage/lease';
import * as native from '../project-lifecycle/previewSettings';

export interface SystemBetaStatus {
  version: 2;
  phase?: string;
  settings?: native.PreviewSettings;
  operation?: string;
  previewUrl?: string;
  productionChanged: false;
  manualDeployment: true;
  message: string;
}

export interface SystemBetaPreflight {
  version: 2;
  previewHash: string;
  settings: native.PreviewSettings;
  environments: EnvironmentSettings;
  source: PreviewSourceProject;
  productionChanged: false;
  manualDeployment: true;
  message: string;
}

const hash = (value: unknown) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const disabled = { enabled: false, host: '', domainMode: 2, ssl: '', sslKey: '' };
function context(input: unknown) {
  const request = inputRecord(input);

  if (!request || Object.keys(request).some((key) => !['settings', 'previewHash'].includes(key))) {
    throw Error('Provide desired Beta settings and the exact preflight hash.');
  }

  const settings = native.settings(request.settings);

  if (settings.version !== 2) {
    throw Error('Explicitly migrate old preview settings before configuring System Beta.');
  }

  const legacy = path.join(configDirectory(), 'preview-setup.json');

  if (fs.existsSync(legacy)) {
    const old = inputRecord(JSON.parse(fs.readFileSync(legacy, 'utf8')));

    if (
      !old ||
      old.uncertain ||
      old.phase === 'needs-inspection' ||
      fs.existsSync(legacy + '.lock')
    ) {
      throw Error('Inspect the unfinished legacy setup and its owned leases before migration.');
    }
  }

  const content = fs.readFileSync(wizardConfigPath(), 'utf8'),
    main = fs.readFileSync(mainConfigPath(), 'utf8');
  const receipt = readReceipt(content);

  if (
    !receipt?.defaultProject ||
    receipt.template !== 'wizard' ||
    receipt.state !== 'complete' ||
    !receipt.repository?.systemProject
  ) {
    throw Error('Complete managed Wizard registration first.');
  }

  const current = receipt.wizardWorkflow?.environments;

  if (
    Object.values(current?.deployments || {}).some(
      (slot) => slot.active || slot.pending || slot.retired?.length || slot.tombstone,
    )
  ) {
    throw Error(
      'Stop and clean exactly owned old environments before changing the reservation. Preserve generation history.',
    );
  }

  const repository = receipt.repository;
  const helperImage = process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE || '';

  if (
    !/^sha256:[a-f0-9]{64}$/.test(helperImage || '') ||
    (process.env.SYSTEM_WIZARD_CANONICAL_CONTROLLER || 'system_bootstrapper_1') !==
      'system_bootstrapper_1'
  ) {
    throw Error('Provision an immutable System helper and canonical controller.');
  }

  return {
    settings,
    content,
    main,
    receipt,
    repository,
    current,
    helperImage,
    requestedHash: request.previewHash,
    previewHash: hash({ settings, content, main, helperImage }),
  };
}
export function systemBetaStatus(): SystemBetaStatus | undefined {
  let receipt: ProjectReceipt | undefined;
  try {
    receipt = readReceipt(fs.readFileSync(wizardConfigPath(), 'utf8'));
  } catch (_) {
    return undefined;
  }
  const environment = receipt?.wizardWorkflow?.environments;

  if (environment?.managementMode !== 'system-monorepo') {
    return undefined;
  }

  const settings = environment.settings;

  if (!settings) {
    throw Error('Invalid stored environment state.');
  }

  return {
    version: 2,
    phase: environment.phase,
    settings: environment.desiredSettings,
    operation: environment.operation,
    previewUrl: settings.beta.enabled ? 'https://' + settings.beta.host : undefined,
    productionChanged: false,
    manualDeployment: true,
    message:
      'Optional Beta is reserved. Explicitly bind one accepted System candidate, then deploy or stop its existing image. No extra build is started.',
  };
}
export async function preflightSystemBeta(
  input: unknown,
  preflightEnvironment: (settings: unknown) => Promise<EnvironmentSettings>,
): Promise<SystemBetaPreflight> {
  const value = context(input);
  const settings = await preflightEnvironment({
    review: disabled,
    beta: { ...value.settings.beta, domainMode: 2 },
  });
  const result = await rails({
    action: 'preview-setup-preflight',
    namespace: value.settings.namespace,
    sourceLayout: 'system-monorepo-v1',
    sources: [{ ...value.settings.wizard, ciPath: '.gitlab-ci.yml' }],
  });

  if (result.state === 'failed') {
    throw Error(result.message);
  }

  const source = result.projects?.[0];

  if (
    !source ||
    result.projects?.length !== 1 ||
    !Number.isSafeInteger(source.id) ||
    source.namespaceId !== value.repository.namespaceId ||
    source.path !== value.settings.namespace + '/' + value.settings.wizard.project ||
    !source.defaultBranch ||
    !/^[a-f0-9]{40}$/.test(source.sourceRevision || '')
  ) {
    throw Error('Shared source identity or canonical namespace changed.');
  }

  if (context(input).previewHash !== value.previewHash) {
    throw Error('Configuration changed; refresh preflight.');
  }

  return {
    version: 2,
    previewHash: hash({ local: value.previewHash, source, settings }),
    settings: value.settings,
    environments: settings,
    source,
    productionChanged: false,
    manualDeployment: true,
    message:
      'Shared source, DNS and TLS verified. Confirm to reserve optional Beta; no project, pipeline or build is created.',
  };
}
export function applySystemBeta(
  input: unknown,
  preflightEnvironment: (settings: unknown) => Promise<EnvironmentSettings>,
) {
  const value = context(input);

  const confirmedHash = value.requestedHash;

  if (typeof confirmedHash !== 'string' || !/^[a-f0-9]{64}$/.test(confirmedHash)) {
    throw Error('Refresh Beta preflight before confirmation.');
  }

  const operation = crypto.randomBytes(24).toString('hex');
  return withProjectLock(operation, () =>
    startJob(operation, async () => {
      const lease = new StorageLease(configDirectory(), {
        helperName: 'wizard-beta-setup',
        imageId: value.helperImage,
        operation,
      });
      const lock = wizardConfigPath() + '.environments.lock';
      let acquired = false;
      try {
        const plan = await preflightSystemBeta(input, preflightEnvironment);

        if (plan.previewHash !== confirmedHash) {
          throw Error('Source or configuration changed; refresh Beta preflight.');
        }

        fs.mkdirSync(lock, { mode: 0o700 });
        acquired = true;

        if (context(input).previewHash !== value.previewHash) {
          throw Error('Configuration changed before reservation.');
        }

        const previous = value.current;
        const environments = {
          version: 1,
          managementMode: 'system-monorepo',
          sourceLayout: 'system-monorepo-v1',
          operation,
          phase: 'ready',
          helperImage: value.helperImage,
          controller: 'system_bootstrapper_1',
          activationCommit: plan.source.sourceRevision,
          systemSource: plan.source,
          settings: plan.environments,
          settingsHash: hash(plan.environments),
          desiredSettings: value.settings,
          deployments: previous?.deployments || {},
          historicalDeployments: [
            ...(previous?.historicalDeployments || []),
            ...(previous ? [previous] : []),
          ],
        };
        const receipt = {
          ...value.receipt,
          wizardWorkflow: { ...value.receipt.wizardWorkflow, environments },
        };
        writeReceipt(
          wizardConfigPath(),
          value.content
            .split('\n')
            .filter((line) => !line.startsWith('# BOOTSTRAPPER_PROJECT='))
            .join('\n'),
          receipt,
        );
        const result = systemBetaStatus();

        if (!result) {
          throw Error('Invalid stored environment state.');
        }

        return result;
      } finally {
        if (acquired) {
          fs.rmdirSync(lock);
        }

        lease.release(true);
      }
    }),
  );
}
