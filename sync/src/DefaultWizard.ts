import fs from 'fs';
import path from 'path';
import Helper from './Helper';
import {createProject, queryGitlab, readReceipt, writeReceipt} from './ProjectBootstrap';

export function readSettings(data: string): any {
  const settings: any = {};
  for (const line of data.split(/\r?\n/)) {
    const match = /^(?:export )?([A-Z_]+)=(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*$/.exec(line);
    if (match) { settings[match[1]] = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4]; }
  }
  return settings;
}

export function wizardConfiguration(settings: any, environmentSettings?: any) {
  if (!settings.WIZARD_HOST) { throw new Error('Configure the real Wizard host before registering its project.'); }
  // Production continues to describe the existing interface. Optional managed
  // environments are server-owned and never regenerated from client projects.
  const values: any = {
    PROJECT_NAME: 'wizard', PROJECT_TEMPLATE: 'wizard',
    PROD_DEPLOY_MODE: '0', BETA_DEPLOY_MODE: '0', REVIEW_DEPLOY_MODE: '0',
    USE_PROD_HOST: 'true', PROD_HOST: settings.WIZARD_HOST,
    PROD_DOMAIN_MODE: settings.WIZARD_DOMAIN_MODE || '0',
    USE_BETA_HOST: 'false', USE_REVIEW_HOST: 'false',
    GITLAB_RUNNER_TOKEN: '', GITLAB_RUNNER_SCALE: '0'
  };
  if (Number(values.PROD_DOMAIN_MODE) > 1) {
    values.PROD_SSL = settings.WIZARD_SSL || '';
    values.PROD_SSL_KEY = settings.WIZARD_SSL_KEY || '';
  }
  if (environmentSettings) {
    for (const name of ['review', 'beta']) {
      const value = environmentSettings[name];
      if (!value || typeof value.enabled !== 'boolean' || value.domainMode !== 2 ||
        typeof value.host !== 'string' || typeof value.ssl !== 'string' || typeof value.sslKey !== 'string') {
        throw new Error('Invalid server-owned Wizard environment settings.');
      }
      const prefix = name.toUpperCase();
      values['USE_' + prefix + '_HOST'] = String(value.enabled);
      values[prefix + '_HOST'] = value.host;
      values[prefix + '_DOMAIN_MODE'] = String(value.domainMode);
      values[prefix + '_SSL'] = value.ssl;
      values[prefix + '_SSL_KEY'] = value.sslKey;
    }
  }
  return Helper.textLogo + '# Existing System Wizard interface; managed from General.\n' +
    Object.entries(values).map(([key, value]) => key + '="' + value + '"').join('\n') + '\n';
}

export const wizardCi = () => Helper.textLogo + `# Wizard registration scaffold: source import, review and rollout are the next stage.
# No pipeline starts for this README-only repository and nothing deploys the UI.
workflow:
  rules:
    - when: never
stages: [prepare]
prepare:wizard:
  stage: prepare
  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
  script:
    - echo 'Wizard source import, review and rollout are not implemented in this scaffold.'
`;

async function waitForJob(job: any) {
  while (job.state === 'running') { await new Promise((resolve) => setTimeout(resolve, 100)); }
  if (job.state === 'failed') { throw new Error(job.message || 'System Wizard registration failed.'); }
  return job;
}

export async function ensureDefaultWizard() {
  const config = path.resolve('../system/.docker.env');
  if (!fs.existsSync(config)) { return {state: 'not-configured'}; }
  const settings = readSettings(fs.readFileSync(config, 'utf8'));
  if (settings.WIZARD_ENABLE !== 'true') { return {state: 'disabled'}; }
  const file = path.resolve('../system/.projects.env/.wizard.env');
  const previous = fs.existsSync(file) ? readReceipt(fs.readFileSync(file, 'utf8')) : undefined;
  if (fs.existsSync(file) && (!previous?.defaultProject || previous.template !== 'wizard')) {
    throw new Error('The wizard Project Key is already configured. Existing projects are never overwritten.');
  }
  const environment = previous?.wizardWorkflow?.environments;
  const installed = environment?.activationCommit ? environment : environment?.previous?.activationCommit ? environment.previous : undefined;
  const data = wizardConfiguration(settings, installed?.settings);
  let namespaceId = previous?.namespaceId;
  if (!namespaceId) {
    const namespacesResult = await waitForJob(queryGitlab({action: 'namespaces'}));
    const namespace = namespacesResult.namespaces?.find((item: any) => item.path === 'root');
    if (!namespace) { throw new Error('The local administrator namespace could not be found.'); }
    namespaceId = namespace.id;
  }
  const result = await waitForJob(createProject({projectKey: 'wizard', namespaceId, template: 'wizard', data, ci: wizardCi()}, true));
  const lock = file + '.environments.lock';
  try { fs.mkdirSync(lock, {mode: 0o700}); }
  catch (_) { throw new Error('An environment helper owns the Wizard configuration lock. Wait and retry registration.'); }
  try {
    const receipt = readReceipt(fs.readFileSync(file, 'utf8'));
    const latestEnvironment = receipt?.wizardWorkflow?.environments;
    const latestInstalled = latestEnvironment?.activationCommit ? latestEnvironment :
      latestEnvironment?.previous?.activationCommit ? latestEnvironment.previous : undefined;
    // Refresh the real Production address while retaining the latest helper
    // checkpoints and the last installed optional settings across ordinary Push.
    writeReceipt(file, wizardConfiguration(settings, latestInstalled?.settings), receipt);
  } finally { fs.rmdirSync(lock); }
  return {state: 'registered', repository: result.repository};
}

if (require.main === module) {
  ensureDefaultWizard().then((result) => console.log('System Wizard project: ' + result.state))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
