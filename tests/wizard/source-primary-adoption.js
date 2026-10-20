'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Adoption} = require('../../project-bootstrap/wizard-source-primary/run');
const b = require('../../project-bootstrap/wizard-source-primary/binding');
const {readConfiguration} = require('../../project-bootstrap/wizard-upgrade/run');
const {projectForImage} = require('../../system/wizard-image-recovery');
const logo = require('../../sync/dist/Helper').default.textLogo;
const recipe = require('../../project-bootstrap/wizard-build/recipe').generate(logo, 'node24-vite8-overview-v3');
const env = require('../../project-bootstrap/wizard-environments/source-primary');
const sha = 'a'.repeat(40), image = 'registry.example.test/team/system-wizard@sha256:' + 'b'.repeat(64);
const oldImage = 'registry.example.test/root/wizard@sha256:' + 'c'.repeat(64), helperImage = 'sha256:' + 'd'.repeat(64);
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-source-primary-'));
  const config = path.join(root, '.projects.env/.wizard.env'), mainConfig = path.join(root, '.docker.env'), directory = path.join(root, 'adoption');
  fs.mkdirSync(path.dirname(config));
  const settings = Object.fromEntries(['review', 'beta'].map(kind => [kind, {enabled: false, host: kind + '.example.test', domainMode: 2,
    ssl: '/ssl/live/' + kind + '/fullchain.pem', sslKey: '/ssl/live/' + kind + '/privkey.pem'}]));
  const tombstone = {projectId: 1, pipelineId: 23, jobId: 40, state: 'stopped', operation: '0'.repeat(48)};
  const receipt = {defaultProject: true, template: 'wizard', state: 'complete', operation: '1'.repeat(48), namespaceId: 1,
    repository: {id: 1, namespaceId: 1, path: 'root/wizard', defaultBranch: 'main', ciPath: '.system-bootstrapper/ci.yml', systemProject: true},
    wizardWorkflow: {version: 1, importCommit: '2'.repeat(40), build: {version: 1, recipeHash: recipe.recipeHash}, environments: {
      version: 1, phase: 'ready', operation: '3'.repeat(48), settings, settingsHash: b.hash(JSON.stringify(settings)), helperImage, controller: 'system_bootstrapper_1',
      deployments: {review: {lastPipelineId: 23, stoppedThroughPipelineId: 23, tombstone}, beta: {lastPipelineId: 24, stoppedThroughPipelineId: 24}}}}};
  const text = logo + '\n# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify(receipt)).toString('base64') + '\n';
  fs.writeFileSync(config, text);
  fs.writeFileSync(mainConfig, logo + "\nexport GITLAB_HOST='gitlab.example.test'\nexport GITLAB_REGISTRY_URL='https://registry.example.test'\nexport GITLAB_REGISTRY_DOMAIN_MODE='2'\nexport WIZARD_IMAGE='" + oldImage + "'\n");
  const scripts = [...recipe.files, {path: b.CI, content: '# native CI\n'}, {path: '.gitlab/delivery/environment.sh', content: fs.readFileSync(path.resolve(__dirname, '../../project-bootstrap/wizard-environments/source-primary.sh'), 'utf8')}];
  const input = {version: 1, projectId: 7, projectPath: 'team/system-wizard', namespaceId: 9, defaultBranch: 'master', pipelineId: 31, sourceCommit: sha,
    imageRef: image, helperImage, ciFiles: scripts.map(file => ({path: file.path, sha256: b.hash(file.content)}))};
  const rows = {
    'projects/1': {id: 1, namespace: {id: 1}, path_with_namespace: 'root/wizard', visibility: 'private', description: 'System Bootstrapper operation ' + receipt.operation, ci_config_path: '.system-bootstrapper/ci.yml'},
    'projects/7': {id: 7, namespace: {id: 9}, path_with_namespace: input.projectPath, default_branch: 'master', visibility: 'private', ci_config_path: b.CI,
      only_allow_merge_if_pipeline_succeeds: true, only_allow_merge_if_all_discussions_are_resolved: true},
    'projects/7/repository/branches/master': {commit: {id: sha}},
    'projects/7/pipelines/31': {id: 31, sha, ref: 'master', source: 'push', status: 'success', web_url: 'https://gitlab.example.test/pipeline'},
    'projects/7/pipelines/31/jobs?per_page=100&include_retried=false': ['build:wizard', 'test:wizard', 'build:source', 'test:browser'].map((name, index) => ({name, id: index + 40,
      status: 'success', allow_failure: false, commit: {id: sha}, pipeline: {id: 31}})),
    'projects/7/jobs/40/artifacts/build-evidence.json': {version: 1, sourceCommit: sha, pipelineId: 31, imageRef: image,
      testRunner: 'vitest', unitTests: true, lint: true, typecheck: true, productionBuild: true},
    'projects/7/jobs/41/artifacts/wizard-evidence.json': {version: 1, sourceCommit: sha, pipelineId: 31, imageRef: image,
      http: true, renderedUI: true, projects: true, spa: true, configurationBackup: true, cubeSignature: true}
  };
  for (const file of scripts) rows['projects/7/repository/files/' + encodeURIComponent(file.path) + '?ref=' + sha] = {content: Buffer.from(file.content).toString('base64')};
  const calls = [];
  const request = async route => {calls.push(route); assert(Object.hasOwn(rows, route), 'Unexpected mutation or lookup: ' + route); return JSON.parse(JSON.stringify(rows[route]));};
  return {root, config, mainConfig, directory, receipt, text, input, rows, calls, adoption: new Adoption({config, mainConfig, directory, request, environments: env.sourcePrimaryEnvironment})};
}
async function use(run) { const f = fixture(); try {await run(f);} finally {fs.rmSync(f.root, {recursive: true, force: true});} }
(async () => {
  await use(async f => {
    const plan = await f.adoption.plan(f.input);
    assert.equal(fs.readFileSync(f.config, 'utf8'), f.text); assert(!fs.existsSync(f.directory), 'Preview wrote private state');
    assert.equal(plan.next.repository.id, 7); assert.equal(plan.next.repository.path, 'team/system-wizard');
    assert.equal(plan.next.wizardWorkflow.environments.deployments.review.stoppedThroughPipelineId, 23);
    assert(!plan.next.wizardWorkflow.environments.deployments.review.tombstone, 'Retired project tombstone was rewritten into the new active project');
    await assert.rejects(f.adoption.apply(f.input, 'stale'), /Preview/);
    assert.equal(fs.readFileSync(f.config, 'utf8'), f.text);
    const result = await f.adoption.apply(f.input, plan.planHash);
    assert.equal(result.phase, 'source-primary');
    const archived = JSON.parse(fs.readFileSync(path.join(f.directory, result.operation + '.json'), 'utf8'));
    assert.deepEqual(archived.previousReceipt, f.receipt); assert.equal(archived.previousConfiguration, f.text);
    assert.equal(fs.statSync(path.join(f.directory, result.operation + '.json')).mode & 0o077, 0);
    const saved = b.read(f.config); b.validate(saved.receipt); assert.equal(saved.text.slice(0, 1184), f.text.slice(0, 1184));
    assert.equal(projectForImage(saved.text, oldImage, 'https://registry.example.test').projectId, 1);
    assert.equal(projectForImage(saved.text, image, 'https://registry.example.test').projectId, 7);
    assert.throws(() => projectForImage(saved.text, oldImage.replace('c'.repeat(64), 'e'.repeat(64)), 'https://registry.example.test'), /does not belong/);
    assert.throws(() => readConfiguration(f.config), /Source-primary/);
    assert.equal((await f.adoption.apply(f.input, plan.planHash)).unchanged, true);
    process.env.SYSTEM_CONFIG_DIR = f.root;
    fs.appendFileSync(f.mainConfig, "export WIZARD_ENABLE='true'\nexport WIZARD_HOST='ui.example.test'\nexport WIZARD_DOMAIN_MODE='2'\n");
    const bootstrap = require('../../sync/dist/ProjectBootstrap');
    let calls = 0;
    bootstrap.rails = async input => {
      calls++; assert.equal(input.action, 'wizard-source-primary-status'); assert.equal(input.repository.id, 7);
      return {sourceRevision: sha, build: b.read(f.config).receipt.wizardWorkflow.build, message: 'Fixture native evidence'};
    };
    assert.equal((await require('../../sync/dist/DefaultWizard').ensureDefaultWizard()).repository.id, 7);
    assert.equal(calls, 0, 'Restart tried to recreate or import a second Wizard project');
    const workflow = require('../../sync/dist/WizardWorkflow');
    assert.equal(workflow.previewWizardSource().canInitialize, false);
    assert.throws(() => workflow.initializeWizardSource({}), /Source import is disabled/);
    const build = require('../../sync/dist/WizardBuild');
    assert.equal(build.previewWizardBuild().mode, 'source-primary');
    assert.throws(() => build.activateWizardBuild({}), /native repository pipelines/);
    const job = build.refreshWizardBuild();
    while (job.state === 'running') await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(job.state, 'complete'); assert.equal(calls, 1);
    assert.equal(b.read(f.config).receipt.repository.id, 7);
    delete process.env.SYSTEM_CONFIG_DIR;
  });
  await use(async f => {
    f.rows['projects/7/pipelines/31'].status = 'failed';
    f.rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'].push({name: 'deploy:github', id: 44, status: 'failed', allow_failure: false, commit: {id: sha}, pipeline: {id: 31}});
    const plan = await f.adoption.plan(f.input);
    assert.equal(plan.next.wizardWorkflow.build.publishing.mirrorFailed, true);
  });
  for (const status of ['pending', 'running', 'canceled']) await use(async f => {
    f.rows['projects/7/pipelines/31'].status = status;
    f.rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'].push({name: 'deploy:github', id: 44, status, allow_failure: false, commit: {id: sha}, pipeline: {id: 31}});
    const plan = await f.adoption.plan(f.input); assert.equal(plan.next.wizardWorkflow.build.publishing.status, status);
  });
  await use(async f => {
    const initial = await f.adoption.plan(f.input); await f.adoption.apply(f.input, initial.planHash);
    fs.writeFileSync(f.mainConfig, fs.readFileSync(f.mainConfig, 'utf8').replace(oldImage, image));
    const updated = {...f.input, helperImage: 'sha256:' + 'e'.repeat(64)};
    const plan = await f.adoption.plan(updated);
    assert.notEqual(plan.publicPlan.operation, initial.publicPlan.operation);
    assert.equal(plan.next.repository.id, 7);
    assert.equal(plan.next.wizardWorkflow.environments.deployments.review.stoppedThroughPipelineId, 23);
    assert.deepEqual(plan.next.wizardWorkflow.environments.historicalDeployments[0].deployments, f.receipt.wizardWorkflow.environments.deployments);
    await f.adoption.apply(updated, plan.planHash);
    assert.equal(fs.readdirSync(f.directory).length, 2, 'A reviewed same-project binding update discarded the old private archive');
    await assert.rejects(f.adoption.plan({...updated, projectId: 8}), /canonical repository identity/);
  });
  for (const change of [
    f => {f.rows['projects/7'].visibility = 'public';},
    f => {f.rows['projects/7'].namespace.id = 8;},
    f => {f.rows['projects/7'].only_allow_merge_if_pipeline_succeeds = false;},
    f => {f.rows['projects/7'].only_allow_merge_if_all_discussions_are_resolved = false;},
    f => {f.rows['projects/7/pipelines/31'].source = 'api';},
    f => {f.rows['projects/7/pipelines/31'].status = 'canceled';},
    f => {f.rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'][2].status = 'failed';},
    f => {f.rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'][3].status = 'skipped';},
    f => {f.rows['projects/7/pipelines/31'].status = 'failed';},
    f => {f.rows['projects/7/pipelines/31'].status = 'failed'; f.rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'].push({name: 'fake:mirror', status: 'failed', allow_failure: false});},
    f => {f.rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'][0].allow_failure = true;},
    f => {f.rows['projects/7/jobs/41/artifacts/wizard-evidence.json'].cubeSignature = false;},
    f => {f.rows['projects/7/jobs/40/artifacts/build-evidence.json'].imageRef = oldImage;},
    f => {f.rows['projects/7/repository/branches/master'].commit.id = 'e'.repeat(40);},
    f => {f.rows['projects/1'].description = 'unrelated';},
    f => {f.input.ciFiles = f.input.ciFiles.slice(1);}
  ]) await use(async f => {change(f); await assert.rejects(f.adoption.plan(f.input)); assert.equal(fs.readFileSync(f.config, 'utf8'), f.text);});
  await use(async f => {
    const plan = await f.adoption.plan(f.input); fs.appendFileSync(f.config, '# Concurrent operator edit\n');
    await assert.rejects(f.adoption.apply(f.input, plan.planHash), /Preview/);
    assert(fs.readFileSync(f.config, 'utf8').endsWith('# Concurrent operator edit\n'));
  });
  await use(async f => {
    const plan = await f.adoption.plan(f.input); fs.mkdirSync(f.adoption.lock);
    await assert.rejects(f.adoption.apply(f.input, plan.planHash), /EEXIST/);
    assert.equal(fs.readFileSync(f.config, 'utf8'), f.text);
  });
  console.log('Source-primary adoption: exact ownership/native evidence, preserved private history/floors, CAS, shared mutex, idempotency, import guard and exact rollback image alias passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
