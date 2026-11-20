import fs from 'fs';
import path from 'path';
import {configDirectory} from './StatePaths';
import {systemBetaStatus, preflightSystemBeta, applySystemBeta} from './SystemBetaSetup';
// Old desired settings remain inert and readable. No legacy setup mutation runs
// after the source-layout transition; owned cleanup uses retained receipts.
export function previewSetupStatus() {
  const current = systemBetaStatus();
  if (current) return current;
  const file = path.join(configDirectory(), 'preview-setup.json');
  if (!fs.existsSync(file)) return {version: 2, phase: 'not-started', productionChanged: false, manualDeployment: true};
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {version: 1, phase: 'legacy-read-only', operation: saved.operation, settings: saved.settings,
    uncertain: saved.uncertain === true, productionChanged: false, manualDeployment: true,
    message: 'Legacy setup is retained. Inspect uncertain operations and stop owned old resources before explicitly configuring System Beta.'};
}
export async function preflightPreviewSetup(input: any) {
  if (input?.settings?.version !== 2) throw Error('Explicitly migrate legacy desired settings to System Beta. Review values are not Beta settings.');
  return preflightSystemBeta(input);
}
export function applyPreviewSetup(input: any) {
  if (input?.settings?.version !== 2) throw Error('Explicitly migrate legacy desired settings to System Beta.');
  return applySystemBeta(input);
}
