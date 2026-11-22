import { mainConfigPath, wizardConfigPath } from '../../modules/configuration/statePaths';
import fs from 'fs';
import type { ProjectJob } from '../../modules/project-workflow/projectContracts';
import {
  createProject,
  queryGitlab,
  readReceipt,
  writeReceipt,
} from '../../modules/project-workflow/projectWorkflow';

import {
  readSettings,
  wizardConfiguration,
  wizardCi,
} from '../../modules/project-workflow/projectConfiguration';
export {
  readSettings,
  wizardConfiguration,
  wizardCi,
} from '../../modules/project-workflow/projectConfiguration';

async function waitForJob<Result extends object>(
  job: ProjectJob<Result>,
): Promise<ProjectJob<Result>> {
  while (job.state === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (job.state === 'failed') {
    throw new Error(job.message || 'System Wizard registration failed.');
  }

  return job;
}

export async function ensureDefaultWizard() {
  const config = mainConfigPath();

  if (!fs.existsSync(config)) {
    return { state: 'not-configured' };
  }

  const settings = readSettings(fs.readFileSync(config, 'utf8'));

  if (settings.WIZARD_ENABLE !== 'true') {
    return { state: 'disabled' };
  }

  const file = wizardConfigPath();
  const previous = fs.existsSync(file) ? readReceipt(fs.readFileSync(file, 'utf8')) : undefined;

  if (fs.existsSync(file) && (!previous?.defaultProject || previous.template !== 'wizard')) {
    throw new Error(
      'The wizard Project Key is already configured. Existing projects are never overwritten.',
    );
  }

  const environment = previous?.wizardWorkflow?.environments;
  const installed = environment?.activationCommit
    ? environment
    : environment?.previous?.activationCommit
      ? environment.previous
      : undefined;
  const data = wizardConfiguration(settings, installed?.settings);
  let namespaceId = previous?.namespaceId;

  if (!namespaceId) {
    const namespacesResult = await waitForJob(queryGitlab({ action: 'namespaces' }));
    const namespace = namespacesResult.namespaces?.find((item) => item.path === 'root');

    if (!namespace) {
      throw new Error('The local administrator namespace could not be found.');
    }

    namespaceId = namespace.id;
  }

  const result = await waitForJob(
    createProject(
      { projectKey: 'wizard', namespaceId, template: 'wizard', data, ci: wizardCi() },
      true,
    ),
  );
  const lock = file + '.environments.lock';
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (_) {
    throw new Error(
      'An environment helper owns the Wizard configuration lock. Wait and retry registration.',
    );
  }
  try {
    const receipt = readReceipt(fs.readFileSync(file, 'utf8'));

    if (!receipt) {
      throw new Error('Invalid stored project state.');
    }

    const latestEnvironment = receipt?.wizardWorkflow?.environments;
    const latestInstalled = latestEnvironment?.activationCommit
      ? latestEnvironment
      : latestEnvironment?.previous?.activationCommit
        ? latestEnvironment.previous
        : undefined;
    // Refresh the real Production address while retaining the latest helper
    // checkpoints and the last installed optional settings across ordinary Push.
    writeReceipt(file, wizardConfiguration(settings, latestInstalled?.settings), receipt);
  } finally {
    fs.rmdirSync(lock);
  }
  return { state: 'registered', repository: result.repository };
}

export async function defaultWizardMain(): Promise<void> {
  const result = await ensureDefaultWizard();
  console.log('System Wizard project: ' + result.state);
}
