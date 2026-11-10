'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-setup-workflow-'));
process.env.SYSTEM_CONFIG_DIR = root;
process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE = 'sha256:' + 'f'.repeat(64);
const bootstrap = require('../../sync/dist/ProjectBootstrap');
const logo = require('../../sync/dist/Helper').default.textLogo;
const config = path.join(root, '.projects.env/.wizard.env'), main = path.join(root, '.docker.env');
fs.mkdirSync(path.dirname(config));
const receipt = {defaultProject: true, template: 'wizard', state: 'complete', operation: '1'.repeat(48), namespaceId: 1,
  repository: {id: 1, namespaceId: 1, path: 'root/wizard', defaultBranch: 'master', ciPath: '.system-bootstrapper/ci.yml', systemProject: true}};
bootstrap.writeReceipt(config, logo, receipt);
fs.writeFileSync(main, logo + "GITLAB_HOST='gitlab.example.test'\nGITLAB_EXTERNAL_URL='https://gitlab.example.test'\nGITLAB_REGISTRY_URL='https://registry.example.test'\n");
const originalMain = fs.readFileSync(main, 'utf8');
const sha = 'a'.repeat(40), imageRef = 'registry.example.test/team/fork@sha256:' + 'b'.repeat(64);
const desired = {version: 1, namespace: 'team', wizard: {mode: 'import', project: 'fork', origin: 'https://example.test/fork.git'},
  review: {enabled: true, host: 'review.example.test', ssl: '/ssl/review/cert', sslKey: '/ssl/review/key'}, beta: {enabled: false, host: '', ssl: '', sslKey: ''}};
