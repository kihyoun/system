import fs from 'fs';
import path from 'path';
import Helper from './Helper';

export const applicationTemplates = ['empty', 'angular', 'react', 'web', 'wizard'];

export function prepareApplication(template: string, key: string, settings: any): any {
  if (!applicationTemplates.includes(template)) {
    throw new Error('Select a supported application template.');
  }
  if (template === 'empty' || template === 'wizard') {
    return {};
  }
  const root = path.resolve(__dirname, '../../project-bootstrap/templates', template);
  const files: any[] = [];
  function visit(directory: string) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      if (fs.statSync(file).isDirectory()) {
        visit(file);
        continue;
      }
      const relative = path.relative(root, file).split(path.sep).join('/');
      let content = fs.readFileSync(file, 'utf8').split('__PROJECT_KEY__').join(key);
      if (relative === 'package.json' || relative === 'package-lock.json') {
        const json = JSON.parse(content);
        json.name = key;
        if (json.packages && json.packages['']) {
          json.packages[''].name = key;
        }
        content = JSON.stringify(json, null, 2) + '\n';
      }
      files.push({ action: 'create', file_path: relative, content });
    }
  }
  visit(root);
  for (const [relative, source] of [
    ['runtime/project-ci.cjs', 'wizard/.gitlab/runtime/project-ci.cjs'],
    ['runtime/LICENSES.txt', 'wizard/.gitlab/runtime/LICENSES.txt'],
    ['bootstrapper/ca/cacert-2026-10-20.crt', 'bootstrapper/ca/cacert-2026-10-20.crt'],
  ]) {
    files.push({
      action: 'create',
      file_path: '.system-bootstrapper/' + relative,
      content: fs.readFileSync(path.resolve(__dirname, '../..', source), 'utf8'),
    });
  }
  return { files, templateVersion: 2, ci: applicationCi(key, settings, template) };
}

export function applicationCi(key: string, settings: any, template: string) {
  let ci =
    Helper.textLogo +
    `# Managed ${template} starter v2; editable in GitLab.
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
    - node .system-bootstrapper/runtime/project-ci.cjs prepare-runtime .system-bootstrapper
variables:
  IMAGE_TAG: '$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA'
  APP_LOG_MAX_SIZE: '10m'
  APP_LOG_MAX_FILES: '3'
stages: [build, test, deploy]
build:
  stage: build
  before_script:
    - node .system-bootstrapper/runtime/project-ci.cjs prepare-runtime .system-bootstrapper
    - echo "$CI_REGISTRY_PASSWORD" | docker login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  script:
    - docker build --provenance=false -t "$IMAGE_TAG" .
    - docker push "$IMAGE_TAG"
test:http:
  stage: test
  before_script:
    - node .system-bootstrapper/runtime/project-ci.cjs prepare-runtime .system-bootstrapper
    - echo "$CI_REGISTRY_PASSWORD" | docker login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  script:
    - echo "$APP_LOG_MAX_SIZE" | grep -Eq '^[1-9][0-9]*[kKmMgG]$'
    - echo "$APP_LOG_MAX_FILES" | grep -Eq '^([1-9][0-9]?|100)$'
    - docker pull "$IMAGE_TAG"
    - docker run -d --log-driver json-file --log-opt "max-size=$APP_LOG_MAX_SIZE" --log-opt "max-file=$APP_LOG_MAX_FILES" --name "smoke-$CI_PROJECT_ID-$CI_JOB_ID" "$IMAGE_TAG"
    - for attempt in $(seq 1 30); do docker exec "smoke-$CI_PROJECT_ID-$CI_JOB_ID" wget -q -O /tmp/page http://127.0.0.1/ && break; sleep 1; done
    - docker exec "smoke-$CI_PROJECT_ID-$CI_JOB_ID" grep -q '${key}' /tmp/page
  after_script:
    - docker rm -f "smoke-$CI_PROJECT_ID-$CI_JOB_ID" || true
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
${settings[environment + '_DEPLOY_MODE'] === '0' ? '  when: manual\n' : ''}  before_script:
    - node .system-bootstrapper/runtime/project-ci.cjs prepare-runtime .system-bootstrapper
    - echo "$CI_REGISTRY_PASSWORD" | docker login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  script:
    - echo "$APP_LOG_MAX_SIZE" | grep -Eq '^[1-9][0-9]*[kKmMgG]$'
    - echo "$APP_LOG_MAX_FILES" | grep -Eq '^([1-9][0-9]?|100)$'
    - docker pull "$IMAGE_TAG"
    - docker rm -f "${container}" || true
    - docker run -d --restart unless-stopped --log-driver json-file --log-opt "max-size=$APP_LOG_MAX_SIZE" --log-opt "max-file=$APP_LOG_MAX_FILES" --network ${key}_${kind} --name "${container}" -e VIRTUAL_HOST="${host}" "$IMAGE_TAG"
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
    - docker rm -f "${container}" || true
`;
    }
  }
  return ci;
}
