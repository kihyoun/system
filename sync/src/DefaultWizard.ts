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

export function wizardConfiguration(settings: any) {
  if (!settings.WIZARD_HOST) { throw new Error('Configure the real Wizard host before registering its project.'); }
  // Only the existing production endpoint is registered in this delivery.
  // Beta/review and deploying Wizard source are explicitly a subsequent stage.
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
  const data = wizardConfiguration(settings);
  const file = path.resolve('../system/.projects.env/.wizard.env');
  const previous = fs.existsSync(file) ? readReceipt(fs.readFileSync(file, 'utf8')) : undefined;
  if (fs.existsSync(file) && (!previous?.defaultProject || previous.template !== 'wizard')) {
    throw new Error('The wizard Project Key is already configured. Existing projects are never overwritten.');
  }
  let namespaceId = previous?.namespaceId;
  if (!namespaceId) {
    const namespacesResult = await waitForJob(queryGitlab({action: 'namespaces'}));
    const namespace = namespacesResult.namespaces?.find((item: any) => item.path === 'root');
    if (!namespace) { throw new Error('The local administrator namespace could not be found.'); }
    namespaceId = namespace.id;
  }
  const result = await waitForJob(createProject({projectKey: 'wizard', namespaceId, template: 'wizard', data, ci: wizardCi()}, true));
  const receipt = readReceipt(fs.readFileSync(file, 'utf8'));
  // Reflect the real current interface address after a main-configuration change.
  // Retain ownership and repository identity, including across ordinary Push.
  writeReceipt(file, data, receipt);
  return {state: 'registered', repository: result.repository};
}

if (require.main === module) {
  ensureDefaultWizard().then((result) => console.log('System Wizard project: ' + result.state))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