const nativeSource = require('../../project-bootstrap/preview-setup/source');
let transfers = 0, registered = 0, revoked = 0, adoptionCalls = 0, activated = 0, reads = 0;
let pipelineStatus = 'running', requiredStatus = 'success';
let failureMode = process.env.PREVIEW_SETUP_FAILURE_FIXTURE || '';
if (failureMode === 'uncertain-environment') pipelineStatus = 'success';
nativeSource.originPreflight = async () => 'ref: refs/heads/master HEAD';
nativeSource.transfer = async input => { transfers++; assert.equal(input.token, 'fixture-transfer-secret'); assert.equal(input.destination, 'https://gitlab.example.test/team/fork.git');
  if (failureMode.startsWith('uncertain-push')) throw Object.assign(Error('Source push response was lost.'), {uncertain:true,action:'preview-source-push'});
  if (failureMode === 'missing-pipeline') return {unchanged: true};
};
require('../../project-bootstrap/wizard-source-primary/run').Adoption = class {
  retainedInstallation() { return 'accepted-public-release'; }
  async plan(input) { adoptionCalls++; assert.equal(input.action, 'bootstrap-previews'); assert.equal(input.sourceCommit, sha); assert.equal(input.imageRef, imageRef); this.input = input; return {planHash: 'confirmed-native-proof'}; }
  async apply(input, confirmation) {
    assert.equal(confirmation, 'confirmed-native-proof');
    const next = {...receipt, namespaceId: 9, repository: {...receipt.repository, id: 7, namespaceId: 9, path: 'team/fork', managementMode: 'source-primary', ciPath: '.gitlab/primary.yml'},
      sourcePrimary: {version: 1, operation: '2'.repeat(48), adoptionCommit: sha, ciFiles: input.ciFiles}};
    bootstrap.writeReceipt(config, logo, next);
  }
};
const environment = require('../../sync/dist/WizardEnvironments');
environment.preflightWizardEnvironmentSettings = async value => value;
environment.previewWizardEnvironments = () => ({previewHash: 'native-environments', capabilities: {canUpdate: true, reasons: []}});
environment.configureWizardEnvironments = input => {if (failureMode === 'uncertain-environment') return {state: 'failed', message: 'Fixture environment timeout.', uncertain: true, uncertainAction: 'wizard-environments-primary'}; activated++; assert.equal(input.settings.review.host, desired.review.host); return {state: 'complete'};};
bootstrap.rails = async input => {
  if (input.action === 'preview-setup-read-many') return {values: await Promise.all(input.routes.map(async route => (await bootstrap.rails({...input, action: 'preview-setup-read', route})).value))};
  if (input.action === 'preview-setup-preflight') return {namespaceId: 9};
  if (input.action === 'preview-setup-project') { registered++;
    if (failureMode === 'uncertain-project') throw Object.assign(Error('Fixture Rails timeout.'), {uncertain: true, action: input.action});
    if (failureMode === 'settled-project') return {state: 'failed', message: 'Fixture settled native refusal.'};
    if (failureMode === 'replaced-storage') fs.writeFileSync(path.join(root, '.storage-operation-lock/operation.json'), 'foreign storage lease');
    if (failureMode === 'replaced-preview') fs.writeFileSync(path.join(root, 'preview-setup.json.lock/owner.json'), 'foreign preview lease');
    return {project: {id: 7, path_with_namespace: 'team/fork', namespace: {id: 9}}, credential: {id: 11, token: 'fixture-transfer-secret'}}; }
  if (input.action === 'preview-setup-revoke') {revoked++; assert.equal(input.tokenId, 11);
    if (failureMode === 'uncertain-push-revoke-failed') return {state:'failed',message:'Fixture revoke refusal.'};
    return {revoked: true};}
  assert.equal(input.action, 'preview-setup-read'); reads++;
  const route = input.route;
  if (route === 'projects/7') return {value: {id: 7, default_branch: 'master'}};
  if (route.includes('/repository/branches/')) return {value: {commit: {id: sha}}};
  if (route.includes('/pipelines?')) return {value: failureMode === 'missing-pipeline' ? [] : [{id: 31, sha, source: 'push', status: pipelineStatus, web_url: 'https://gitlab.example.test/pipeline/31'}]};
  if (route.includes('/pipelines/31/jobs')) return {value: ['build:source', 'test:browser', 'build:wizard', 'test:wizard'].map((name, id) => ({id: id + 40, name, status: name === 'test:browser' ? requiredStatus : 'success', allow_failure: false, commit: {id: sha}, pipeline: {id: 31}}))};
  if (route.includes('/artifacts/build-evidence.json')) return {value: {imageRef}};
  if (route.includes('/repository/tree?')) return {value: route.includes('path=.gitlab&') ? [{type: 'blob', path: '.gitlab/primary.yml'}, {type: 'blob', path: '.gitlab/delivery/environment.sh'}] : []};
  if (route.includes('/repository/files/')) return {value: {content: Buffer.from('# approved fixture\n').toString('base64')}};
  throw Error('Unexpected native request: ' + route);
};
require('../../project-bootstrap/preview-setup/producers').approvedProducers = () => [];
require('../../project-bootstrap/preview-setup/producers').validateProducers = files => {assert(files.some(file => file.path === '.gitlab/primary.yml'));};
const setup = require('../../sync/dist/PreviewSetup');
async function wait(job) {while (job.state === 'running') await new Promise(resolve => setTimeout(resolve, 1)); return job;}
async function verifyReadBatches() {
  const {batchedReads, MAX_ROUTES, MAX_OUTPUT_BYTES} = require('../../project-bootstrap/preview-setup/reads');
  let active = 0, peak = 0, launches = 0, generation = 1;
  const request = batchedReads(async routes => {
    launches++; active++; peak = Math.max(peak, active);
    assert(routes.length <= MAX_ROUTES);
    await Promise.resolve(); active--;
    return routes.map(route => ({route, generation}));
  });
  const routes = Array.from({length: 100}, (_, index) => 'projects/7/pipelines/' + (index + 1));
  assert.deepEqual((await Promise.all(routes.map(request))).map(row => row.route), routes);
  assert.equal(launches, Math.ceil(routes.length / MAX_ROUTES)); assert.equal(peak, 1);
  generation++;
  assert.equal((await request(routes[0])).generation, 2, 'Evidence transport cached an earlier phase');
  const malformed = batchedReads(async () => []);
  await assert.rejects(malformed('projects/7'), /Preview setup GitLab request failed/);
  const oversized = batchedReads(async () => ['한'.repeat(Math.ceil(MAX_OUTPUT_BYTES / 3))]);
  await assert.rejects(oversized('projects/7'), /Preview setup GitLab request failed/);
  let failedLaunches = 0;
  const failed = batchedReads(async () => {failedLaunches++; throw Error('Settled native read refusal');});
  const outcomes = await Promise.allSettled(routes.map(failed));
  assert(outcomes.every(row => row.status === 'rejected'));
  assert.equal(failedLaunches, 1, 'Failed native batch continued launching evidence processes');
}
(async () => {
  if (!failureMode) await verifyReadBatches();
  if (failureMode === 'missing-pipeline') {
    let plan = await setup.preflightPreviewSetup({settings: desired});
    let job = await wait(setup.applyPreviewSetup({settings: desired, previewHash: plan.previewHash}));
    assert.equal(job.phase, 'waiting-build'); assert.equal(job.pipeline, undefined);
    assert(job.message.includes('normal source push')); assert(job.message.includes('never fabricates'));
    plan = await setup.preflightPreviewSetup({settings: desired});
    job = await wait(setup.applyPreviewSetup({settings: desired, previewHash: plan.previewHash}));
    assert.equal(job.phase, 'waiting-build'); assert.equal(job.pipeline, undefined);
    assert.equal(transfers, 1); assert.equal(registered, 1); assert.equal(revoked, 1);
    assert.equal(adoptionCalls + activated, 0, 'A full import without native CI cannot become accepted previews');
    console.log('Preview setup failure regression passed: missing-pipeline');
    return;
  }
  if (failureMode) {
    const mode = failureMode;
    let plan = await setup.preflightPreviewSetup({settings: desired});
    let job = await wait(setup.applyPreviewSetup({settings: desired, previewHash: plan.previewHash}));
    assert.equal(job.state, 'failed');
    assert.equal(fs.readFileSync(main, 'utf8'), originalMain);
    if (mode === 'settled-project') {
      assert.equal(setup.previewSetupStatus().phase, 'needs-attention');
      assert(!fs.existsSync(path.join(root, '.storage-operation-lock')));
      assert(!fs.existsSync(path.join(root, 'preview-setup.json.lock')));
      failureMode = '';
      plan = await setup.preflightPreviewSetup({settings: desired});
      job = await wait(setup.applyPreviewSetup({settings: desired, previewHash: plan.previewHash}));
      assert.equal(job.phase, 'waiting-build'); assert.equal(transfers, 1);
    } else {
      assert.equal(job.uncertain, true);
      const status = setup.previewSetupStatus();
      assert.equal(status.phase, 'needs-inspection'); assert.equal(status.uncertain, true);
      const storage = fs.readFileSync(path.join(root, '.storage-operation-lock/operation.json'), 'utf8');
      const preview = fs.readFileSync(path.join(root, 'preview-setup.json.lock/owner.json'), 'utf8');
      const checkpoint = JSON.parse(fs.readFileSync(path.join(root, 'preview-setup.json'), 'utf8'));
      assert.equal(checkpoint.inspection.reason, 'mutation-completion-unconfirmed');
      if (mode.startsWith('uncertain-push')) {
        assert.equal(revoked, 1, 'Token revocation cannot prove an already-authorized push finished');
        assert.equal(checkpoint.inspection.action, 'preview-source-push', 'Cleanup failure must not erase the original unconfirmed mutation');
      }
      if (mode === 'replaced-storage') assert.equal(storage, 'foreign storage lease');
      else if (mode.startsWith('uncertain-')) assert.equal(JSON.parse(storage).completion, 'uncertain');
      if (mode === 'replaced-preview') assert.equal(preview, 'foreign preview lease');
      const callsBeforeResume = registered + transfers + reads;
      await assert.rejects(setup.preflightPreviewSetup({settings: desired}), /confirmed completion|retained leases/);
      assert.throws(() => setup.applyPreviewSetup({settings: desired, previewHash: plan.previewHash}), /confirmed completion|retained leases/);
      assert.equal(registered + transfers + reads, callsBeforeResume, 'Uncertain resumption started another native operation');
      assert.equal(fs.readFileSync(path.join(root, '.storage-operation-lock/operation.json'), 'utf8'), storage);
      assert.equal(fs.readFileSync(path.join(root, 'preview-setup.json.lock/owner.json'), 'utf8'), preview);
      setup.previewSetupStatus();
      if (mode.startsWith('uncertain-')) {
        fs.unlinkSync(path.join(root, 'preview-setup.json'));
        assert.equal(setup.previewSetupStatus().phase, 'needs-inspection', 'Native uncertain lease was hidden without its status file');
        assert.equal(setup.previewSetupStatus().operation, checkpoint.operation);
      }
      assert.equal(registered + transfers + reads, callsBeforeResume, 'Inspection status was not local/read-only');
    }
    console.log('Preview setup failure regression passed: ' + mode);
    return;
  }
  assert.equal(setup.previewSetupStatus().phase, 'not-started');
  assert.equal(registered + transfers + reads, 0, 'Read-only idle status had side effects');
  let plan = await setup.preflightPreviewSetup({settings: desired});
  assert.equal(registered + transfers + reads, 0, 'Preflight provisioned source or read fabricated evidence');
  assert.throws(() => setup.applyPreviewSetup({settings: desired, previewHash: 'stale'}), /preflight again/);
  let pending = setup.applyPreviewSetup({settings: desired, previewHash: plan.previewHash});
  assert(bootstrap.projectBusy(), 'Setup mutations were outside the project lock');
  assert(fs.existsSync(path.join(root, '.storage-operation-lock/operation.json')), 'Setup omitted the shared native storage lease');
  let job = await wait(pending);
  assert(!bootstrap.projectBusy());
  assert(!fs.existsSync(path.join(root, '.storage-operation-lock')), 'Completed setup retained its storage lease');
  assert.equal(job.phase, 'waiting-build', JSON.stringify(job)); assert.equal(registered, 1); assert.equal(transfers, 1); assert.equal(revoked, 1);
  assert.equal(adoptionCalls + activated, 0, 'Pending CI became accepted previews');
  assert(!fs.readFileSync(path.join(root, 'preview-setup.json'), 'utf8').includes('fixture-transfer-secret'), 'Transfer token leaked into resumable state');
  const beforeReads = reads; setup.previewSetupStatus(); assert.equal(reads, beforeReads, 'Status queried GitLab');
  pipelineStatus = 'success'; requiredStatus = 'failed';
  plan = await setup.preflightPreviewSetup({settings: desired});
  job = await wait(setup.applyPreviewSetup({settings: desired, previewHash: plan.previewHash}));
  assert.equal(job.state, 'failed'); assert.equal(adoptionCalls + activated, 0, 'Failed required CI became accepted previews');
  requiredStatus = 'success';
  plan = await setup.preflightPreviewSetup({settings: desired});
  job = await wait(setup.applyPreviewSetup({settings: desired, previewHash: plan.previewHash}));
  assert.equal(job.phase, 'ready'); assert.equal(job.previewUrl, 'https://review.example.test');
  assert.equal(registered, 1); assert.equal(transfers, 1); assert.equal(revoked, 1, 'Resumption repeated source transfer');
  assert.equal(adoptionCalls, 1); assert.equal(activated, 1);
  assert.equal(fs.readFileSync(main, 'utf8'), originalMain, 'Preview setup changed Production');
  assert.equal(setup.previewSetupStatus().phase, 'ready');
  await assert.rejects(setup.preflightPreviewSetup({settings: {...desired, namespace: 'other'}}), /different setup/);
  for (const mode of ['missing-pipeline', 'uncertain-project', 'uncertain-environment', 'uncertain-push', 'uncertain-push-revoke-failed', 'settled-project', 'replaced-storage', 'replaced-preview']) {
    const output = require('child_process').execFileSync(process.execPath, [__filename], {env: {...process.env, PREVIEW_SETUP_FAILURE_FIXTURE: mode}, encoding: 'utf8', timeout: 30000});
    assert(output.includes('regression passed: ' + mode), output);
  }
  console.log('Preview setup workflow: inert status/preflight, explicit hash, scoped secret lifetime, pending/failed native CI refusal, resumable exact project identity, canonical adoption, native environment reuse and unchanged Production passed.');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => fs.rmSync(root, {recursive: true, force: true}));
