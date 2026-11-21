import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BuildRecipe } from './build-recipe.service';
const recipeRoot = path.resolve(__dirname, '../../../templates/project-bootstrap/wizard-build');
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const recipePaths = [
  'Dockerfile',
  'Dockerfile.dockerignore',
  'Browser.Dockerfile',
  'Browser.Dockerfile.dockerignore',
  'build.sh',
  'verify.sh',
  'cleanup.sh',
  'smoke/check.js',
  'smoke/package.json',
  'smoke/package-lock.json',
];
export function generate(logo: string): BuildRecipe {
  const files = recipePaths.map((name) => {
    const content = fs
      .readFileSync(path.join(recipeRoot, 'recipe', name), 'utf8')
      .replace(/\r\n/g, '\n');
    return { path: '.system-bootstrapper/build-v1/' + name, content, sha256: hash(content) };
  });
  const ci =
    logo +
    `# Managed Wizard build v1. No Production deployment is enabled.
image: docker:29-cli@sha256:6fae2214c3121a28d5aa639d09032f61310b7c9c75ffbad1025f261a1b621800
default:
  tags: [docker]
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
    - sh .system-bootstrapper/build-v1/build.sh
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
    - sh .system-bootstrapper/build-v1/verify.sh
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
  return { ...manifest, recipeHash: hash(JSON.stringify(manifest)), ci, files };
}

@Injectable()
export class LegacyBuildRecipeService {
  generate(logo: string): BuildRecipe {
    return generate(logo);
  }
}
