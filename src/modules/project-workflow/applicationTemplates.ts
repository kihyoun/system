import Helper from '../../common/configurationSignature';
import { publicPayloadFiles } from '../../common/publicPayload';
import { checkoutRoot } from '../../common/runtime/installationPaths';
import { cliArtifactFiles, selectedCliArtifact } from '../project-ci/cliArtifact';

export interface CommitFile {
  action: 'create';
  file_path: string;
  content: string;
  encoding?: 'base64';
}
export interface PreparedApplication {
  files?: CommitFile[];
  templateVersion?: number;
  ci?: string;
}

export const applicationTemplates = ['empty', 'angular', 'react', 'web', 'wizard'];

export function prepareApplication(
  template: string,
  key: string,
  settings: Record<string, string>,
): PreparedApplication {
  if (!applicationTemplates.includes(template)) {
    throw new Error('Select a supported application template.');
  }

  if (template === 'empty' || template === 'wizard') {
    return {};
  }

  const prefix = 'templates/project-bootstrap/templates/' + template;
  const files: CommitFile[] = [];
  for (const file of publicPayloadFiles(checkoutRoot(), prefix)) {
    const relative = file.path.slice(prefix.length + 1);
    let content = file.content.toString('utf8').split('__PROJECT_KEY__').join(key);

    if (relative === 'package.json' || relative === 'package-lock.json') {
      const json = JSON.parse(content) as {
        name: string;
        packages?: Record<string, { name?: string }>;
      };
      json.name = key;

      if (json.packages && json.packages['']) {
        json.packages[''].name = key;
      }

      content = JSON.stringify(json, null, 2) + '\n';
    }

    files.push({ action: 'create', file_path: relative, content });
  }
  for (const file of cliArtifactFiles(selectedCliArtifact())) {
    files.push({
      action: 'create',
      file_path: file.path,
      content: file.bytes.toString('base64'),
      encoding: 'base64',
    });
  }
  const environments: Record<string, { host: string }> = {};
  for (const kind of ['PROD', 'BETA', 'REVIEW']) {
    if (settings['USE_' + kind + '_HOST'] === 'true') {
      environments[kind.toLowerCase()] = { host: settings[kind + '_HOST'] };
    }
  }
  files.push({
    action: 'create',
    file_path: '.system-bootstrapper/application-v2.json',
    content: JSON.stringify({ version: 2, key, environments }, null, 2) + '\n',
  });
  return { files, templateVersion: 3, ci: applicationCi(key, settings, template) };
}

export function applicationCi(
  key: string,
  settings: Record<string, string>,
  template: string,
): string {
  let ci =
    Helper.textLogo +
    `# Managed ${template} starter v3; editable in GitLab.
workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS'
      when: never
    - if: '$CI_COMMIT_BRANCH'
    - when: never
image: node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
default:
  tags: [docker]
  before_script:
    - (cd .gitlab/cli && sha256sum -c system-bootstrapper.tgz.sha256)
    - npm install --offline --ignore-scripts --no-audit --no-fund --no-package-lock --prefix .system-bootstrapper/cli ./.gitlab/cli/system-bootstrapper.tgz
    - export PATH="$CI_PROJECT_DIR/.system-bootstrapper/cli/node_modules/.bin:$PATH"
    - system-bootstrapper host-bootstrap install-runtime --checkout "$CI_PROJECT_DIR/.system-bootstrapper/cli/node_modules/@systembootstrapper/cli"
variables:
  APP_LOG_MAX_SIZE: '10m'
  APP_LOG_MAX_FILES: '3'
stages: [build, test, deploy]
build:
  stage: build
  timeout: 30 minutes
  script:
    - system-bootstrapper project-ci application "$CI_PROJECT_DIR" build
  artifacts:
    when: always
    paths: [cleanup.json]
    reports:
      dotenv: app-image.env
test:http:
  stage: test
  timeout: 10 minutes
  needs:
    - job: build
      artifacts: true
  script:
    - system-bootstrapper project-ci application "$CI_PROJECT_DIR" verify
  artifacts:
    when: always
    paths: [cleanup.json]
`;
  for (const environment of ['PROD', 'BETA', 'REVIEW']) {
    if (settings['USE_' + environment + '_HOST'] !== 'true') {
      continue;
    }

    const kind = environment.toLowerCase();
    const review = kind === 'review';
    const host = (review ? '$CI_COMMIT_REF_SLUG.' : '') + settings[environment + '_HOST'];
    const container = key + '-' + kind + (review ? '-$CI_COMMIT_REF_SLUG' : '');
    const url =
      (Number(settings[environment + '_DOMAIN_MODE']) > 1 ? 'https://' : 'http://') + host;
    const name = review ? 'review/$CI_COMMIT_REF_SLUG' : kind === 'prod' ? 'production' : 'beta';
    ci += `
deploy:${kind}:
  stage: deploy
  resource_group: '${container}'
  environment:
    name: '${name}'
    url: '${url}'
${review ? '    on_stop: stop:review\n' : ''}  rules:
    - if: '${review ? '$CI_PIPELINE_SOURCE == "merge_request_event" || $CI_COMMIT_BRANCH' : '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'}'
${settings[environment + '_DEPLOY_MODE'] === '0' ? '  when: manual\n' : ''}  timeout: 10 minutes
  needs:
    - job: build
      artifacts: true
    - job: test:http
      artifacts: false
  script:
    - system-bootstrapper project-ci application "$CI_PROJECT_DIR" deploy ${kind}
  artifacts:
    when: always
    paths: [cleanup.json]
`;

    if (review) {
      ci += `
stop:review:
  stage: deploy
  resource_group: '${container}'
  when: manual
  allow_failure: true
  environment:
    name: '${name}'
    action: stop
  script:
    - system-bootstrapper project-ci application "$CI_PROJECT_DIR" stop review
`;
    }
  }
  return ci;
}
