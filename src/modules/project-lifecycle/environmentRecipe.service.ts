import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateTypedEnvironmentRecipe } from '../project-ci/environmentRecipe';
import type { EnvironmentSetting } from './types';
export interface EnvironmentRecipeOptions {
  settings: { review: EnvironmentSetting; beta: EnvironmentSetting };
  settingsHash: string;
  helperImage: string;
  operation: string;
  controller: string;
  buildRecipeHash?: string;
}
const recipeRoot = path.resolve(
  __dirname,
  '../../../templates/project-bootstrap/wizard-environments',
);
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
import * as legacy from './buildRecipe.service';
export function generate(logo: string, options: EnvironmentRecipeOptions) {
  const { settings, settingsHash, helperImage, operation, controller } = options || {};

  if (
    !settings ||
    !/^[a-f0-9]{64}$/.test(settingsHash || '') ||
    !/^sha256:[a-f0-9]{64}$/.test(helperImage || '') ||
    !/^[a-f0-9]{48}$/.test(operation || '') ||
    controller !== 'system_bootstrapper_1'
  ) {
    throw new Error('Invalid managed environment recipe reservation.');
  }

  const buildRecipe = options.buildRecipeHash
    ? legacy.select(logo, options.buildRecipeHash)
    : legacy.generate(logo);

  if (['node24-vite8-typed-v6', 'node24-vite8-cli-v7'].includes(buildRecipe.profile || '')) {
    return generateTypedEnvironmentRecipe(
      options as Parameters<typeof generateTypedEnvironmentRecipe>[0],
      buildRecipe,
      buildRecipe.profile === 'node24-vite8-cli-v7',
    );
  }

  const run = fs
    .readFileSync(path.join(recipeRoot, 'historical/run-v1.sh'), 'utf8')
    .replace(/__HELPER_IMAGE__/g, helperImage)
    .replace(/__OPERATION__/g, operation);
  const files = [
    { path: '.system-bootstrapper/environments-v1/run.sh', content: run, sha256: hash(run) },
  ];
  let ci = buildRecipe.ci.replace('stages: [build, test]', 'stages: [build, test, deploy]');
  ci += '\n# Managed Wizard environments v1; separate candidate hosts, manual jobs only.\n';
  for (const kind of ['review', 'beta'] as const) {
    const setting = settings[kind];

    if (!setting || typeof setting.enabled !== 'boolean') {
      throw new Error('Invalid environment enable setting.');
    }

    if (!setting.enabled) {
      continue;
    }

    if (
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(setting.host || '') ||
      setting.domainMode !== 2
    ) {
      throw new Error('Managed candidates require exact HTTPS hosts.');
    }

    const name = kind === 'review' ? 'review/$CI_PROJECT_ID/mr-$CI_MERGE_REQUEST_IID' : 'beta';
    const rule =
      kind === 'review'
        ? '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_IID'
        : '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_PIPELINE_SOURCE != "merge_request_event"';
    for (const action of ['deploy', 'stop']) {
      ci += `
${action}:${kind}:
  stage: deploy
  timeout: 10 minutes
  interruptible: false
  resource_group: 'wizard-${kind}-host-$CI_PROJECT_ID'
  needs:
    - job: build:wizard
      artifacts: ${action === 'deploy' ? 'true' : 'false'}
    - job: test:wizard
      artifacts: false
  environment:
    name: '${name}'
${action === 'deploy' ? `    url: 'https://${setting.host}'\n    on_stop: stop:${kind}\n` : '    action: stop\n'}  rules:
    - if: '${rule}'
      when: manual
      allow_failure: true
    - when: never
  script:
    - sh .system-bootstrapper/environments-v1/run.sh ${action} ${kind}
`;
    }
  }
  const manifest = {
    version: 1,
    settingsHash,
    operation,
    helperImage,
    controller,
    ciHash: hash(ci),
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
  };
  return { ...manifest, recipeHash: hash(JSON.stringify(manifest)), ci, files };
}

@Injectable()
export class EnvironmentRecipeService {
  generate(logo: string, options: EnvironmentRecipeOptions) {
    return generate(logo, options);
  }
}
