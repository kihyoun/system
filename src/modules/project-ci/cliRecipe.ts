import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { selectedCliArtifact } from './cliArtifact';

export const cliBuildProfile = 'node24-vite8-cli-v7';
export const cliRecipeFiles = [
  'Dockerfile',
  'Dockerfile.dockerignore',
  'Browser.Dockerfile',
  'Browser.Dockerfile.dockerignore',
  'browser/package.json',
  'browser/package-lock.json',
] as const;
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export function generateCliBuildRecipe(
  logo: string,
  checkout: string,
  cliArtifactSha256 = selectedCliArtifact().sha256,
) {
  if (!/^[a-f0-9]{64}$/.test(cliArtifactSha256)) {
    throw Error(
      'The CLI build profile requires matching source files. Use the source migration first.',
    );
  }

  const prefix = '.system-bootstrapper/build-v3/';
  const files = cliRecipeFiles.map((relative) => {
    const content = fs.readFileSync(
      path.join(checkout, 'templates/project-bootstrap/wizard-build/cli-v7', relative),
      'utf8',
    );
    return { path: prefix + relative, content, sha256: hash(content) };
  });
  const ci =
    logo +
    `# Managed Wizard CLI build v3; source-bound package, no Production deployment.
image: node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
default:
  tags: [docker]
  before_script:
    - echo '${cliArtifactSha256}  .gitlab/cli/system-bootstrapper.tgz' | sha256sum -c -
    - npm install --offline --ignore-scripts --no-audit --no-fund --no-package-lock --prefix .system-bootstrapper/cli ./.gitlab/cli/system-bootstrapper.tgz
    - export PATH="$CI_PROJECT_DIR/.system-bootstrapper/cli/node_modules/.bin:$PATH"
    - system-bootstrapper host-bootstrap install-runtime --checkout "$CI_PROJECT_DIR/.system-bootstrapper/cli/node_modules/@systembootstrapper/cli"
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
    - system-bootstrapper project-ci build "$CI_PROJECT_DIR"
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
    - system-bootstrapper project-ci verify "$CI_PROJECT_DIR"
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
    profile: cliBuildProfile,
    cliArtifactSha256,
    recipeHash: hash(JSON.stringify(manifest)),
    ci,
    files,
  };
}
