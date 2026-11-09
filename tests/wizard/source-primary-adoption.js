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
const builds = require('../../project-bootstrap/wizard-build/recipe');
const env = require('../../project-bootstrap/wizard-environments/source-primary');
const sha = 'a'.repeat(40), image = 'registry.example.test/team/system-wizard@sha256:' + 'b'.repeat(64);
const oldImage = 'registry.example.test/root/wizard@sha256:' + 'c'.repeat(64), helperImage = 'sha256:' + 'd'.repeat(64);
const publicImage = 'docker.io/example/wizard@sha256:' + '9'.repeat(64);
function fixture(profile = 'node24-vite8-overview-v3') {
  const recipe = builds.generate(logo, profile);
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
async function use(run, profile) { const f = fixture(profile); try {await run(f);} finally {fs.rmSync(f.root, {recursive: true, force: true});} }
async function buildUpdate(f, profile = 'node24-vite8-ca-v4') {
  const initial = await f.adoption.plan(f.input);
  await f.adoption.apply(f.input, initial.planHash);
  fs.writeFileSync(f.mainConfig, fs.readFileSync(f.mainConfig, 'utf8').replace(oldImage, image));
  const target = builds.generate(logo, profile), sourceCommit = 'e'.repeat(40), pipelineId = 32;
  const imageRef = image.replace('b'.repeat(64), 'f'.repeat(64));
  const scripts = [...target.files, {path: b.CI, content: '# reviewed native CI\n'},
    {path: '.gitlab/delivery/environment.sh', content: fs.readFileSync(path.resolve(__dirname, '../../project-bootstrap/wizard-environments/source-primary.sh'), 'utf8')}];
  const input = {...f.input, sourceCommit, pipelineId, imageRef, buildProfile: target.profile,
    ciFiles: scripts.map(file => ({path: file.path, sha256: b.hash(file.content)}))};
  f.rows['projects/7/repository/branches/master'].commit.id = sourceCommit;
  f.rows['projects/7/pipelines/32'] = {...f.rows['projects/7/pipelines/31'], id: pipelineId, sha: sourceCommit};
  f.rows['projects/7/pipelines/32/jobs?per_page=100&include_retried=false'] = f.rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false']
    .map(row => ({...row, commit: {id: sourceCommit}, pipeline: {id: pipelineId}}));
  for (const file of ['build-evidence.json', 'wizard-evidence.json']) {
    const route = 'projects/7/jobs/' + (file === 'build-evidence.json' ? 40 : 41) + '/artifacts/' + file;
    f.rows[route] = {...f.rows[route], sourceCommit, pipelineId, imageRef};
  }
  for (const file of scripts) f.rows['projects/7/repository/files/' + encodeURIComponent(file.path) + '?ref=' + sourceCommit] = {content: Buffer.from(file.content).toString('base64')};
  return {input, target, initial};
}
async function bindingRefresh(f) {
  const update = await buildUpdate(f, 'node24-vite8-quickstart-v5');
  fs.writeFileSync(f.mainConfig, fs.readFileSync(f.mainConfig, 'utf8').replace(image, publicImage));
  const nativeCI = f.rows['projects/7/repository/files/' + encodeURIComponent(b.CI) + '?ref=' + sha];
  f.rows['projects/7/repository/files/' + encodeURIComponent(b.CI) + '?ref=' + update.input.sourceCommit] = nativeCI;
  update.input.ciFiles.find(file => file.path === b.CI).sha256 = b.hash(Buffer.from(nativeCI.content, 'base64'));
  return {...update, input: {...update.input, action: 'refresh-binding'}};
}
(async () => {
  await use(async f => {
    const plan = await f.adoption.plan(f.input);
    assert(!Object.hasOwn(plan.publicPlan, 'buildProfile'), 'Historical inputs acquired a new plan field');
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
  for (const targetProfile of ['node24-vite8-ca-v4', 'node24-vite8-quickstart-v5'])
  for (const profile of ['node24-vite8', 'node24-vite8-cleanup-v2', 'node24-vite8-overview-v3', 'node24-vite8-ca-v4', ...(targetProfile.endsWith('-v5') ? [targetProfile] : [])]) await use(async f => {
    const {input, target, initial} = await buildUpdate(f, targetProfile);
    const before = b.read(f.config), main = fs.readFileSync(f.mainConfig, 'utf8');
    const initialArchive = path.join(f.directory, initial.publicPlan.operation + '.json');
    const retainedArchive = fs.readFileSync(initialArchive, 'utf8');
    const plan = await f.adoption.plan(input);
    assert.equal(plan.publicPlan.buildProfile, targetProfile);
    assert.equal(plan.publicPlan.previousBuildRecipeHash, builds.generate(logo, profile).recipeHash);
    assert.equal(plan.publicPlan.buildRecipeHash, target.recipeHash);
    assert.equal(plan.next.wizardWorkflow.build.recipeHash, target.recipeHash);
    assert.equal(fs.readFileSync(f.config, 'utf8'), before.text, 'Build preview changed configuration');
    const applied = await f.adoption.apply(input, plan.planHash);
    const after = b.read(f.config);
    assert.equal(after.receipt.repository.id, before.receipt.repository.id);
    assert.equal(after.receipt.operation, before.receipt.operation);
    assert.equal(after.text.slice(0, 1184), before.text.slice(0, 1184));
    assert.equal(fs.readFileSync(f.mainConfig, 'utf8'), main, 'Rebind changed the running Production image');
    assert.deepEqual(after.receipt.wizardWorkflow.environments.deployments, before.receipt.wizardWorkflow.environments.deployments);
    assert.equal(fs.readFileSync(initialArchive, 'utf8'), retainedArchive, 'Build rebind changed a historical archive');
    const archive = JSON.parse(fs.readFileSync(path.join(f.directory, applied.operation + '.json'), 'utf8'));
    assert.equal(archive.previousConfiguration, before.text);
    assert.deepEqual(archive.previousReceipt, before.receipt);
    assert.equal((await f.adoption.apply(input, plan.planHash)).unchanged, true);
  }, profile);
  await use(async f => {
    const {input} = await buildUpdate(f);
    await assert.rejects(f.adoption.plan(input), /Retain the Quick Install-compatible/);
  }, 'node24-vite8-quickstart-v5');
  for (const targetProfile of ['node24-vite8-ca-v4', 'node24-vite8-quickstart-v5'])
  for (const profile of ['legacy', 'legacy-cleanup-v2']) await use(async f => {
    const {input} = await buildUpdate(f, targetProfile), before = fs.readFileSync(f.config, 'utf8');
    await assert.rejects(f.adoption.plan(input), /existing reviewed modern build recipe/);
    assert.equal(fs.readFileSync(f.config, 'utf8'), before);
  }, profile);
  await use(async f => {
    for (const buildProfile of ['node24-vite8-ca-v4', 'node24-vite8-quickstart-v5'])
      await assert.rejects(f.adoption.plan({...f.input, buildProfile}), /Adopt the canonical source-primary/);
    for (const buildProfile of ['legacy-ca-v4', 'node24-vite8-overview-v3', 'unknown', null])
      await assert.rejects(f.adoption.plan({...f.input, buildProfile}), /explicit reviewed source-primary build profile/);
  });
  for (const targetProfile of ['node24-vite8-ca-v4', 'node24-vite8-quickstart-v5'])
  for (const change of [
    input => {delete input.buildProfile;},
    input => {input.ciFiles = input.ciFiles.filter(file => !file.path.endsWith('/ca/cacert-2026-10-20.crt'));},
    input => {input.ciFiles.find(file => file.path.endsWith('/refresh-ca.sh')).sha256 = '0'.repeat(64);},
    input => {input.ciFiles.find(file => file.path.endsWith('/smoke/check.js')).sha256 = '0'.repeat(64);},
    (input, f) => {f.rows['projects/7/repository/files/' + encodeURIComponent('.system-bootstrapper/build-v1/smoke/check.js') + '?ref=' + input.sourceCommit].content = Buffer.from('changed browser check').toString('base64');},
    (input, f) => {f.rows['projects/7/repository/files/' + encodeURIComponent('.system-bootstrapper/build-v1/ca/cacert-2026-10-20.crt') + '?ref=' + input.sourceCommit].content = Buffer.from('changed CA bundle').toString('base64');},
    (input, f) => {f.rows['projects/7/pipelines/32/jobs?per_page=100&include_retried=false'][2].status = 'failed';},
    input => {input.projectId = 8;}
  ]) await use(async f => {
    const {input} = await buildUpdate(f, targetProfile), before = fs.readFileSync(f.config, 'utf8');
    change(input, f);
    await assert.rejects(f.adoption.plan(input));
    assert.equal(fs.readFileSync(f.config, 'utf8'), before);
    assert.equal(fs.readdirSync(f.directory).length, 1, 'Refused build upgrade created an archive');
  });
  await use(async f => {
    fs.writeFileSync(f.mainConfig, fs.readFileSync(f.mainConfig, 'utf8').replace(oldImage, publicImage));
    await assert.rejects(f.adoption.plan(f.input), /Retain the exact previous managed Production image/);
    await assert.rejects(f.adoption.plan({...f.input, action: 'refresh-binding', buildProfile: 'node24-vite8-quickstart-v5'}), /before refreshing its binding/);
    assert.equal(fs.readFileSync(f.config, 'utf8'), f.text);
    assert(!fs.existsSync(f.directory));
  });
  await use(async f => {
    const {input, target, initial} = await bindingRefresh(f);
    const before = b.read(f.config), main = fs.readFileSync(f.mainConfig, 'utf8');
    const archiveBefore = fs.readFileSync(path.join(f.directory, initial.publicPlan.operation + '.json'), 'utf8');
    await assert.rejects(f.adoption.plan({...input, action: undefined}), /Provide an exact source-primary/);
    const ordinary = {...input}; delete ordinary.action;
    await assert.rejects(f.adoption.plan(ordinary), /Retain the exact previous managed Production image/);
    const plan = await f.adoption.plan(input);
    assert.equal(plan.publicPlan.action, 'refresh-source-primary-binding');
    assert.equal(plan.publicPlan.retainedProductionImageRef, publicImage);
    assert(!Object.hasOwn(plan.publicPlan, 'previousImageRef'));
    assert.equal(plan.publicPlan.buildRecipeHash, target.recipeHash);
    assert.equal(fs.readFileSync(f.config, 'utf8'), before.text);
    await assert.rejects(f.adoption.apply(input, 'stale'), /Preview/);
    assert.equal(fs.readFileSync(f.config, 'utf8'), before.text);
    const result = await f.adoption.apply(input, plan.planHash), after = b.read(f.config);
    assert.equal(JSON.stringify(after.receipt.repository), JSON.stringify(before.receipt.repository), 'Refresh changed canonical metadata or recovery aliases');
    assert.equal(after.receipt.namespaceId, before.receipt.namespaceId);
    assert.equal(after.receipt.operation, before.receipt.operation);
    assert.equal(fs.readFileSync(f.mainConfig, 'utf8'), main, 'Refresh changed Production configuration bytes');
    assert.deepEqual(after.receipt.wizardWorkflow.environments.deployments, before.receipt.wizardWorkflow.environments.deployments);
    assert(!after.receipt.repository.recoveryImages.some(row => row.imageRef === publicImage), 'Public Production was falsely recorded as a private registry alias');
    assert.equal(fs.readFileSync(path.join(f.directory, initial.publicPlan.operation + '.json'), 'utf8'), archiveBefore);
    const archive = JSON.parse(fs.readFileSync(path.join(f.directory, result.operation + '.json'), 'utf8'));
    assert.equal(archive.previousConfiguration, before.text);
    assert.equal(archive.previousMainConfiguration, main);
    assert.deepEqual(archive.previousReceipt, before.receipt);
    assert.equal((await f.adoption.apply(input, plan.planHash)).unchanged, true);
    fs.appendFileSync(f.mainConfig, '# changed after refresh\n');
    await assert.rejects(f.adoption.apply(input, plan.planHash), /Production configuration changed/);
    assert.equal(fs.readFileSync(f.config, 'utf8'), after.text);
  }, 'node24-vite8-ca-v4');
  for (const change of [
    input => {delete input.buildProfile;},
    input => {input.action = 'other';},
    input => {input.projectId = 8;},
    input => {input.projectPath = 'team/other';},
    input => {input.namespaceId = 8;},
    input => {input.defaultBranch = 'other';},
    input => {input.imageRef = publicImage;},
    input => {input.ciFiles = input.ciFiles.filter(file => file.path !== '.gitlab/delivery/environment.sh');},
    (input, f) => {
      input.ciFiles.find(file => file.path === b.CI).sha256 = b.hash('# changed native CI\n');
      f.rows['projects/7/repository/files/' + encodeURIComponent(b.CI) + '?ref=' + input.sourceCommit].content = Buffer.from('# changed native CI\n').toString('base64');
    },
    (input, f) => {f.rows['projects/7'].only_allow_merge_if_pipeline_succeeds = false;},
    (input, f) => {f.rows['projects/7'].only_allow_merge_if_all_discussions_are_resolved = false;},
    (input, f) => {f.rows['projects/7/pipelines/32/jobs?per_page=100&include_retried=false'][2].status = 'failed';},
    (input, f) => {f.rows['projects/7/pipelines/32/jobs?per_page=100&include_retried=false'][3].status = 'skipped';},
    (input, f) => {f.rows['projects/7/jobs/41/artifacts/wizard-evidence.json'].cubeSignature = false;},
    (input, f) => {f.rows['projects/7/pipelines/32'].source = 'api';},
    (input, f) => {f.rows['projects/7/repository/branches/master'].commit.id = sha;}
  ]) await use(async f => {
    const {input} = await bindingRefresh(f), before = fs.readFileSync(f.config, 'utf8'), main = fs.readFileSync(f.mainConfig, 'utf8');
    change(input, f);
    await assert.rejects(f.adoption.plan(input));
    assert.equal(fs.readFileSync(f.config, 'utf8'), before);
    assert.equal(fs.readFileSync(f.mainConfig, 'utf8'), main);
    assert.equal(fs.readdirSync(f.directory).length, 1, 'Refused metadata refresh created an archive');
  }, 'node24-vite8-ca-v4');
  for (const filename of ['config', 'mainConfig']) await use(async f => {
    const {input} = await bindingRefresh(f), plan = await f.adoption.plan(input);
    fs.appendFileSync(f[filename], '# concurrent edit\n');
    const before = fs.readFileSync(f.config, 'utf8'), main = fs.readFileSync(f.mainConfig, 'utf8');
    await assert.rejects(f.adoption.apply(input, plan.planHash), /Preview/);
    assert.equal(fs.readFileSync(f.config, 'utf8'), before);
    assert.equal(fs.readFileSync(f.mainConfig, 'utf8'), main);
    assert.equal(fs.readdirSync(f.directory).length, 1);
  }, 'node24-vite8-ca-v4');
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
  // Initial optional previews may retain an accepted public Production pair.
  async function initialBootstrap(f) {
    delete f.receipt.wizardWorkflow;
    fs.writeFileSync(f.config, logo + '\n# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify(f.receipt)).toString('base64') + '\n');
    const controller = 'docker.io/example/system@sha256:' + '8'.repeat(64);
    fs.writeFileSync(f.mainConfig, fs.readFileSync(f.mainConfig, 'utf8').replace(oldImage, publicImage) + "BOOTSTRAPPER_IMAGE='" + controller + "'\n");
    fs.writeFileSync(path.join(f.root, '.release-images.env'), 'BOOTSTRAPPER_IMAGE=' + controller + '\nWIZARD_IMAGE=' + publicImage + '\n');
    fs.writeFileSync(path.join(f.root, '.release-images.json'), JSON.stringify({schemaVersion: 1, status: 'startup-requested', sourceCommit: sha,
      productRelease: {tag: 'v1.0.0', sourceRevision: sha}, images: {wizard: {reference: publicImage, candidateJobId: 71}, controller: {reference: controller, candidateJobId: 71}}}));
    return {...f.input, action: 'bootstrap-previews', buildProfile: 'node24-vite8-quickstart-v5'};
  }
  await use(async f => {
    const input = await initialBootstrap(f), before = fs.readFileSync(f.config, 'utf8'), main = fs.readFileSync(f.mainConfig, 'utf8');
    const plan = await f.adoption.plan(input);
    assert.equal(fs.readFileSync(f.config, 'utf8'), before, 'Bootstrap preview wrote configuration');
    assert.equal(plan.publicPlan.action, 'bootstrap-source-primary-previews');
    assert.equal(plan.publicPlan.retainedProductionImageRef, publicImage);
    assert.deepEqual(plan.next.repository.recoveryImages, [], 'Public image acquired a false private recovery alias');
    assert.equal(plan.next.sourcePrimary.bootstrap, true);
    assert.equal(plan.next.wizardWorkflow.environments.initialVariablesMissing, true);
    await assert.rejects(f.adoption.apply(input, 'stale'), /Preview/);
    await f.adoption.apply(input, plan.planHash);
    assert.equal(fs.readFileSync(f.mainConfig, 'utf8'), main, 'Initial preview adoption promoted Production');
    assert.equal((await f.adoption.apply(input, plan.planHash)).unchanged, true);
  }, 'node24-vite8-quickstart-v5');
  for (const change of [
    f => fs.unlinkSync(path.join(f.root, '.release-images.json')),
    f => { const file = path.join(f.root, '.release-images.json'), record = JSON.parse(fs.readFileSync(file)); record.images.controller.candidateJobId++; fs.writeFileSync(file, JSON.stringify(record)); },
    f => {f.rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'][0].status = 'failed';},
    f => {f.rows['projects/7/jobs/41/artifacts/wizard-evidence.json'].cubeSignature = false;},
    f => {f.receipt.wizardWorkflow = {version: 1, phase: 'source-imported'}; fs.writeFileSync(f.config, logo + '\n# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify(f.receipt)).toString('base64') + '\n');}
  ]) await use(async f => {
    const input = await initialBootstrap(f); change(f);
    const before = fs.readFileSync(f.config, 'utf8'), main = fs.readFileSync(f.mainConfig, 'utf8');
    await assert.rejects(f.adoption.plan(input));
    assert.equal(fs.readFileSync(f.config, 'utf8'), before); assert.equal(fs.readFileSync(f.mainConfig, 'utf8'), main);
    assert(!fs.existsSync(f.directory));
  }, 'node24-vite8-quickstart-v5');
  console.log('Source-primary adoption: exact ownership/native evidence, versioned rebind/refusals, metadata-only refresh with unchanged Production/native CI/recovery aliases, preserved private history/floors, CAS, shared mutex, idempotency and initial private-image guard passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
