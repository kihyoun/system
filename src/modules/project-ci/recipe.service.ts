import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const TYPED_BUILD_PROFILE = 'node24-vite8-typed-v6';
@Injectable()
export class ProjectBuildRecipeService {
  generate(logo: string, checkout: string) {
    return generateTypedBuildRecipe(logo, checkout);
  }
}
export function generateTypedBuildRecipe(logo: string, checkout: string) {
  const prefix = '.system-bootstrapper/build-v2/';
  const locations: Record<string, string> = {};
  for (const file of [
    'Dockerfile',
    'Dockerfile.dockerignore',
    'Browser.Dockerfile',
    'Browser.Dockerfile.dockerignore',
  ])
    locations[file] = 'templates/project-bootstrap/wizard-build/typed-v6/' + file;
  locations['smoke/check.js'] = 'templates/project-bootstrap/wizard-build/quickstart-v5/check.js';
  for (const file of ['package.json', 'package-lock.json'])
    locations['smoke/' + file] = 'templates/project-bootstrap/wizard-build/modern/smoke/' + file;
  for (const file of ['project-ci.cjs', 'LICENSES.txt'])
    locations['runtime/' + file] =
      'templates/project-bootstrap/wizard-build/typed-v6/runtime/' + file;
  // Keep the managed project's installed path stable while reading the canonical source asset.
  locations['bootstrapper/ca/cacert-2026-10-20.crt'] = 'config/ca/cacert-2026-10-20.crt';
  const files = Object.entries(locations).map(([relative, source]) => {
    const content = fs.readFileSync(path.join(checkout, source), 'utf8');
    return { path: prefix + relative, content, sha256: hash(content) };
  });
  const runtime = prefix + 'runtime/project-ci.cjs';
  const ci =
    logo +
    `# Managed Wizard build v2. No Production deployment is enabled.
image: node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
default:
  tags: [docker]
  before_script:
    - node ${runtime} prepare-runtime ${prefix}
workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "api" && $SYSTEM_WIZARD_OPERATION'
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS && $CI_PIPELINE_SOURCE == "push"'
      when: never
    - if: '$CI_COMMIT_BRANCH && $CI_PIPELINE_SOURCE == "push"'
    - when: never
stages: [build, test]
build:wizard:
  stage: build
  timeout: 30 minutes
  script:
    - node ${runtime} build
  artifacts:
    expire_in: 7 days
    when: always
    paths: [build-evidence.json, cleanup.json]
    reports:
      dotenv: image.env
test:wizard:
  stage: test
  timeout: 30 minutes
  needs:
    - job: build:wizard
      artifacts: true
  script:
    - node ${runtime} verify
  artifacts:
    when: always
    expire_in: 7 days
    paths: [wizard-evidence.json, browser-evidence/, cleanup.json]
`;
  const manifest = {
    version: 1,
    ciHash: hash(ci),
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
  };
  return {
    ...manifest,
    profile: TYPED_BUILD_PROFILE,
    recipeHash: hash(JSON.stringify(manifest)),
    ci,
    files,
  };
}
