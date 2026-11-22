import fs from 'fs';
import path from 'path';
import { configDirectory } from '../configuration/statePaths';
import { systemBetaStatus, preflightSystemBeta, applySystemBeta } from './systemBetaSetup';
import type { EnvironmentSettings } from '../../modules/wizard-environments/types';
import { inputRecord, previewSetupInput } from './projectInputs';
import { settings as previewSettings } from '../project-lifecycle/previewSettings';
// Old desired settings remain inert and readable. No legacy setup mutation runs
// after the source-layout transition; owned cleanup uses retained receipts.
export function previewSetupStatus() {
  const current = systemBetaStatus();

  if (current) {
    return current;
  }

  const file = path.join(configDirectory(), 'preview-setup.json');

  if (!fs.existsSync(file)) {
    return { version: 2, phase: 'not-started', productionChanged: false, manualDeployment: true };
  }

  const saved = inputRecord(JSON.parse(fs.readFileSync(file, 'utf8')));

  if (
    !saved ||
    (saved.operation !== undefined && typeof saved.operation !== 'string') ||
    (saved.uncertain !== undefined && typeof saved.uncertain !== 'boolean')
  ) {
    throw Error('Development preview setup status is unavailable.');
  }

  return {
    version: 1,
    phase: 'legacy-read-only',
    operation: saved.operation,
    settings: saved.settings === undefined ? undefined : previewSettings(saved.settings),
    uncertain: saved.uncertain === true,
    productionChanged: false,
    manualDeployment: true,
    message:
      'Legacy setup is retained. Inspect uncertain operations and stop owned old resources before explicitly configuring System Beta.',
  };
}
export async function preflightPreviewSetup(
  input: unknown,
  preflightEnvironment: (settings: unknown) => Promise<EnvironmentSettings>,
) {
  return preflightSystemBeta(previewSetupInput(input), preflightEnvironment);
}
export function applyPreviewSetup(
  input: unknown,
  preflightEnvironment: (settings: unknown) => Promise<EnvironmentSettings>,
) {
  return applySystemBeta(previewSetupInput(input, true), preflightEnvironment);
}
