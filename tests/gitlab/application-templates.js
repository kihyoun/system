const assert = require('assert');
const crypto = require('crypto');
const {prepareApplication} = require('../../sync/dist/ApplicationTemplates');
const {validateProject} = require('../../sync/dist/ProjectBootstrap');
const logo = require('../../sync/dist/Helper').default.textLogo;
const settings = {
  PROJECT_NAME: 'templatecheck', USE_PROD_HOST: 'true', PROD_HOST: 'app.localhost',
  PROD_DOMAIN_MODE: '0', PROD_DEPLOY_MODE: '0', USE_BETA_HOST: 'false',
  USE_REVIEW_HOST: 'true', REVIEW_HOST: 'review.localhost', REVIEW_DOMAIN_MODE: '3', REVIEW_DEPLOY_MODE: '1'
};
for (const template of ['angular', 'react', 'web']) {
  const generated = prepareApplication(template, settings.PROJECT_NAME, settings);
  const files = new Map(generated.files.map(file => [file.file_path, file.content]));
  assert(files.has('Dockerfile'));
  assert(!files.has('.system-bootstrapper/refresh-ca.sh'));
  assert(files.has('.system-bootstrapper/runtime/project-ci.cjs'));
  assert(files.has('.system-bootstrapper/runtime/LICENSES.txt'));
  assert.equal(generated.templateVersion, 2);
  assert(files.get('Dockerfile').includes('project-ci.cjs refresh-ca'));
  assert(generated.ci.includes('node:24.22.0-alpine3.24@sha256:'));
  assert(generated.ci.includes('node .system-bootstrapper/runtime/project-ci.cjs prepare-runtime .system-bootstrapper'));
  assert.equal(require('crypto').createHash('sha256').update(files.get('.system-bootstrapper/bootstrapper/ca/cacert-2026-10-20.crt')).digest('hex'), require('../../gitlab/security-release.json').jobCaBundleSha256);
  assert(files.has('GETTING_STARTED.md'));
  assert(!generated.files.some(file => file.file_path.includes('node_modules') || file.file_path.includes('..')));
  assert(generated.files.every(file => file.action === 'create' && !file.content.includes('__PROJECT_KEY__')));
  assert(generated.ci.includes('$CI_DEFAULT_BRANCH'));
  assert(generated.ci.includes('https://$CI_COMMIT_REF_SLUG.review.localhost'));
  const application=JSON.parse(files.get('.system-bootstrapper/application-v2.json'));
  assert.equal(application.key,'templatecheck');
  assert.deepEqual(application.environments,{prod:{host:'app.localhost'},review:{host:'review.localhost'}});
  assert(generated.ci.includes('when: manual'));
  assert(generated.ci.includes('test:http:'));
  for(const action of ['build','verify','deploy prod','deploy review','stop review'])assert(generated.ci.includes('project-ci.cjs application '+action));
  assert(!generated.ci.includes('docker run')&&!generated.ci.includes('docker rm')&&!generated.ci.includes('grep -Eq'));
  assert(generated.ci.includes("APP_LOG_MAX_SIZE: '10m'"));
  assert(generated.ci.includes("APP_LOG_MAX_FILES: '3'"));
  assert(generated.ci.includes('dotenv: app-image.env')&&generated.ci.includes('job: test:http'));
  assert(!generated.ci.includes('cypress') || generated.ci.substr(0, 1184).includes('cypress'));
  assert.equal(generated.ci.substr(807, 1), '$');
  assert.equal(crypto.createHash('md5').update(generated.ci.substr(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
  if (template !== 'web') {
    const pkg = JSON.parse(files.get('package.json'));
    const lock = JSON.parse(files.get('package-lock.json'));
    assert.equal(pkg.name, 'templatecheck');
    assert.equal(lock.name, pkg.name);
    assert.equal(lock.packages[''].name, pkg.name);
    for (const group of ['dependencies', 'devDependencies']) {
      for (const version of Object.values(pkg[group])) assert(/^\d+\.\d+\.\d+/.test(version));
    }
    assert(files.get('Dockerfile').includes('npm ci'));
  }
}
assert.deepEqual(prepareApplication('empty', 'templatecheck', settings), {});
assert.throws(() => prepareApplication('../react', 'templatecheck', settings));
const data = logo + '\n' + Object.entries(settings).map(([key, value]) => key + '="' + value + '"').join('\n');
assert.doesNotThrow(() => validateProject({projectKey: 'templatecheck', namespaceId: 1, template: 'react', data}));
assert.throws(() => validateProject({projectKey: 'templatecheck', namespaceId: 1, template: 'invalid', data}));
console.log('Application templates: pinned dependencies, generated names, all-create files, CI/manual environments and immutable signature passed.');
