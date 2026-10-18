'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const logo = require('../../sync/dist/Helper').default.textLogo;
const generate = require('../../project-bootstrap/wizard-environments/recipe').generate;
const settings = {review: {enabled: true, host: 'review.example.test', domainMode: 2},
  beta: {enabled: true, host: 'beta.example.test', domainMode: 2}};
const options = {settings, settingsHash: 'a'.repeat(64), helperImage: 'sha256:' + 'b'.repeat(64),
  operation: 'c'.repeat(48), controller: 'system_bootstrapper_1'};
const recipe = generate(logo, options);
assert.strictEqual(recipe.ci[807], '$');
assert.strictEqual(crypto.createHash('md5').update(recipe.ci.slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
assert.strictEqual(generate(logo, options).recipeHash, recipe.recipeHash);
assert(recipe.ci.includes('stages: [build, test, deploy]'));
for (const kind of ['review', 'beta']) {
  for (const action of ['deploy', 'stop']) {
    const job = recipe.ci.split('\n' + action + ':' + kind + ':\n')[1].split(/\n[^ \n]/)[0];
    assert(job.includes("resource_group: 'wizard-" + kind + "-host-$CI_PROJECT_ID'"));
    assert(job.includes('when: manual'));
    assert(job.includes('timeout: 10 minutes'));
    assert(job.includes('sh .system-bootstrapper/environments-v1/run.sh ' + action + ' ' + kind));
    assert(!job.includes('when: on_success'));
  }
}
assert(recipe.ci.includes('review/$CI_PROJECT_ID/mr-$CI_MERGE_REQUEST_IID'));
assert(!recipe.ci.includes('CI_COMMIT_REF_SLUG.review'));
assert(!recipe.ci.includes('deploy:prod') && !recipe.ci.includes('stop:prod'));
const run = recipe.files[0].content;
assert(run.includes('--network none') && run.includes('--read-only') && run.includes('--memory 256m'));
assert(run.includes('source=system_templates,target=/templates'));
assert(run.includes('source=system_ssl,target=/ssl,readonly'));
assert(!run.includes('--privileged') && !run.includes('/system/system/.docker.env'));
assert(run.includes('docker stop --time 120'));
assert(run.includes('helper_id=$(docker create'));
assert(run.includes('docker start --attach "$helper_id"'));
assert(!run.includes('docker rm -f "$helper"'));
assert(run.includes('docker pull "$WIZARD_IMAGE_REF"'));
assert(!run.includes('__HELPER_IMAGE__') && !run.includes('__OPERATION__'));
const disabled = generate(logo, {...options, settings: {review: {enabled: false}, beta: {enabled: false}}});
assert(!disabled.ci.includes('deploy:review:') && !disabled.ci.includes('deploy:beta:'));
assert.throws(() => generate(logo, {...options, helperImage: 'latest'}));
assert.throws(() => generate(logo, {...options, controller: 'candidate-controller'}));
assert.throws(() => generate(logo, {...options, settings: {...settings, review: {...settings.review, host: '*.example.test'}}}));
for (const file of recipe.files) {
  assert.strictEqual(crypto.createHash('sha256').update(file.content).digest('hex'), file.sha256);
  assert(file.path.startsWith('.system-bootstrapper/environments-v1/'));
}
const source = fs.readFileSync(require.resolve('../../project-bootstrap/wizard-environments/helper'), 'utf8');
assert(!source.includes("['pull', imageRef]"), 'helper must not receive registry credentials');
console.log('Environment recipe: deterministic manual-only jobs, immutable image, MR identities, serialized host ownership and bounded clean helper passed.');
