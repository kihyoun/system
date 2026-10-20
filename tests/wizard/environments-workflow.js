const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const source = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-environments-'));
fs.mkdirSync(path.join(root, 'sync'));
fs.mkdirSync(path.join(root, 'system/.projects.env'), {recursive: true});
process.chdir(path.join(root, 'sync'));
const bootstrap = require(path.join(source, 'sync/dist/ProjectBootstrap'));
const {wizardConfiguration, wizardCi, ensureDefaultWizard} = require(path.join(source, 'sync/dist/DefaultWizard'));
const Helper = require(path.join(source, 'sync/dist/Helper')).default;
const env = require(path.join(source, 'sync/dist/WizardEnvironments'));
const certificateAdapter = env.environmentAdapters.certificate;
const tlsFixture = path.join('/ssl', 'wizard-environment-fixture-' + process.pid);
const builds = require(path.join(source, 'sync/dist/WizardBuild'));
const legacy = require(path.join(source, 'project-bootstrap/wizard-build/recipe')).generate(Helper.textLogo);
const file = path.join(root, 'system/.projects.env/.wizard.env');
const mainFile = path.join(root, 'system/.docker.env');
const platform = {WIZARD_HOST: 'production.example', WIZARD_ENABLE: 'true'};
const main = Helper.textLogo + 'WIZARD_HOST="production.example"\nWIZARD_ENABLE="true"\nBOOTSTRAPPER_IP="172.18.0.3"\nGITLAB_REGISTRY_URL="https://registry.example"\nGITLAB_REGISTRY_DOMAIN_MODE="2"\n';
const data = wizardConfiguration(platform);
const build = {version: 1, operation: 'b'.repeat(48), recipeHash: legacy.recipeHash, phase: 'candidate-verified',
  activationCommit: 'b'.repeat(40), pipeline: {id: 8, sha: 'b'.repeat(40), status: 'success'},
  artifact: {imageRef: 'registry.example/root/wizard@sha256:' + 'e'.repeat(64), sourceCommit: 'b'.repeat(40), pipelineId: 8}};
const baseReceipt = {operation: 'registration', namespaceId: 1, defaultProject: true, template: 'wizard', state: 'complete',
  repository: {id: 99, path: 'root/wizard', defaultBranch: 'main', systemProject: true,
    ciPath: '.system-bootstrapper/ci.yml', generatedCi: wizardCi()},
  wizardWorkflow: {version: 1, operation: 'source', sourceRevision: 'c'.repeat(40), manifestHash: 'd'.repeat(64),
    importCommit: 'a'.repeat(40), phase: 'source-imported', build}};
