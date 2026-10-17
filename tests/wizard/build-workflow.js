const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const source = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-build-'));
fs.mkdirSync(path.join(root, 'sync'));
fs.mkdirSync(path.join(root, 'system/.projects.env'), {recursive: true});
const mainConfig = path.join(root, 'system/.docker.env');
fs.writeFileSync(mainConfig, 'GITLAB_REGISTRY_URL=http://registry.localhost\nGITLAB_REGISTRY_DOMAIN_MODE=0\n');
process.chdir(path.join(root, 'sync'));
const bootstrap = require(path.join(source, 'sync/dist/ProjectBootstrap'));
const {wizardConfiguration, wizardCi} = require(path.join(source, 'sync/dist/DefaultWizard'));
const {previewWizardBuild, activateWizardBuild, refreshWizardBuild} = require(path.join(source, 'sync/dist/WizardBuild'));
const file = path.join(root, 'system/.projects.env/.wizard.env');
const data = wizardConfiguration({WIZARD_HOST: 'localhost'});
const receipt = {operation: 'registration', namespaceId: 1, defaultProject: true, template: 'wizard', state: 'complete',
  repository: {id: 99, path: 'root/wizard', defaultBranch: 'main', systemProject: true, ciPath: '.system-bootstrapper/ci.yml', generatedCi: wizardCi()},
  wizardWorkflow: {version: 1, operation: 'source-operation', sourceRevision: 'c'.repeat(40), manifestHash: 'd'.repeat(64), importCommit: 'a'.repeat(40), phase: 'source-imported'}};
let calls = 0, finish, expectedRegistryPrefix = 'registry.localhost:5050/root/wizard';
bootstrap.rails = input => {
  calls++;
  assert.equal(input.operation, 'registration');
  assert.equal(input.registryPrefix, expectedRegistryPrefix);
  assert(input.action === 'wizard-build' || input.action === 'wizard-build-status');
  assert.equal(input.workflow.importCommit, 'a'.repeat(40));
  return new Promise(resolve => {finish = () => resolve({build: {...input.build, phase: 'pipeline-running',
    activationCommit: 'b'.repeat(40), pipeline: {id: 11, sha: 'b'.repeat(40), status: 'running'}}, message: 'Fixture checks pending'});});
};
const wait = async job => {while (job.state === 'running') await new Promise(resolve => setTimeout(resolve, 5)); return job;};
(async () => {
  bootstrap.writeReceipt(file, data, receipt);
  assert.equal(refreshWizardBuild().state, 'not-activated');
  const preview = previewWizardBuild();
  assert(/^[a-f0-9]{64}$/.test(preview.recipeHash)); assert.equal(calls, 0);
  assert(!JSON.stringify(preview).includes('RUN npm'), 'Preview exposed recipe blobs');
  assert.throws(() => activateWizardBuild({recipeHash: 'stale'}), /Preview/);
  const job = activateWizardBuild({recipeHash: preview.recipeHash});
  assert.equal(calls, 1); assert(bootstrap.projectBusy());
  assert.equal(activateWizardBuild({recipeHash: preview.recipeHash}), job);
  assert.equal(refreshWizardBuild(), job); assert.equal(calls, 1);
  finish(); await wait(job); assert.equal(job.state, 'complete');
  for (const [url, mode, expected] of [
    ['http://registry.localhost', '1', 'registry.localhost:5050/root/wizard'],
    ['https://registry.localhost', '2', 'registry.localhost/root/wizard'],
    ['https://registry.localhost:5443', '3', 'registry.localhost:5443/root/wizard']
  ]) {
    fs.writeFileSync(mainConfig, 'GITLAB_REGISTRY_URL=' + url + '\nGITLAB_REGISTRY_DOMAIN_MODE=' + mode + '\n');
    expectedRegistryPrefix = expected;
    const refreshed = refreshWizardBuild(); finish(); await wait(refreshed);
    assert.equal(refreshed.state, 'complete', 'Registry mode did not match the platform advertisement');
  }
  fs.writeFileSync(mainConfig, 'GITLAB_REGISTRY_URL=http://registry.localhost\nGITLAB_REGISTRY_DOMAIN_MODE=0\n');
  expectedRegistryPrefix = 'registry.localhost:5050/root/wizard';
  let saved = bootstrap.readReceipt(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.wizardWorkflow.phase, 'source-imported');
  assert.equal(saved.wizardWorkflow.importCommit, receipt.wizardWorkflow.importCommit);
  assert.equal(saved.repository.generatedCi, wizardCi()); assert.equal(saved.operation, 'registration');
  const operation = saved.wizardWorkflow.build.operation;
  saved.wizardWorkflow.build.phase = 'candidate-verified';
  saved.wizardWorkflow.build.artifact = {imageRef: 'last-verified-fixture'};
  bootstrap.writeReceipt(file, data, saved);
  bootstrap.rails = async () => {throw Error('Safe interrupted fixture');};
  const failed = activateWizardBuild({recipeHash: preview.recipeHash}); await wait(failed);
  assert.equal(failed.state, 'failed'); assert(!bootstrap.projectBusy());
  saved = bootstrap.readReceipt(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.wizardWorkflow.build.operation, operation);
  assert.equal(saved.wizardWorkflow.build.pipeline.id, 11);
  assert.equal(saved.wizardWorkflow.build.phase, 'verification-failed');
  assert.equal(saved.wizardWorkflow.build.artifact, undefined, 'Failed verification retained a stale verified artifact');
  bootstrap.rails = async input => {
    assert.equal(input.action, 'wizard-build-status');
    return {build: input.build, message: 'Read-only status fixture'};
  };
  await wait(refreshWizardBuild());
  assert.equal(fs.readFileSync(file, 'utf8')[807], '$');
  assert.equal(crypto.createHash('md5').update(fs.readFileSync(file, 'utf8').slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
  let finishConflicted;
  bootstrap.rails = input => new Promise(resolve => {finishConflicted = () => resolve({build: input.build, message: 'Fixture'});});
  const conflicted = activateWizardBuild({recipeHash: preview.recipeHash});
  fs.appendFileSync(file, '# external configuration edit\n');
  finishConflicted(); await wait(conflicted);
  assert.equal(conflicted.state, 'failed'); assert(conflicted.message.includes('changed during'));
  assert(fs.readFileSync(file, 'utf8').endsWith('# external configuration edit\n'), 'Async completion overwrote a concurrent configuration edit');
  saved.wizardWorkflow.build.recipeHash = 'unexpected'; bootstrap.writeReceipt(file, data, saved);
  assert.throws(() => previewWizardBuild(), /different build recipe/);
  receipt.wizardWorkflow.phase = 'pending'; bootstrap.writeReceipt(file, data, receipt);
  assert.throws(() => previewWizardBuild(), /Initialize/);
  console.log('Wizard build module: preview confirmation, asynchronous deduplication, read-status-only action, receipt/source identity and failure recovery passed.');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {process.chdir(source); fs.rmSync(root, {recursive: true, force: true});});
