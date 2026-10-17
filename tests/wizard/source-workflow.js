const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const source = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-workflow-'));
fs.mkdirSync(path.join(root, 'sync'));
fs.mkdirSync(path.join(root, 'system/.projects.env'), {recursive: true});
process.chdir(path.join(root, 'sync'));
const bootstrap = require(path.join(source, 'sync/dist/ProjectBootstrap'));
const {wizardConfiguration, wizardCi} = require(path.join(source, 'sync/dist/DefaultWizard'));
const {initializeWizardSource, previewWizardSource} = require(path.join(source, 'sync/dist/WizardWorkflow'));
const config = path.join(root, 'system/.projects.env/.wizard.env');
const data = wizardConfiguration({WIZARD_HOST: 'localhost'});
const repository = {id: 99, namespaceId: 1, path: 'root/wizard', defaultBranch: 'main',
  systemProject: true, ciPath: '.system-bootstrapper/ci.yml', generatedCi: wizardCi()};
const registration = {operation: 'registration', namespaceId: 1, defaultProject: true,
  template: 'wizard', state: 'complete', repository};
let calls = 0;
let finish;
bootstrap.rails = async input => {
  calls++; assert.equal(input.action, 'wizard-source'); assert.equal(input.operation, 'registration');
  assert.deepEqual(input.repository, repository); assert.equal(input.expectedCi, wizardCi());
  assert(input.snapshot.files.some(file => file.path === '.gitlab-ci.yml'));
  return new Promise(resolve => { finish = () => resolve({importCommit: 'imported'}); });
};
async function wait(job) {
  while (job.state === 'running') await new Promise(resolve => setTimeout(resolve, 5));
  return job;
}
(async () => {
  bootstrap.writeReceipt(config, data, registration);
  const preview = previewWizardSource(); assert.equal(preview.repository.id, 99); assert(preview.fileCount > 0);
  assert(!JSON.stringify(preview).includes('content'), 'preview must not expose source blobs');
  assert.throws(() => initializeWizardSource({manifestHash: 'stale'}), /Preview/);
  assert.equal(calls, 0);
  const job = initializeWizardSource({manifestHash: preview.manifestHash});
  assert.equal(job.state, 'running'); assert(bootstrap.projectBusy());
  assert.equal(initializeWizardSource({manifestHash: preview.manifestHash}), job, 'concurrent initialize returns same job');
  assert.equal(calls, 1);
  assert.throws(() => bootstrap.withProjectLock('other', () => {}), /Another project/);
  const pending = bootstrap.readReceipt(fs.readFileSync(config, 'utf8'));
  assert.equal(pending.wizardWorkflow.phase, 'pending'); assert.equal(pending.operation, 'registration');
  finish(); await wait(job); assert.equal(job.state, 'complete'); assert(!bootstrap.projectBusy());
  const imported = bootstrap.readReceipt(fs.readFileSync(config, 'utf8'));
  assert.equal(imported.wizardWorkflow.phase, 'source-imported'); assert.equal(imported.wizardWorkflow.importCommit, 'imported');
  assert.deepEqual(imported.repository, repository); assert.equal(imported.state, 'complete');
  assert.equal(fs.readFileSync(config, 'utf8').slice(807, 808), '$');
  assert.equal(crypto.createHash('md5').update(fs.readFileSync(config, 'utf8').slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
  bootstrap.rails = async () => { throw Error('Safe fixture interruption'); };
  const failed = initializeWizardSource({manifestHash: preview.manifestHash}); await wait(failed);
  assert.equal(failed.state, 'failed'); assert(!bootstrap.projectBusy());
  const receipt = bootstrap.readReceipt(fs.readFileSync(config, 'utf8'));
  assert.equal(receipt.wizardWorkflow.operation, pending.wizardWorkflow.operation);
  bootstrap.rails = async () => ({importCommit: 'imported'});
  const recovered = initializeWizardSource({manifestHash: preview.manifestHash}); await wait(recovered);
  assert.equal(recovered.workflow.importCommit, 'imported'); assert.equal(recovered.id, job.id);
  receipt.wizardWorkflow.manifestHash = 'another'; bootstrap.writeReceipt(config, data, receipt);
  assert.throws(() => previewWizardSource(), /different Wizard source revision/);
  bootstrap.writeReceipt(config, data.replace('https://www.system-bootstrapper.com', 'http://www.system-bootstrapper.com'), registration);
  assert.throws(() => previewWizardSource(), /signature/);
  bootstrap.writeReceipt(config, data, {...registration, defaultProject: false});
  assert.throws(() => previewWizardSource(), /completed managed Wizard/);
  console.log('Wizard workflow: preview guard, signature/ownership, asynchronous lock/deduplication, receipt preservation and failed-operation recovery passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { process.chdir(source); fs.rmSync(root, {recursive: true, force: true}); });