const clone = value => JSON.parse(JSON.stringify(value));
const saved = () => bootstrap.readReceipt(fs.readFileSync(file, 'utf8'));
const reset = () => {fs.writeFileSync(mainFile, main); bootstrap.writeReceipt(file, data, clone(baseReceipt));};
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE = 'sha256:' + 'f'.repeat(64);
process.env.SYSTEM_WIZARD_CANONICAL_CONTROLLER = 'system_bootstrapper_1';
let calls = 0, applied = 0, dns = 0, certificates = 0, input, finish;
env.environmentAdapters.resolve = async host => {dns++; assert(host.endsWith('.example')); return ['203.0.113.1'];};
env.environmentAdapters.certificate = async (host, cert, key) => {certificates++; assert(host !== 'production.example'); assert(cert.startsWith('/ssl/')); assert(key.startsWith('/ssl/'));};
env.environmentAdapters.applyRoutes = async () => {applied++;};
env.environmentAdapters.recipe = (_, value) => ({version: 1, recipeHash: hash(value), ci: 'fixture managed CI', files: []});
bootstrap.rails = value => {calls++; input = value; return new Promise(resolve => {finish = resolve;});};
const tick = () => new Promise(resolve => setTimeout(resolve, 2));
const wait = async job => {for (let i = 0; job.state === 'running' && i < 1000; i++) await tick(); assert.notEqual(job.state, 'running'); return job;};
const railStarted = async expected => {for (let i = 0; calls < expected && i < 1000; i++) await tick(); assert.equal(calls, expected);};
const enabled = preview => {const settings = clone(preview.settings); settings.review.enabled = true; settings.beta.enabled = true; return settings;};
const installed = () => ({environments: {...input.environments, activationCommit: '9'.repeat(40), phase: 'recipe-installed'}, message: 'Fixture installed'});
(async () => {
  fs.mkdirSync(tlsFixture, {recursive: true, mode: 0o700});
  const certificate = path.join(tlsFixture, 'certificate.pem'), privateKey = path.join(tlsFixture, 'key.pem');
  require('child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', privateKey, '-out', certificate, '-days', '1', '-subj', '/CN=review.production.example',
    '-addext', 'subjectAltName=DNS:review.production.example'], {stdio: 'ignore', timeout: 15000});
  await certificateAdapter('review.production.example', certificate, privateKey);
  await assert.rejects(() => certificateAdapter('beta.production.example', certificate, privateKey), /exact HTTPS/);
  const otherKey = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'}).privateKey.export({type: 'pkcs8', format: 'pem'});
  fs.writeFileSync(path.join(tlsFixture, 'other-key.pem'), otherKey, {mode: 0o600});
  await assert.rejects(() => certificateAdapter('review.production.example', certificate, path.join(tlsFixture, 'other-key.pem')), /do not match/);
  fs.writeFileSync(path.join(tlsFixture, 'malformed-key.pem'), 'not a private key', {mode: 0o600});
  await assert.rejects(() => certificateAdapter('review.production.example', certificate, path.join(tlsFixture, 'malformed-key.pem')));
  reset();
  assert.equal(env.refreshWizardEnvironments().state, 'not-activated');
  let preview = env.previewWizardEnvironments();
  assert(preview.capabilities.canActivate); assert(!preview.capabilities.canUpdate);
  assert.equal(preview.capabilities.reviewLease, 'single-active-mr');
  assert.equal(preview.capabilities.productionDeployment, false);
  assert.equal(calls + dns + certificates + applied, 0, 'preview/status-idle must have no external side effects');
  assert(!JSON.stringify(preview).includes('RUN npm'));
  let settings = enabled(preview);
  assert.throws(() => env.configureWizardEnvironments({previewHash: 'stale', settings}), /fresh/);
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: {...settings, production: {}}}), /explicit/);
  const collision = clone(settings); collision.review.host = 'production.example';
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: collision}), /conflicts/);
  const traversal = clone(settings); traversal.review.ssl = '/ssl/../secret';
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: traversal}), /within/);
  const wildcard = clone(settings); wildcard.review.host = '*.review.example';
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: wildcard}), /exact/);
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings, helperImage: 'evil'}), /server-owned/);
  const leakedImage = {...settings, helperImage: 'evil'};
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: leakedImage}), /explicit/);
  const nonHttps = clone(settings); nonHttps.review.domainMode = 1;
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: nonHttps}), /HTTPS/);
  fs.mkdirSync(file + '.environments.lock');
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings}), /configuration lock/);
  fs.rmdirSync(file + '.environments.lock');
  let release;
  const other = bootstrap.withProjectLock('other', () => bootstrap.startJob('other', () => new Promise(resolve => {release = resolve;})));
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings}), /Another/);
  release({}); await wait(other);
  const started = env.configureWizardEnvironments({previewHash: preview.previewHash, settings});
  assert(bootstrap.projectBusy()); assert.equal(env.configureWizardEnvironments({previewHash: preview.previewHash, settings}), started);
  assert.equal(env.refreshWizardEnvironments(), started);
  const changed = clone(settings); changed.review.host = 'other.example';
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: changed}), /different settings/);
  await railStarted(1);
  assert.equal(input.action, 'wizard-environments');
  assert.equal(input.registryPrefix, 'registry.example/root/wizard');
  assert.equal(input.controller, 'system_bootstrapper_1');
  assert.equal(input.environments.helperImage, process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE);
  assert.equal(input.build.artifact.sourceCommit, build.activationCommit);
  assert.equal(certificates, 2);
  assert.equal(fs.readFileSync(mainFile, 'utf8'), main);
  // Simulate a helper checkpoint arriving while Rails is in flight.
  let receipt = saved();
  receipt.wizardWorkflow.environments.deployments = {review: {pending: {pipelineId: 10}}};
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^# BOOTSTRAPPER_PROJECT=.*$/m, '# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify(receipt)).toString('base64')));
  finish(installed()); await wait(started); assert.equal(started.state, 'complete', started.message);
  assert.equal(started.environments.phase, 'ready'); assert.equal(applied, 0);
  assert.equal(started.environments.deployments.review.pending.pipelineId, 10);
  receipt = saved();
  assert.deepEqual(receipt.wizardWorkflow.build, build, 'Phase B receipt must remain intact');
  assert.equal(receipt.wizardWorkflow.importCommit, baseReceipt.wizardWorkflow.importCommit);
  let rendered = fs.readFileSync(file, 'utf8');
  assert(rendered.includes('PROD_HOST="production.example"'));
  assert(rendered.includes('USE_REVIEW_HOST="true"'));
  assert.equal(rendered[807], '$');
  assert.equal(crypto.createHash('md5').update(rendered.slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
  assert.equal(builds.previewWizardBuild().build.phase, 'historical');
  assert.match(builds.previewWizardBuild().build.message, /historical.*environment/i);
  assert.equal(builds.refreshWizardBuild().state, 'historical');
  assert.throws(() => builds.activateWizardBuild({recipeHash: legacy.recipeHash}), /disabled/);
  assert.equal(calls, 1, 'Historical Phase B refresh must not invoke v1 Rails checks');
  preview = env.previewWizardEnvironments(); assert(!preview.capabilities.canUpdate);
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: changed}), /Stop/);
  // Startup re-registers Production without dropping optional server-owned settings or receipts.
  bootstrap.createProject = () => ({state: 'complete', repository: receipt.repository});
  const beforeStartup = clone(saved().wizardWorkflow);
  fs.mkdirSync(file + '.environments.lock');
  await assert.rejects(() => ensureDefaultWizard(), /configuration lock/);
  fs.rmdirSync(file + '.environments.lock');
  assert.deepEqual(saved().wizardWorkflow, beforeStartup);
  await ensureDefaultWizard();
  assert.deepEqual(saved().wizardWorkflow, beforeStartup);
  assert(fs.readFileSync(file, 'utf8').includes('USE_REVIEW_HOST="true"'));
  // Clear the exact fixture lease to permit a reviewed settings update.
  receipt = saved(); receipt.wizardWorkflow.environments.deployments = {};
  bootstrap.writeReceipt(file, fs.readFileSync(file, 'utf8').split('\n').filter(line => !line.startsWith('# BOOTSTRAPPER_PROJECT=')).join('\n'), receipt);
  preview = env.previewWizardEnvironments(); assert(preview.capabilities.canUpdate);
  const oldOperation = preview.environments.operation;
  const updated = env.configureWizardEnvironments({previewHash: preview.previewHash, settings: changed});
  await railStarted(2);
  assert.notEqual(input.environments.operation, oldOperation);
  assert.equal(input.previousEnvironments.operation, oldOperation);
  assert(input.previousRecipe.recipeHash);
  const pendingWorkflow = clone(saved().wizardWorkflow);
  await ensureDefaultWizard();
  assert.deepEqual(saved().wizardWorkflow, pendingWorkflow);
  assert(fs.readFileSync(file, 'utf8').includes('REVIEW_HOST="review.production.example"'), 'Startup must retain previously installed routing during a pending update');
  finish(installed()); await wait(updated);
  assert.equal(updated.state, 'failed', 'A concurrent startup writer must trigger the content guard');
  const retryPreview = env.previewWizardEnvironments();
  const resumed = env.configureWizardEnvironments({previewHash: retryPreview.previewHash, settings: changed});
  await railStarted(3);
  assert.equal(input.environments.operation, updated.id, 'Recovery must retain the reserved update operation');
  finish(installed()); await wait(resumed);
  assert.equal(resumed.state, 'complete', resumed.message);
  assert(fs.readFileSync(file, 'utf8').includes('REVIEW_HOST="other.example"'));
  // Status is an inspection, not another route install or preflight.
  const beforeStatus = {dns, certificates, applied};
  const status = env.refreshWizardEnvironments(); await railStarted(4);
  assert.equal(input.action, 'wizard-environments-status'); finish({environments: {...input.environments, phase: 'recipe-installed'}, message: 'Inspected'}); await wait(status);
  assert.equal(status.environments.phase, 'ready', 'Ruby-shaped read-only status must retain helper-ready state');
  assert.equal(saved().wizardWorkflow.environments.phase, 'ready');
  assert.deepEqual({dns, certificates, applied}, beforeStatus);
  // Uncertain external outcome retains the same operation and never creates another one.
  bootstrap.rails = async () => {throw new Error('Safe interrupted fixture');};
  const failed = env.refreshWizardEnvironments(); await wait(failed);
  assert.equal(failed.state, 'failed'); assert.equal(saved().wizardWorkflow.environments.phase, 'verification-failed');
  assert.equal(saved().wizardWorkflow.environments.operation, resumed.environments.operation);
  // Failed reconciliation must never become a resumable ordinary failure.
  receipt = saved(); receipt.wizardWorkflow.environments.phase = 'requires-reconciliation';
  delete receipt.wizardWorkflow.environments.activationCommit;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^# BOOTSTRAPPER_PROJECT=.*$/m,
    '# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify(receipt)).toString('base64')));
  const uncertain = env.refreshWizardEnvironments(); await wait(uncertain);
  assert.equal(uncertain.state, 'failed');
  assert.equal(saved().wizardWorkflow.environments.phase, 'requires-reconciliation');
  preview = env.previewWizardEnvironments(); assert(!preview.capabilities.canActivate); assert(!preview.capabilities.canUpdate);
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: preview.settings}), /Reconcile/);
  assert.match(builds.previewWizardBuild().build.message, /historical/);
  // A concurrent non-deployment edit must survive all completion/failure paths.
  bootstrap.rails = value => {input = value; return new Promise(resolve => {finish = resolve;});};
  const conflict = env.refreshWizardEnvironments(); fs.appendFileSync(file, '# external edit\n');
  finish({environments: input.environments}); await wait(conflict);
  assert.equal(conflict.state, 'failed'); assert(fs.readFileSync(file, 'utf8').endsWith('# external edit\n'));
  // A disabled/missing verified build blocks first enable.
  reset(); receipt = saved(); receipt.wizardWorkflow.build.phase = 'checks-failed'; bootstrap.writeReceipt(file, data, receipt);
  preview = env.previewWizardEnvironments(); assert(!preview.capabilities.canActivate);
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: enabled(preview)}), /Phase B/);
  reset(); delete process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE;
  preview = env.previewWizardEnvironments(); assert(!preview.capabilities.canActivate);
  assert.throws(() => env.configureWizardEnvironments({previewHash: preview.previewHash, settings: enabled(preview)}), /immutable/);
  process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE = 'sha256:' + 'f'.repeat(64);
  // DNS must match public Production DNS, never the private BOOTSTRAPPER_IP.
  reset(); env.environmentAdapters.resolve = async host => host === 'production.example' ? ['203.0.113.1'] : ['172.18.0.3'];
  preview = env.previewWizardEnvironments(); const badDns = env.configureWizardEnvironments({previewHash: preview.previewHash, settings: enabled(preview)});
  await wait(badDns); assert.equal(badDns.state, 'failed'); assert(badDns.message.includes('DNS'));
  assert.equal(saved().wizardWorkflow.environments, undefined, 'Local validation must not reserve durable settings');
  assert.equal(builds.previewWizardBuild().build.phase, 'candidate-verified');
  assert.equal(builds.previewWizardBuild().build.historical, undefined);
  let externalCalls = 0;
  bootstrap.rails = async value => {externalCalls++; return {environments: {...value.environments, phase: 'recipe-installed',
    activationCommit: '8'.repeat(40)}, message: 'Fixture installed'};};
  env.environmentAdapters.resolve = async () => ['203.0.113.1'];
  env.environmentAdapters.certificate = async () => {throw Error('Synthetic certificate is invalid');};
  preview = env.previewWizardEnvironments();
  const invalidCertificate = env.configureWizardEnvironments({previewHash: preview.previewHash, settings: enabled(preview)});
  await wait(invalidCertificate); assert.equal(invalidCertificate.state, 'failed');
  assert.equal(saved().wizardWorkflow.environments, undefined); assert.equal(externalCalls, 0);
  // Corrected local settings are immediately reviewable without a repair operation.
  env.environmentAdapters.certificate = async () => {};
  preview = env.previewWizardEnvironments(); settings = enabled(preview); settings.review.host = 'corrected.example';
  const corrected = env.configureWizardEnvironments({previewHash: preview.previewHash, settings});
  await wait(corrected); assert.equal(corrected.state, 'complete', corrected.message); assert.equal(externalCalls, 1);
  assert.equal(corrected.environments.settings.review.host, 'corrected.example');
  assert.equal(corrected.environments.externalAttempted, true);
  // A config change while local DNS is in flight must prevent reservation and Rails.
  reset(); externalCalls = 0;
  let resolveDns;
  env.environmentAdapters.resolve = host => host === 'production.example'
    ? new Promise(resolve => {resolveDns = resolve;}) : Promise.resolve(['203.0.113.1']);
  preview = env.previewWizardEnvironments();
  const validating = env.configureWizardEnvironments({previewHash: preview.previewHash, settings: enabled(preview)});
  assert.equal(saved().wizardWorkflow.environments, undefined);
  assert.equal(builds.previewWizardBuild().build.phase, 'candidate-verified');
  fs.appendFileSync(mainFile, '# changed during local preflight\n');
  resolveDns(['203.0.113.1']); await wait(validating);
  assert.equal(validating.state, 'failed'); assert.match(validating.message, /changed during local validation/);
  assert.equal(saved().wizardWorkflow.environments, undefined); assert.equal(externalCalls, 0);
  // A source-primary project keeps the same authenticated dialog without a managed CI commit.
  reset();
  const nativeSettings = enabled(env.previewWizardEnvironments());
  const nativeFiles = ['.gitlab/primary.yml', '.gitlab/delivery/environment.sh'].map(path => ({path, sha256: '5'.repeat(64)}));
  const nativeEnvironment = require(path.join(source, 'project-bootstrap/wizard-environments/source-primary')).sourcePrimaryEnvironment(
    {phase: 'ready', operation: '1'.repeat(48), settings: nativeSettings, settingsHash: hash(nativeSettings),
      deployments: {review: {lastPipelineId: 43, stoppedThroughPipelineId: 43}, beta: {lastPipelineId: 44, stoppedThroughPipelineId: 44}}},
    {operation: '2'.repeat(48), helperImage: process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE,
      activationCommit: '3'.repeat(40), ciFiles: nativeFiles});
  receipt = clone(baseReceipt);
  receipt.repository = {...receipt.repository, id: 5, path: 'group/wizard', namespaceId: 3,
    managementMode: 'source-primary', ciPath: '.gitlab/primary.yml'};
  receipt.namespaceId = 3;
  receipt.sourcePrimary = {version: 1, adoptionCommit: '3'.repeat(40), ciFiles: nativeFiles};
  receipt.wizardWorkflow = {version: 1, phase: 'source-primary', sourceRevision: '3'.repeat(40),
    build: {...build, mode: 'source-primary'}, environments: nativeEnvironment};
  bootstrap.writeReceipt(file, data, receipt);
  env.environmentAdapters.resolve = async () => ['203.0.113.1'];
  bootstrap.rails = async value => {
    input = value;
    assert(['wizard-environments-primary', 'wizard-environments-primary-status'].includes(value.action));
    assert.deepEqual(value.sourcePrimary, receipt.sourcePrimary);
    assert.equal(value.legacyRecipe, undefined, 'Native settings must not install a managed legacy recipe');
    return {environments: {...value.environments, phase: 'ready'}, message: 'Native settings verified'};
  };
  receipt.wizardWorkflow.build.pipeline.status = 'failed';
  receipt.wizardWorkflow.build.publishing = {mirrorFailed: true, status: 'failed'};
  bootstrap.writeReceipt(file, data, receipt);
  preview = env.previewWizardEnvironments(); assert(preview.capabilities.canUpdate, 'Publisher-only failure blocked native settings');
  const nativeChanged = clone(nativeSettings); nativeChanged.review.host = 'new-native.example';
  const nativeUpdate = env.configureWizardEnvironments({previewHash: preview.previewHash, settings: nativeChanged});
  await wait(nativeUpdate); assert.equal(nativeUpdate.state, 'complete', nativeUpdate.message);
  assert.equal(input.action, 'wizard-environments-primary');
  assert.equal(nativeUpdate.environments.managementMode, 'source-primary');
  assert.equal(saved().wizardWorkflow.environments.deployments.review.stoppedThroughPipelineId, 43);
  assert.equal(saved().wizardWorkflow.environments.deployments.beta.stoppedThroughPipelineId, 44);
  assert(fs.readFileSync(file, 'utf8').includes('REVIEW_HOST="new-native.example"'));
  const nativeStatus = env.refreshWizardEnvironments(); await wait(nativeStatus);
  assert.equal(nativeStatus.state, 'complete', nativeStatus.message);
  assert.equal(input.action, 'wizard-environments-primary-status');
  console.log('Wizard environments workflow: explicit preview, immutable operation identity, HTTPS/DNS guards, singleton lease/update guard, helper-lock/CAS merging, interrupted recovery, startup preservation and historical Phase B passed.');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {process.chdir(source); fs.rmSync(root, {recursive: true, force: true}); fs.rmSync(tlsFixture, {recursive: true, force: true});});

