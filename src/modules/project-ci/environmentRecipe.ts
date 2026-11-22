import crypto from 'node:crypto';
interface BuildRecipe {
  ci: string;
  recipeHash: string;
}
interface Setting {
  enabled: boolean;
  host: string;
  domainMode: number;
}
interface Options {
  settings: { review: Setting; beta: Setting };
  settingsHash: string;
  helperImage: string;
  operation: string;
  controller: string;
}
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
/** A versioned managed producer; the helper remains the authority for deployment ownership. */
export function generateTypedEnvironmentRecipe(options: Options, build: BuildRecipe, cli = false) {
  const { settings, settingsHash, helperImage, operation, controller } = options;

  if (
    !settings ||
    !/^[a-f0-9]{64}$/.test(settingsHash) ||
    !/^sha256:[a-f0-9]{64}$/.test(helperImage) ||
    !/^[a-f0-9]{48}$/.test(operation) ||
    controller !== 'system_bootstrapper_1'
  ) {
    throw Error('Invalid managed environment reservation');
  }

  const content =
    JSON.stringify(
      { version: 2, operation, helperImage, controller, buildRecipeHash: build.recipeHash },
      null,
      2,
    ) + '\n';
  const files = [
    { path: '.system-bootstrapper/environments-v2/binding.json', content, sha256: hash(content) },
  ];
  let ci = build.ci.replace('stages: [build, test]', 'stages: [build, test, deploy]');
  ci += `\n# Managed Wizard environments v2; manual jobs with exact helper ownership.\nvariables:\n  SYSTEM_WIZARD_ENVIRONMENT_IMAGE: '${helperImage}'\n  SYSTEM_WIZARD_ENVIRONMENT_OPERATION: '${operation}'\n`;
  for (const kind of ['review', 'beta'] as const) {
    const setting = settings[kind];

    if (!setting || typeof setting.enabled !== 'boolean') {
      throw Error('Invalid environment enable setting');
    }

    if (!setting.enabled) {
      continue;
    }

    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(setting.host) || setting.domainMode !== 2) {
      throw Error('Managed candidates require exact HTTPS hosts');
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
    - ${cli ? 'system-bootstrapper project-ci' : 'node .system-bootstrapper/build-v2/runtime/project-ci.cjs'} environment ${action} ${kind}
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
