import fs from 'fs';
import path from 'path';
import Helper from './Helper';

export const applicationTemplates = ['empty', 'angular', 'react', 'web'];

export function prepareApplication(template: string, key: string, settings: any): any {
  if (!applicationTemplates.includes(template)) { throw new Error('Select a supported application template.'); }
  if (template === 'empty') { return {}; }
  const root = path.resolve(__dirname, '../../project-bootstrap/templates', template);
  const files: any[] = [];
  function visit(directory: string) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      if (fs.statSync(file).isDirectory()) { visit(file); continue; }
      const relative = path.relative(root, file).split(path.sep).join('/');
      let content = fs.readFileSync(file, 'utf8').split('__PROJECT_KEY__').join(key);
      if (relative === 'package.json' || relative === 'package-lock.json') {
        const json = JSON.parse(content);
        json.name = key;
        if (json.packages && json.packages['']) { json.packages[''].name = key; }
        content = JSON.stringify(json, null, 2) + '\n';
      }
      files.push({action: 'create', file_path: relative, content});
    }
  }
  visit(root);
  return {files, templateVersion: 1, ci: applicationCi(key, settings, template)};
}

export function applicationCi(key: string, settings: any, template: string) {
  let ci = Helper.textLogo + `# Managed ${template} starter v1; editable in GitLab.
workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS'
      when: never
    - if: '$CI_COMMIT_BRANCH'
    - when: never
image: docker:29-cli@sha256:1a4c7cb63513f349bdad01fcc6e0f3f2f67d37b9da86f14dc0d4a0942eecda00
default:
  tags: [docker]
variables:
  IMAGE_TAG: '$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA'
stages: [build, test, deploy]
build:
  stage: build
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  script:
    - docker build --provenance=false -t "$IMAGE_TAG" .
    - docker push "$IMAGE_TAG"
test:http:
  stage: test
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  script:
    - docker pull "$IMAGE_TAG"
    - docker run -d --name "smoke-$CI_PROJECT_ID-$CI_JOB_ID" "$IMAGE_TAG"
    - for attempt in $(seq 1 30); do docker exec "smoke-$CI_PROJECT_ID-$CI_JOB_ID" wget -q -O /tmp/page http://127.0.0.1/ && break; sleep 1; done
    - docker exec "smoke-$CI_PROJECT_ID-$CI_JOB_ID" grep -q '${key}' /tmp/page
  after_script:
    - docker rm -f "smoke-$CI_PROJECT_ID-$CI_JOB_ID" || true
`;
  for (const environment of ['PROD', 'BETA', 'REVIEW']) {
    if (settings['USE_' + environment + '_HOST'] !== 'true') { continue; }
    const kind = environment.toLowerCase();
    const review = kind === 'review';
    const host = (review ? '$CI_COMMIT_REF_SLUG.' : '') + settings[environment + '_HOST'];
    const container = key + '-' + kind + (review ? '-$CI_COMMIT_REF_SLUG' : '');
    const url = (Number(settings[environment + '_DOMAIN_MODE']) > 1 ? 'https://' : 'http://') + host;
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
    - echo "$CI_REGISTRY_PASSWORD" | docker login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  script:
    - docker pull "$IMAGE_TAG"
    - docker rm -f "${container}" || true
    - docker run -d --restart unless-stopped --network ${key}_${kind} --name "${container}" -e VIRTUAL_HOST="${host}" "$IMAGE_TAG"
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
