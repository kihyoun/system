'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const legacy = require('../wizard-build/recipe');
function generate(logo, options) {
  const {settings, settingsHash, helperImage, operation, controller} = options || {};
  if (!settings || !/^[a-f0-9]{64}$/.test(settingsHash || '') ||
      !/^sha256:[a-f0-9]{64}$/.test(helperImage || '') || !/^[a-f0-9]{48}$/.test(operation || '') ||
      controller !== 'system_bootstrapper_1') throw new Error('Invalid managed environment recipe reservation.');
  const run = fs.readFileSync(path.join(__dirname, 'run.sh'), 'utf8')
    .replace(/__HELPER_IMAGE__/g, helperImage).replace(/__OPERATION__/g, operation);
  const files = [{path: '.system-bootstrapper/environments-v1/run.sh', content: run, sha256: hash(run)}];
  const buildRecipe = options.buildRecipeHash ? legacy.select(logo, options.buildRecipeHash) : legacy.generate(logo);
  let ci = buildRecipe.ci.replace('stages: [build, test]', 'stages: [build, test, deploy]');
  ci += '\n# Managed Wizard environments v1; separate candidate hosts, manual jobs only.\n';
  for (const kind of ['review', 'beta']) {
    const setting = settings[kind];
    if (!setting || typeof setting.enabled !== 'boolean') throw new Error('Invalid environment enable setting.');
    if (!setting.enabled) continue;
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(setting.host || '') || setting.domainMode !== 2)
      throw new Error('Managed candidates require exact HTTPS hosts.');
    const name = kind === 'review' ? 'review/$CI_PROJECT_ID/mr-$CI_MERGE_REQUEST_IID' : 'beta';
    const rule = kind === 'review' ? '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_IID' :
      '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_PIPELINE_SOURCE != "merge_request_event"';
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
  const manifest = {version: 1, settingsHash, operation, helperImage, controller,
    ciHash: hash(ci), files: files.map(({path, sha256}) => ({path, sha256}))};
  return {...manifest, recipeHash: hash(JSON.stringify(manifest)), ci, files};
}
module.exports = {generate};
