import Helper from '../../common/configurationSignature';
import type { EnvironmentSettings } from './projectContracts';

export function readSettings(data: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const line of data.split(/\r?\n/)) {
    const match = /^(?:export )?([A-Z_]+)=(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*$/.exec(line);

    if (match) {
      settings[match[1]] =
        match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4];
    }
  }
  return settings;
}

export function wizardConfiguration(
  settings: Record<string, string>,
  environmentSettings?: EnvironmentSettings,
) {
  if (!settings.WIZARD_HOST) {
    throw new Error('Configure the real Wizard host before registering its project.');
  }

  // Production continues to describe the existing interface. Optional managed
  // environments are server-owned and never regenerated from client projects.
  const values: Record<string, string> = {
    PROJECT_NAME: 'wizard',
    PROJECT_TEMPLATE: 'wizard',
    PROD_DEPLOY_MODE: '0',
    BETA_DEPLOY_MODE: '0',
    REVIEW_DEPLOY_MODE: '0',
    USE_PROD_HOST: 'true',
    PROD_HOST: settings.WIZARD_HOST,
    PROD_DOMAIN_MODE: settings.WIZARD_DOMAIN_MODE || '0',
    USE_BETA_HOST: 'false',
    USE_REVIEW_HOST: 'false',
    GITLAB_RUNNER_TOKEN: '',
    GITLAB_RUNNER_SCALE: '0',
  };

  if (Number(values.PROD_DOMAIN_MODE) > 1) {
    values.PROD_SSL = settings.WIZARD_SSL || '';
    values.PROD_SSL_KEY = settings.WIZARD_SSL_KEY || '';
  }

  if (environmentSettings) {
    for (const name of ['review', 'beta'] as const) {
      const value = environmentSettings[name];

      if (
        !value ||
        typeof value.enabled !== 'boolean' ||
        value.domainMode !== 2 ||
        typeof value.host !== 'string' ||
        typeof value.ssl !== 'string' ||
        typeof value.sslKey !== 'string'
      ) {
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

  return (
    Helper.textLogo +
    '# Existing System Wizard interface; managed from General.\n' +
    Object.entries(values)
      .map(([key, value]) => key + '="' + value + '"')
      .join('\n') +
    '\n'
  );
}

export const wizardCi = () =>
  Helper.textLogo +
  `# Wizard registration scaffold: source import, review and rollout are the next stage.
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
