const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
const logo = require(path.join(root, 'sync/dist/Helper')).default.textLogo;
const recipe = require(path.join(root, 'project-bootstrap/wizard-build/recipe')).generate(logo);
assert.equal(recipe.version, 1);
assert.equal(recipe.ci[807], '$');
assert.equal(crypto.createHash('md5').update(recipe.ci.slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
assert(!/deploy:|stage: deploy|when: manual|DOCKERHUB|PRIVATE_KEY/.test(recipe.ci));
assert(recipe.ci.includes('CI_OPEN_MERGE_REQUESTS') && recipe.ci.includes('merge_request_event'));
assert(recipe.ci.includes('dotenv: image.env') && recipe.ci.includes('artifacts: true'));
const defaultSection = recipe.ci.split('\ndefault:\n')[1].split('\nworkflow:')[0];
assert(!/^  timeout:/m.test(defaultSection), 'GitLab default must not contain the job-only timeout keyword');
for (const jobName of ['build:wizard', 'test:wizard']) {
  const job = recipe.ci.split('\n' + jobName + ':\n')[1].split(/\n[^ \n]/)[0];
  assert(/^  timeout: 30 minutes$/m.test(job), jobName + ' must declare its own bounded timeout');
}
for (const file of recipe.files) {
  assert.equal(crypto.createHash('sha256').update(file.content).digest('hex'), file.sha256);
  assert(file.path.startsWith('.system-bootstrapper/build-v1/'));
  assert(!file.path.endsWith('/.gitlab-ci.yml'));
}
const content = name => recipe.files.find(file => file.path.endsWith('/' + name)).content;
assert(content('Dockerfile').includes('node:13.12.0-alpine@sha256:'));
assert(content('Dockerfile').includes('RUN npm ci') && content('Dockerfile').includes('CI=true npm test'));
assert(content('Dockerfile').includes('RUN CI= npm run build'));
assert(!content('Dockerfile').includes('npm install'));
assert(content('Dockerfile.dockerignore').includes('**/.git'));
assert(content('Dockerfile.dockerignore').includes('**/.env'));
assert(content('cleanup.sh').includes('docker buildx rm -f'));
assert(content('verify.sh').includes('--internal'));
const lock = JSON.parse(content('smoke/package-lock.json'));
assert.equal(lock.packages['node_modules/playwright'].version, '1.63.0');
assert.equal(lock.packages['node_modules/playwright-core'].version, '1.63.0');
assert.equal(JSON.parse(content('smoke/package.json')).dependencies.playwright, '1.63.0');
const again = require(path.join(root, 'project-bootstrap/wizard-build/recipe')).generate(logo);
assert.equal(recipe.recipeHash, again.recipeHash);
console.log('Wizard recipe: immutable signature, deterministic manifest, legacy lockfile checks, browser gate, contextual excludes and no deployment passed.');
