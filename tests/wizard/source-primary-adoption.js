const crypto = require('crypto');
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Adoption} = require('../../dist/modules/project-lifecycle/adoptionSession');
const b = require('../../dist/modules/project-lifecycle/sourcePrimaryBinding');
const {readConfiguration} = require('../../dist/modules/project-lifecycle/upgradeSession');
const {projectForImage} = require('../../dist/modules/wizard-recovery/identity');
const logo = require('../../dist/common/configurationSignature').default.textLogo;
const builds = require('../../dist/modules/project-lifecycle/buildRecipe.service');
const env = require('../../dist/modules/project-lifecycle/sourcePrimaryEnvironment');
const sha = 'a'.repeat(40), image = 'registry.example.test/team/system-wizard@sha256:' + 'b'.repeat(64);
const oldImage = 'registry.example.test/root/wizard@sha256:' + 'c'.repeat(64), helperImage = 'sha256:' + 'd'.repeat(64);
const publicImage = 'docker.io/example/wizard@sha256:' + '9'.repeat(64);
function fixture(profile = 'node24-vite8-overview-v3', companion) {
  const recipe = companion ? require('../../dist/modules/project-ci/cliRecipe').generateCliBuildRecipe(logo,path.resolve(__dirname,'../..'),companion.sha256) : builds.generate(logo, profile);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-source-primary-'));
  const config = path.join(root, '.projects.env/.wizard.env'), mainConfig = path.join(root, '.docker.env'), directory = path.join(root, 'adoption');
  fs.mkdirSync(path.dirname(config));
  const settings = Object.fromEntries(['review', 'beta'].map(kind => [kind, {enabled: false, host: kind + '.example.test', domainMode: 2,
    ssl: '/ssl/live/' + kind + '/fullchain.pem', sslKey: '/ssl/live/' + kind + '/privkey.pem'}]));
  const tombstone = {projectId: 1, pipelineId: 23, jobId: 40, state: 'stopped', operation: '0'.repeat(48)};
  const receipt = {defaultProject: true, template: 'wizard', state: 'complete', operation: '1'.repeat(48), namespaceId: 1,
    repository: {id: 1, namespaceId: 1, path: 'root/wizard', defaultBranch: 'main', ciPath: '.system-bootstrapper/ci.yml', systemProject: true},
    wizardWorkflow: {version: 1, importCommit: '2'.repeat(40), build: {version: 1, recipeHash: recipe.recipeHash, ...(recipe.cliArtifactSha256 ? {cliArtifactSha256:recipe.cliArtifactSha256} : {})}, environments: {
      version: 1, phase: 'ready', operation: '3'.repeat(48), settings, settingsHash: b.hash(JSON.stringify(settings)), helperImage, controller: 'system_bootstrapper_1',
      deployments: {review: {lastPipelineId: 23, stoppedThroughPipelineId: 23, tombstone}, beta: {lastPipelineId: 24, stoppedThroughPipelineId: 24}}}}};
  const text = logo + '\n# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify(receipt)).toString('base64') + '\n';
  fs.writeFileSync(config, text);
  fs.writeFileSync(mainConfig, logo + "\nexport GITLAB_HOST='gitlab.example.test'\nexport GITLAB_REGISTRY_URL='https://registry.example.test'\nexport GITLAB_REGISTRY_DOMAIN_MODE='2'\nexport WIZARD_IMAGE='" + oldImage + "'\n");
  const scripts = [...recipe.files, {path: b.ci, content: '# native CI\n'}, {path: '.gitlab/delivery/environment.sh', content: fs.readFileSync(path.resolve(__dirname, '../../templates/project-bootstrap/wizard-environments/historical/source-primary-v1.sh'), 'utf8')}];
  if(profile==='node24-vite8-cli-v7'){const {cliArtifactFiles,selectedCliArtifact}=require('../../dist/modules/project-ci/cliArtifact');for(const file of cliArtifactFiles(companion || selectedCliArtifact()))scripts.push({path:file.path,content:file.bytes});scripts.push({path:'.gitlab/producer-v3.json',content:fs.readFileSync(path.resolve(__dirname,'../../wizard/.gitlab/producer-v3.json'))});}
  const input = {version: 1, projectId: 7, projectPath: 'team/system-wizard', namespaceId: 9, defaultBranch: 'master', pipelineId: 31, sourceCommit: sha,
    imageRef: image, helperImage, ciFiles: scripts.map(file => ({path: file.path, sha256: b.hash(file.content)}))};
  const rows = {
    'projects/1': {id: 1, namespace: {id: 1}, path_with_namespace: 'root/wizard', visibility: 'private', description: 'System Bootstrapper operation ' + receipt.operation, ci_config_path: '.system-bootstrapper/ci.yml'},
    'projects/7': {id: 7, namespace: {id: 9}, path_with_namespace: input.projectPath, default_branch: 'master', visibility: 'private', ci_config_path: b.ci,
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
async function use(run, profile, companion) { const f = fixture(profile, companion); try {await run(f);} finally {fs.rmSync(f.root, {recursive: true, force: true});} }
function nativeCollector(f) {
  const {collectedReads} = require('../../dist/modules/project-lifecycle/previewReads');
  const phases = [];
  f.adoption.collectEvidence = async phase => {
    phases.push({locked: fs.existsSync(f.config + '.environments.lock')});
    const {PreviewEvidence} = require('../../dist/modules/gitlab-provision/previewEvidence');
    const result = await new PreviewEvidence({...phase, projectIds: [1, 7]}, async route => {
      assert(Object.hasOwn(f.rows, route), 'Unexpected evidence route: ' + route);
      return structuredClone(f.rows[route]);
    }).adoption();
    phases.at(-1).reads = result.reads.length;
    f.calls.push(...result.reads.map(row => row.route));
    return collectedReads(result);
  };
  return phases;
}
async function buildUpdate(f, profile = 'node24-vite8-ca-v4', inspectRetained) {
  const initial = await f.adoption.plan(f.input);
  await f.adoption.apply(f.input, initial.planHash);
  fs.writeFileSync(f.mainConfig, fs.readFileSync(f.mainConfig, 'utf8').replace(oldImage, image));
  if (inspectRetained) {
    await inspectRetained();
  }

  const target = builds.generate(logo, profile), sourceCommit = 'e'.repeat(40), pipelineId = 32;
  const imageRef = image.replace('b'.repeat(64), 'f'.repeat(64));
  const scripts = [...target.files, {path: b.ci, content: '# reviewed native CI\n'},
    {path: '.gitlab/delivery/environment.sh', content: fs.readFileSync(path.resolve(__dirname, '../../templates/project-bootstrap/wizard-environments/historical/source-primary-v1.sh'), 'utf8')}];
  if(profile==='node24-vite8-cli-v7'){const {cliArtifactFiles,selectedCliArtifact}=require('../../dist/modules/project-ci/cliArtifact');for(const file of cliArtifactFiles(selectedCliArtifact()))scripts.push({path:file.path,content:file.bytes});scripts.push({path:'.gitlab/producer-v3.json',content:fs.readFileSync(path.resolve(__dirname,'../../wizard/.gitlab/producer-v3.json'))});}
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
  const nativeCI = f.rows['projects/7/repository/files/' + encodeURIComponent(b.ci) + '?ref=' + sha];
  f.rows['projects/7/repository/files/' + encodeURIComponent(b.ci) + '?ref=' + update.input.sourceCommit] = nativeCI;
  update.input.ciFiles.find(file => file.path === b.ci).sha256 = b.hash(Buffer.from(nativeCI.content, 'base64'));
  return {...update, input: {...update.input, action: 'refresh-binding'}};
}
(async () => {
  for (const manifestSize of [23, 40]) await use(async f => {
    const {batchedReads, maxRoutes} = require('../../dist/modules/project-lifecycle/previewReads');
    // Include the native recipe (and its real CA bundle) in a full approved
    // manifest. Process launches must scale with phases, not individual files.
    while (f.input.ciFiles.length < manifestSize) {
      const file = '.gitlab/proof-' + f.input.ciFiles.length + '.sh', content = '# retained native proof\n';
      f.input.ciFiles.push({path: file, sha256: b.hash(content)});
      f.rows['projects/7/repository/files/' + encodeURIComponent(file) + '?ref=' + sha] = {content: Buffer.from(content).toString('base64')};
    }
    let active = 0, peak = 0;
    const batches = [];
    const original = f.adoption.request;
    f.adoption.request = batchedReads(async routes => {
      batches.push([...routes]); active++; peak = Math.max(peak, active);
      assert(routes.length <= maxRoutes);
      try { return await Promise.all(routes.map(original)); } finally { active--; }
    });
    const plan = await f.adoption.plan(f.input);
    await f.adoption.apply(f.input, plan.planHash);
    assert.equal(f.calls.length, 2 * (manifestSize + 7), 'Evidence GETs include duplicate recipe reads');
    const phaseSizes = manifestSize === 23 ? [28, 2] : [32, 13, 2];
    assert.deepEqual(batches.map(routes => routes.length), [...phaseSizes, ...phaseSizes], 'Independent evidence reads did not coalesce');
    assert.equal(peak, 1, 'Batches overlapped Rails processes');
    assert.equal(f.calls.filter(route => route === 'projects/7').length, 2, 'Apply reused mutable plan evidence');
    for (const file of f.input.ciFiles) {
      const route = 'projects/7/repository/files/' + encodeURIComponent(file.path) + '?ref=' + sha;
      assert.equal(f.calls.filter(actual => actual === route).length, 2, 'Each plan must read every manifest blob exactly once');
    }
    console.log('Native adoption batching (' + manifestSize + ' files): ' + f.calls.length + ' evidence GETs in ' + batches.length + ' sequential process batches across plan/apply.');
  }, 'node24-vite8-quickstart-v5');
  await use(async f => {
    while (f.input.ciFiles.length < 23) {
      const file = '.gitlab/proof-' + f.input.ciFiles.length + '.sh', content = '# retained native proof\n';
      f.input.ciFiles.push({path: file, sha256: b.hash(content)});
      f.rows['projects/7/repository/files/' + encodeURIComponent(file) + '?ref=' + sha] = {content: Buffer.from(content).toString('base64')};
    }
    const phases = nativeCollector(f);
    const plan = await f.adoption.plan(f.input);
    await f.adoption.apply(f.input, plan.planHash);
    assert.deepEqual(phases, [{locked: false, reads: 30}, {locked: true, reads: 30}]);
    assert.equal(f.calls.length, 60, 'Collector dropped independent plan/apply proof reads');
    for (const file of f.input.ciFiles) {
      const route = 'projects/7/repository/files/' + encodeURIComponent(file.path) + '?ref=' + sha;
      assert.equal(f.calls.filter(actual => actual === route).length, 2, 'Apply reused a plan blob');
    }
    console.log('Native adoption collector: unchanged 60 GETs in two fresh 30-GET processes, with apply revalidation under the ownership lock.');
  }, 'node24-vite8-quickstart-v5');
  for (const change of [
    f => { f.rows['projects/7'].visibility = 'public'; },
    f => { f.rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'][0].status = 'failed'; },
    f => { f.rows['projects/7/jobs/41/artifacts/wizard-evidence.json'].cubeSignature = false; },
    f => { f.rows['projects/7/repository/files/' + encodeURIComponent(b.ci) + '?ref=' + sha].content = Buffer.from('changed bytes').toString('base64'); }
  ]) await use(async f => {
    const phases = nativeCollector(f), plan = await f.adoption.plan(f.input);
    change(f);
    await assert.rejects(f.adoption.apply(f.input, plan.planHash));
    assert.equal(phases.length, 2); assert.equal(phases[1].locked, true);
    assert.equal(fs.readFileSync(f.config, 'utf8'), f.text);
    assert(!fs.existsSync(f.directory), 'Refused collector evidence created an adoption archive');
    assert(!fs.existsSync(f.config + '.environments.lock'), 'Refused collector retained its owned lock');
  }, 'node24-vite8-quickstart-v5');
  for (const change of [
    f => {f.rows['projects/1'].description = 'Unrelated project';},
    f => {f.rows['projects/7/repository/branches/master'].commit.id = 'f'.repeat(40);},
    f => {f.rows['projects/7'].only_allow_merge_if_pipeline_succeeds = false;},
    f => {f.rows['projects/7/pipelines/31'].sha = 'f'.repeat(40);},
    f => {f.rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'][2].status = 'failed';},
    f => {f.rows['projects/7/jobs/41/artifacts/wizard-evidence.json'].cubeSignature = false;},
    f => {f.rows['projects/7/repository/files/' + encodeURIComponent(b.ci) + '?ref=' + sha].content = Buffer.from('changed native CI').toString('base64');},
    f => {f.rows['projects/7/repository/files/' + encodeURIComponent('.system-bootstrapper/build-v1/build.sh') + '?ref=' + sha].content = Buffer.from('changed generic recipe').toString('base64');}
  ]) await use(async f => {
    const {batchedReads} = require('../../dist/modules/project-lifecycle/previewReads'), original = f.adoption.request;
    f.adoption.request = batchedReads(routes => Promise.all(routes.map(original)));
    const plan = await f.adoption.plan(f.input); change(f);
    await assert.rejects(f.adoption.plan(f.input));
    await assert.rejects(f.adoption.apply(f.input, plan.planHash));
    assert.equal(f.calls.filter(route => route === 'projects/7').length, 3, 'A later plan or apply reused the earlier project proof');
    const ciRoute = 'projects/7/repository/files/' + encodeURIComponent(b.ci) + '?ref=' + sha;
    assert.equal(f.calls.filter(route => route === ciRoute).length, 3, 'A later plan or apply reused the earlier manifest proof');
    assert.equal(fs.readFileSync(f.config, 'utf8'), f.text);
    assert(!fs.existsSync(f.directory), 'Refused fresh evidence created an adoption archive');
  });
  await use(async f => {
    const file = f.input.ciFiles.find(row => row.path === '.system-bootstrapper/build-v1/build.sh');
    const changed = 'changed generic recipe\n';
    file.sha256 = b.hash(changed);
    f.rows['projects/7/repository/files/' + encodeURIComponent(file.path) + '?ref=' + sha].content = Buffer.from(changed).toString('base64');
    // Matching the supplied manifest is insufficient: it must still match the
    // controller's complete trusted generic recipe, without another blob read.
    await assert.rejects(f.adoption.plan(f.input), /complete generic delivery/);
    assert.equal(fs.readFileSync(f.config, 'utf8'), f.text);
    assert(!fs.existsSync(f.directory), 'Unapproved generic bytes created an adoption archive');
  });
  await use(async f => {
    const plan = await f.adoption.plan(f.input);
    let files, notifications = 0;
    const proof = await b.evidence(f.adoption.request, plan.next, f.input.pipelineId, sha, image,
      verified => {files = verified; notifications++;});
    assert.deepEqual(Object.keys(proof).sort(), ['build', 'pipeline', 'project', 'publishing', 'smoke'], 'Verified blobs leaked into the public evidence shape');
    assert.equal(notifications, 1);
    const recipeFile = '.system-bootstrapper/build-v1/build.sh';
    assert(files.get(recipeFile).equals(Buffer.from(builds.generate(logo, 'node24-vite8-overview-v3').files.find(file => file.path === recipeFile).content)));
  });
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
    const bootstrap = require('../../dist/modules/project-workflow/projectWorkflow');
    let calls = 0;
    bootstrap.rails = async input => {
      calls++; assert.equal(input.action, 'wizard-source-primary-status'); assert.equal(input.repository.id, 7);
      return {sourceRevision: sha, build: b.read(f.config).receipt.wizardWorkflow.build, message: 'Fixture native evidence'};
    };
    assert.equal((await require('../../dist/api/projects/defaultWizard').ensureDefaultWizard()).repository.id, 7);
    assert.equal(calls, 0, 'Restart tried to recreate or import a second Wizard project');
    const workflow = require('../../dist/api/projects/wizardSourceWorkflow');
    assert.equal(workflow.previewWizardSource().canInitialize, false);
    assert.throws(() => workflow.initializeWizardSource({}), /Source import is disabled/);
    const build = require('../../dist/api/projects/wizardBuildWorkflow');
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
  if(process.env.SYSTEM_CLI_ARTIFACT){
    await use(async f=>{
      const {input,target}=await buildUpdate(f,'node24-vite8-cli-v7');const plan=await f.adoption.plan(input);
      assert.equal(plan.next.wizardWorkflow.build.recipeHash,target.recipeHash);await f.adoption.apply(input,plan.planHash);
      assert.equal(b.read(f.config).receipt.wizardWorkflow.build.recipeHash,target.recipeHash);
    },'node24-vite8-typed-v6');
    await use(async f=>{const {input}=await buildUpdate(f,'node24-vite8-cli-v7');input.ciFiles=input.ciFiles.filter(file=>!file.path.endsWith('.tgz'));
      await assert.rejects(f.adoption.plan(input),/exact approved file manifest|matching source files/);
    },'node24-vite8-typed-v6');
    await use(async f=>{const {input}=await buildUpdate(f,'node24-vite8-typed-v6');await assert.rejects(f.adoption.plan(input),/Retain the Quick Install-compatible/);},'node24-vite8-cli-v7');
  }
  {
    const pair = require('../shared/cli-companion-fixture').companionPair(),
      [old, next] = pair.artifacts;
    const previousArtifact = process.env.SYSTEM_CLI_ARTIFACT,
      previousReceipt = process.env.SYSTEM_CLI_RECEIPT;
    process.env.SYSTEM_CLI_ARTIFACT = next.filename;
    delete process.env.SYSTEM_CLI_RECEIPT;
    try {
      await use(
        async (f) => {
          const oldRecipe =
            require('../../dist/modules/project-ci/cliRecipe').generateCliBuildRecipe(
              logo,
              path.resolve(__dirname, '../..'),
              old.artifact.sha256,
            );
          let before;
          const { input, target } = await buildUpdate(f, 'node24-vite8-cli-v7', async () => {
            before = b.read(f.config);
            delete before.receipt.wizardWorkflow.build.cliArtifactSha256;
            fs.writeFileSync(
              f.config,
              before.text.replace(
                /^# BOOTSTRAPPER_PROJECT=.*$/m,
                '# BOOTSTRAPPER_PROJECT=' +
                  Buffer.from(JSON.stringify(before.receipt)).toString('base64'),
              ),
            );
            const bootstrap = require('../../dist/modules/project-workflow/projectWorkflow'),
              previousDirectory = process.env.SYSTEM_CONFIG_DIR,
              previousRails = bootstrap.rails;
            process.env.SYSTEM_CONFIG_DIR = f.root;
            try {
              const status = require('../../dist/api/projects/wizardBuildWorkflow');
              assert.equal(status.previewWizardBuild().build.recipeHash, oldRecipe.recipeHash);
              bootstrap.rails = async (value) => ({
                sourceRevision: sha,
                build: value.build,
                message: 'Retained source-bound status',
              });
              const job = status.refreshWizardBuild();
              while (job.state === 'running') {
                await new Promise((resolve) => setTimeout(resolve, 2));
              }
              assert.equal(job.state, 'complete', job.message);
              assert.equal(job.build.cliArtifactSha256, old.artifact.sha256);
              assert.equal(
                b.read(f.config).receipt.wizardWorkflow.build.cliArtifactSha256,
                old.artifact.sha256,
              );
            } finally {
              bootstrap.rails = previousRails;

              if (previousDirectory === undefined) {
                delete process.env.SYSTEM_CONFIG_DIR;
              } else {
                process.env.SYSTEM_CONFIG_DIR = previousDirectory;
              }
            }
          });
          const plan = await f.adoption.plan(input);
          assert.equal(plan.publicPlan.previousBuildRecipeHash, oldRecipe.recipeHash);
          assert.equal(plan.publicPlan.buildRecipeHash, target.recipeHash);
          assert.notEqual(oldRecipe.recipeHash, target.recipeHash);
          assert.equal(plan.next.wizardWorkflow.build.cliArtifactSha256, next.artifact.sha256);
          const owned = fs.readFileSync(f.config, 'utf8');
          const changed = structuredClone(before.receipt);
          changed.sourcePrimary.ciFiles.find(
            (file) => file.path === '.gitlab/cli/system-bootstrapper.tgz',
          ).sha256 = next.artifact.sha256;
          fs.writeFileSync(
            f.config,
            owned.replace(
              /^# BOOTSTRAPPER_PROJECT=.*$/m,
              '# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify(changed)).toString('base64'),
            ),
          );
          await assert.rejects(() => f.adoption.plan(input), /Unknown reserved/);
          fs.writeFileSync(f.config, owned);
          await f.adoption.apply(input, plan.planHash);
          assert.equal(
            b.read(f.config).receipt.wizardWorkflow.build.cliArtifactSha256,
            next.artifact.sha256,
          );
        },
        'node24-vite8-cli-v7',
        old.artifact,
      );
    } finally {
      if (previousArtifact === undefined) {
        delete process.env.SYSTEM_CLI_ARTIFACT;
      } else {
        process.env.SYSTEM_CLI_ARTIFACT = previousArtifact;
      }

      if (previousReceipt === undefined) {
        delete process.env.SYSTEM_CLI_RECEIPT;
      } else {
        process.env.SYSTEM_CLI_RECEIPT = previousReceipt;
      }

      fs.rmSync(pair.root, { recursive: true, force: true });
    }
  }
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
      input.ciFiles.find(file => file.path === b.ci).sha256 = b.hash('# changed native CI\n');
      f.rows['projects/7/repository/files/' + encodeURIComponent(b.ci) + '?ref=' + input.sourceCommit].content = Buffer.from('# changed native CI\n').toString('base64');
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
  const {GitlabNativeApiService}=require('../../dist/modules/gitlab-provision/nativeApi.service');
  const nativeApiCalls=[], nativeApiContext={checkout:path.resolve(__dirname,'../..'),containerId:'e'.repeat(64)};
  let nativeApiOutput='{"id":7}\nBOOTSTRAPPER_HTTP_STATUS:200';
  const nativeApi=new GitlabNativeApiService({async run(binary,args,options){nativeApiCalls.push({binary,args,options});return nativeApiOutput;}});
  const nativeApiProof=await nativeApi.request(nativeApiContext,'private-fixture-secret','POST','projects/7/variables',{value:'private-value'});
  assert.equal(nativeApiProof.status,200);assert.equal(nativeApiProof.value.id,7);
  assert(!JSON.stringify(nativeApiCalls[0].args).includes('private-fixture-secret'));assert(nativeApiCalls[0].options.input.includes('private-fixture-secret'));
  assert.equal(nativeApiCalls[0].args[nativeApiCalls[0].args.indexOf('curl')+1],'-q');assert.equal(nativeApiCalls[0].args[nativeApiCalls[0].args.indexOf('--proxy')+1],'');assert(!nativeApiCalls[0].args.includes('--location'));assert(nativeApiCalls[0].args.includes('http://127.0.0.1/api/v4/projects/7/variables'));
  for(const route of ['https://foreign.test','//foreign.test','../admin','projects/7%0aSECRET'])await assert.rejects(()=>nativeApi.request(nativeApiContext,'token','GET',route),/request-invalid/);
  nativeApiOutput='{}\nBOOTSTRAPPER_HTTP_STATUS:302';await assert.rejects(()=>nativeApi.request(nativeApiContext,'token','POST','projects'),error=>error.uncertain===true&&!error.message.includes('token'));
  nativeApiOutput='invalid\nBOOTSTRAPPER_HTTP_STATUS:200';await assert.rejects(()=>nativeApi.request(nativeApiContext,'token','GET','projects'),error=>error.uncertain===false);
  nativeApiOutput=JSON.stringify({id:42,token:'private-fixture-bootstrap'});await nativeApi.bootstrap(nativeApiContext,'f'.repeat(48));
  const bootstrapCall=nativeApiCalls.at(-1);assert(bootstrapCall.args.includes('gitlab-rails'));assert(bootstrapCall.options.input.includes('admin.personal_access_tokens.create!'));
  assert(!bootstrapCall.args.includes('private-fixture-bootstrap'));
  const {GitlabAuthJournalService}=require('../../dist/modules/gitlab-provision/authJournal.service');
  const {GitlabAuthBootstrapService}=require('../../dist/modules/gitlab-provision/authBootstrap.service');
  const authDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'gitlab-auth-journal-'));
  try {
    const journals=new GitlabAuthJournalService();let creations=0, loseBootstrap=true, revoked=false, loseRevocation=true, expectedName;
    const bootstrapApi={async bootstrap(context,operation){creations++;expectedName='system-bootstrapper-initial-'+operation;
      assert.equal(JSON.parse(fs.readFileSync(path.join(authDirectory,'system-bootstrapper-auth/journal.json'))).phase,'bootstrap-requested');
      if(loseBootstrap)throw Object.assign(Error('lost response'),{uncertain:true});
      revoked=false;return {id:42,userId:1,token:'temporary-private-token',name:expectedName,expiresAt:'2026-11-21'};
    },async request(context,token,method,route){
      if(token==='recovery-administrator'){
        if(route==='user')return {status:200,value:{id:9,is_admin:true,state:'active'}};
        if(route==='personal_access_tokens/self')return {status:200,value:{id:99,user_id:9,active:true}};
        if(route==='users?username=root')return {status:200,value:[{id:1,username:'root'}]};
        if(route==='users/1')return {status:200,value:{id:1,is_admin:true,state:'active'}};
        if(route.startsWith('personal_access_tokens?'))return {status:200,value:[{id:42,user_id:1,name:expectedName,scopes:['api'],revoked}]};
        assert.equal(route,'personal_access_tokens/42');if(method==='DELETE'){revoked=true;return {status:204,value:null};}
        return {status:200,value:{id:42,user_id:1,name:expectedName,revoked}};
      }
      assert.equal(token,'replacement-private-token');
      if(route==='user')return {status:200,value:{id:7,is_admin:true,state:'active'}};
      if(route==='personal_access_tokens/self')return {status:200,value:{id:43,user_id:7,active:true,revoked:false,scopes:['api'],expires_at:'2027-02-01'}};
      assert.equal(route,'personal_access_tokens/42');
      if(method==='DELETE'){revoked=true;if(loseRevocation)throw Object.assign(Error('lost revocation'),{uncertain:true});return {status:204,value:null};}
      return {status:200,value:{id:42,user_id:1,name:expectedName,revoked}};
    }};
    const lifecycle=new GitlabAuthBootstrapService(journals,bootstrapApi);
    await assert.rejects(()=>lifecycle.initial(nativeApiContext,authDirectory),/lost response/);
    await assert.rejects(()=>lifecycle.initial(nativeApiContext,authDirectory),/reconciliation-required/);
    assert.equal(creations,1,'lost response must not mint another token');
    const journalPath=path.join(authDirectory,'system-bootstrapper-auth/journal.json');
    assert.equal(fs.statSync(path.dirname(journalPath)).mode&0o777,0o700);assert.equal(fs.statSync(journalPath).mode&0o777,0o600);
    // Explicit owned reconciliation revokes the observed orphan before creating a new operation.
    const previousOperation=JSON.parse(fs.readFileSync(journalPath)).operation;loseBootstrap=false;
    const started=await lifecycle.reconcileInitial(nativeApiContext,authDirectory,'recovery-administrator');
    assert.equal(started.phase,'bootstrap-received');assert.notEqual(started.operation,previousOperation);assert.equal(creations,2);
    await assert.rejects(()=>lifecycle.reconcileInitial(nativeApiContext,authDirectory,'recovery-administrator'),/not-applicable/);
    const replacement={id:43,userId:7,token:'replacement-private-token',expiresAt:'2027-02-01'};
    await assert.rejects(()=>lifecycle.complete(nativeApiContext,authDirectory,replacement),/lost revocation/);
    assert.equal(JSON.parse(fs.readFileSync(journalPath)).phase,'replacement-verified');
    await lifecycle.complete(nativeApiContext,authDirectory,replacement);
    const ready=JSON.parse(fs.readFileSync(journalPath));assert.equal(ready.phase,'ready');assert(!ready.bootstrap);assert(!fs.readFileSync(journalPath,'utf8').includes('temporary-private-token'));
    const originalFsync=fs.fsyncSync;
    await journals.withJournal(authDirectory,async journal=>{
      try {fs.fsyncSync=()=>{throw Error('injected-fsync-failure');};assert.throws(()=>journal.save(ready),/injected-fsync-failure/);}
      finally {fs.fsyncSync=originalFsync;}
      assert.deepEqual(fs.readdirSync(path.dirname(journalPath)).filter(name=>name.startsWith('.journal-')),[]);
      assert.deepEqual(journal.read(),ready);
    });
    fs.chmodSync(journalPath,0o644);await assert.rejects(()=>lifecycle.initial(nativeApiContext,authDirectory),/private-state-invalid/);fs.chmodSync(journalPath,0o600);
    await journals.withJournal(authDirectory,async()=>{await assert.rejects(()=>journals.withJournal(authDirectory,async()=>{}),/mutex is busy/);});
    fs.unlinkSync(journalPath);fs.symlinkSync('/dev/null',journalPath);await assert.rejects(()=>lifecycle.initial(nativeApiContext,authDirectory),/private-state-invalid/);
  } finally {fs.rmSync(authDirectory,{recursive:true,force:true});}
  const {GitlabControllerCredentialService}=require('../../dist/modules/gitlab-provision/controllerCredential.service');
  const controllerAuthDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'gitlab-controller-auth-'));
  try {
    const journals=new GitlabAuthJournalService(), operation='d'.repeat(48);
    await journals.withJournal(controllerAuthDirectory,async journal=>journal.save({version:1,operation,phase:'bootstrap-received',bootstrap:{id:1,userId:1,token:'temporary-controller-admin',name:'system-bootstrapper-initial-'+operation,expiresAt:'2026-11-21'}}));
    let account, token, tokenCreations=0, hidePending=false, userCreations=0, loseRetirement=false;const controllerTokens=new Map();
    const api={async request(context,secret,method,route,body){
      const authenticated=[...controllerTokens.values()].find(value=>value.token===secret);
      assert(secret==='temporary-controller-admin'||authenticated&&!authenticated.revoked);
      if(route==='user')return {status:200,value:{id:authenticated?7:1,is_admin:true,state:'active'}};
      if(route==='personal_access_tokens/self')return {status:200,value:authenticated||{id:1,user_id:1,active:true,revoked:false}};
      if(route.startsWith('users?username='))return {status:200,value:account?[{id:7}]:[]};
      if(route==='users'&&method==='POST'){userCreations++;account={...body,id:7,is_admin:body.admin,state:'active'};return {status:201,value:account};}
      if(route==='users/7')return {status:200,value:account};
      if(route==='users/7/personal_access_tokens'){
        tokenCreations++;token={...body,id:40+tokenCreations,user_id:7,revoked:false,active:true,token:'new-controller-private-'+tokenCreations};controllerTokens.set(token.id,token);
        if(tokenCreations===1)throw Object.assign(Error('lost controller token response'),{uncertain:true});
        return {status:201,value:token};
      }
      if(route.startsWith('personal_access_tokens?'))return {status:200,value:hidePending?[]:[token]};
      if(/^personal_access_tokens\/\d+$/.test(route)){const selected=controllerTokens.get(Number(route.split('/')[1]));assert(selected);if(method==='DELETE'){selected.revoked=true;if(loseRetirement){loseRetirement=false;throw Object.assign(Error('lost retirement response'),{uncertain:true});}return {status:204,value:null};}return {status:200,value:selected};}
      throw Error('Unexpected credential request '+method+' '+route);
    }};
    const service=new GitlabControllerCredentialService(journals,api), identity={username:'system-bootstrapper-controller',email:'controller@example.test'}, now=new Date('2026-11-20T00:00:00Z');
    await assert.rejects(()=>service.prepare(nativeApiContext,controllerAuthDirectory,identity,now),/lost controller token response/);
    hidePending=true;await assert.rejects(()=>service.prepare(nativeApiContext,controllerAuthDirectory,identity,now),/reconciliation-required/);assert.equal(tokenCreations,1);
    hidePending=false;const prepared=await service.prepare(nativeApiContext,controllerAuthDirectory,identity,now);
    assert.equal(prepared.id,42);assert.equal(prepared.userId,7);assert.equal(tokenCreations,2);assert.equal(userCreations,1);
    assert.deepEqual(await service.prepare(nativeApiContext,controllerAuthDirectory,identity,now),prepared);assert.equal(tokenCreations,2);
    const savedNote=account.note;account.note='foreign';await assert.rejects(()=>service.prepare(nativeApiContext,controllerAuthDirectory,identity,now),/owned-account-mismatch/);
    await assert.rejects(()=>service.prepare(nativeApiContext,controllerAuthDirectory,{...identity,email:'different@example.test'},now),/binding-mismatch/);
    account.note=savedNote;
    await journals.withJournal(controllerAuthDirectory,async journal=>{const state=journal.read();delete state.bootstrap;state.phase='ready';journal.save(state);});
    assert.deepEqual(await service.current(nativeApiContext,controllerAuthDirectory,now),prepared);assert.equal(tokenCreations,2);
    const renewalDate=new Date('2027-02-10T00:00:00Z');loseRetirement=true;
    await assert.rejects(()=>service.current(nativeApiContext,controllerAuthDirectory,renewalDate),/lost retirement response/);
    await journals.withJournal(controllerAuthDirectory,async journal=>{const state=journal.read();assert.equal(state.replacement.id,43);assert.equal(state.retiring.id,42);});
    const renewed=await service.current(nativeApiContext,controllerAuthDirectory,renewalDate);assert.equal(renewed.id,43);assert.equal(tokenCreations,3);
    await journals.withJournal(controllerAuthDirectory,async journal=>{assert(!journal.read().retiring);assert(!journal.read().renewal);});
  } finally {fs.rmSync(controllerAuthDirectory,{recursive:true,force:true});}
  const {GitlabActivationSessionService}=require('../../dist/modules/gitlab-provision/activationSession.service');
  const nativeHttp=require('http'), originalRequest=nativeHttp.request, {EventEmitter}=require('events');
  try {
    nativeHttp.request=(options,receive)=>{assert.equal(options.socketPath,'/var/run/docker.sock');assert.equal(options.path,'/v1.44/exec/'+'a'.repeat(64)+'/json');assert.equal(options.method,'GET');const request=new EventEmitter();request.destroy=()=>{};request.end=()=>{const response=new EventEmitter();response.statusCode=200;receive(response);response.emit('data',Buffer.from('{}'));response.emit('end');};return request;};
    const {GitlabLockExecHttpTransport}=require('../../dist/modules/gitlab-provision/lockExec.service');
    assert.equal((await new GitlabLockExecHttpTransport().request('GET','/exec/'+'a'.repeat(64)+'/json')).status,200);
  } finally {nativeHttp.request=originalRequest;}
  const {GitlabProjectCredentialService}=require('../../dist/modules/gitlab-provision/projectCredential.service');
  const scopedDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'gitlab-scoped-credential-'));
  try {
    const tokens=new Map(), bots=new Map();let creates=0, lostInvisible=true, next=40;
    const create=(pending)=>{const id=++next, token={id,user_id:id+100,name:pending.name,expires_at:pending.expiresAt,scopes:['api'],access_level:40,active:true,revoked:false,token:'project-secret-'+id};tokens.set(id,token);bots.set(token.user_id,{id:token.user_id,username:'project_7_bot_'+id,bot:true,is_admin:false,state:'active',external:false});return token;};
    const api={async request(context,secret,method,route,body){
      if(route==='projects/7')return {status:200,value:{id:7,path_with_namespace:'team/wizard'}};
      if(route==='user'){const token=[...tokens.values()].find(token=>token.token===secret);assert(token);assert(bots.get(token.user_id).external);return {status:200,value:bots.get(token.user_id)};}
      assert.equal(secret,'controller-private-token');
      if(route.startsWith('users/')){const bot=bots.get(Number(route.split('/')[1]));assert(bot);if(method==='PUT'){assert.deepEqual(body,{external:true});bot.external=true;}return {status:200,value:bot};}
      if(route.includes('/access_tokens?')){const name=new URL('http://local/'+route).searchParams.get('search');return {status:200,value:[...tokens.values()].filter(token=>token.name===name)};}
      if(route==='projects/7/access_tokens'){creates++;assert.equal(body.access_level,40);assert.deepEqual(body.scopes,['api']);if(lostInvisible){lostInvisible=false;throw Error('lost project token response');}return {status:201,value:create({name:body.name,expiresAt:body.expires_at})};}
      const token=tokens.get(Number(route.split('/').at(-1)));assert(token);if(method==='DELETE'){token.revoked=true;token.active=false;return {status:204,value:null};}return {status:200,value:token};
    }};
    const service=new GitlabProjectCredentialService(new GitlabAuthJournalService(),api), current=(now=new Date('2026-11-20T00:00:00Z'))=>service.current(nativeApiContext,scopedDirectory,7,'team/wizard','controller-private-token',now);
    await assert.rejects(()=>current(),/lost project token response/);assert.equal(creates,1);
    await assert.rejects(()=>current(),/issuance-reconciliation-required/);assert.equal(creates,1,'absent token does not authorize another mint');
    const pending=JSON.parse(fs.readFileSync(path.join(scopedDirectory,'system-bootstrapper-auth/project-credentials-7.json'))).pending;const orphan=create(pending);
    const first=await current();assert(tokens.get(orphan.id).revoked);assert.equal(creates,2);assert(bots.get(first.userId).external);
    assert.equal((await current()).id,first.id);assert.equal(creates,2);
    const renewed=await current(new Date('2027-02-10T00:00:00Z'));assert.notEqual(renewed.id,first.id);assert(tokens.get(first.id).revoked);assert(bots.get(renewed.userId).external);
    bots.get(renewed.userId).external=false;await assert.rejects(()=>current(new Date('2027-02-11T00:00:00Z')),/external-required/);
    const recovered=await service.current(nativeApiContext,scopedDirectory,7,'team/wizard','controller-private-token',new Date('2027-02-11T00:00:00Z'),true);assert.notEqual(recovered.id,renewed.id);assert(tokens.get(renewed.id).revoked);assert(bots.get(recovered.userId).external);
    await assert.rejects(()=>service.current(nativeApiContext,scopedDirectory,7,'foreign/wizard','controller-private-token'),/project-mismatch/);
  } finally {fs.rmSync(scopedDirectory,{recursive:true,force:true});}
  const {SourcePrimaryOperationService}=require('../../dist/modules/gitlab-provision/sourcePrimaryOperation.service');
  const invalidNativeActivation=require('child_process').spawnSync(process.execPath,[path.resolve(__dirname,'../../dist/modules/gitlab-provision/entry.js'),'activate','--checkout',nativeApiContext.checkout],{input:'{}',encoding:'utf8'});
  assert.equal(invalidNativeActivation.status,1);assert.equal(invalidNativeActivation.stdout,'');assert(invalidNativeActivation.stderr.includes('operation did not complete'));
  let authorized=0;
  const nativeActivation=new SourcePrimaryOperationService({async ensure(){authorized++;return {context:nativeApiContext,configDirectory:'/private/config',credential:{token:'admin-only-for-scoped-token'}};}},{async current(context,directory,id,projectPath,administrator){assert.equal(administrator,'admin-only-for-scoped-token');assert.equal(id,7);assert.equal(projectPath,'team/wizard');return {token:'scoped-operation-token'};}},{async request(context,token){assert(['admin-only-for-scoped-token','scoped-operation-token'].includes(token));return {status:200,value:{id:7}};}},{create(context,directory,id,operation,token){assert.equal(token,'scoped-operation-token');assert(/^[a-f0-9]{64}$/.test(operation));return {owned:true};}},{validate(){},async activate(input,project,session){assert(session.owned);return {environments:{phase:'ready'}};}});
  const nativeActivationInput={action:'wizard-environments-primary',projectKey:'wizard',namespaceId:9,repository:{id:7,path:'team/wizard',namespaceId:9},environments:{operation:'a'.repeat(48)}};
  assert.equal((await nativeActivation.execute(nativeApiContext.checkout,nativeActivationInput)).environments.phase,'ready');
  await assert.rejects(()=>nativeActivation.execute(nativeApiContext.checkout,{...nativeActivationInput,namespaceId:88}),/project-binding|project binding/);assert.equal(authorized,1);
  const {GitlabNativeContextService}=require('../../dist/modules/gitlab-provision/nativeContext.service');
  const {GitlabCredentialService}=require('../../dist/modules/gitlab-provision/credential.service');
  const {NestFactory}=require('../../node_modules/@nestjs/core'), {GitlabProvisionModule}=require('../../dist/modules/gitlab-provision/gitlabProvision.module');
  const provisioningModule=await NestFactory.createApplicationContext(GitlabProvisionModule,{logger:false});try {assert(provisioningModule.get(GitlabCredentialService));} finally {await provisioningModule.close();}

  const {main:credentialCommand}=require('../../dist/modules/gitlab-provision/entry');
  const unsafeCredentialDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'gitlab-credential-input-'));
  try {
    const file=path.join(unsafeCredentialDirectory,'token');fs.writeFileSync(file,'private',{mode:0o644});
    const command=()=>credentialCommand(['renew','--checkout',nativeApiContext.checkout,'--administrator-token-file',file]);
    await assert.rejects(command,/permissions-or-owner/);fs.unlinkSync(file);
    require('child_process').execFileSync('mkfifo',[file]);await assert.rejects(command,/must-be-regular/);fs.unlinkSync(file);
    fs.writeFileSync(file,'x'.repeat(4097),{mode:0o600});await assert.rejects(command,/too-large/);
  } finally {fs.rmSync(unsafeCredentialDirectory,{recursive:true,force:true});}
  const contextDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'gitlab-native-context-'));
  try {
    const local=fs.statSync(contextDirectory,{bigint:true}), contextCalls=[];
    let foreign=false, readOnly=false;
    const contexts=new GitlabNativeContextService({async run(binary,args){contextCalls.push(args);assert.equal(binary,'docker');assert.equal(args[0],'--host=unix:///var/run/docker.sock');
      if(args[1]==='inspect')return JSON.stringify({Id:nativeApiContext.containerId,Name:'/system_gitlab_1',State:{Running:true},Config:{Labels:{'com.docker.compose.project':'system','com.docker.compose.service':'gitlab'}},Mounts:[{Destination:'/etc/gitlab',Type:'volume',RW:!readOnly}]});
      assert.equal(args[2],nativeApiContext.containerId);return foreign?'1:2':`${local.dev}:${local.ino}`;
    }});
    const context=await contexts.resolve(nativeApiContext.checkout,contextDirectory);assert.equal(context.containerId,nativeApiContext.containerId);
    foreign=true;await assert.rejects(()=>contexts.resolve(nativeApiContext.checkout,contextDirectory),/config-volume-mismatch/);foreign=false;readOnly=true;await assert.rejects(()=>contexts.resolve(nativeApiContext.checkout,contextDirectory),/config-volume-required/);readOnly=false;
    let phase='bootstrap-received';const steps=[], replacement={id:4,userId:9,token:'private',expiresAt:'2027-02-01'}, account={userId:9,username:'system-bootstrapper-controller',email:'system-bootstrapper-controller@system-bootstrapper.invalid'};
    const credentials=new GitlabCredentialService(contexts,{async initial(){steps.push('initial');return {phase,replacement,...(phase==='ready'?{account}:{})};},async complete(){steps.push('complete');phase='ready';},async reconcileInitial(){steps.push('reconcile');phase='bootstrap-received';}}, {async prepare(c,d,identity){assert.deepEqual(identity,{username:account.username,email:account.email});steps.push('prepare');return replacement;},async current(){steps.push('current');return replacement;}}, {async withJournal(d,operation){return operation({read(){return {account};}});}});
    const result=await credentials.ensure({checkout:nativeApiContext.checkout,configDirectory:contextDirectory});assert.deepEqual(steps,['initial','prepare','complete','current']);assert.equal(result.credential.token,'private');
    steps.length=0;await credentials.ensure({checkout:nativeApiContext.checkout,configDirectory:contextDirectory});assert.deepEqual(steps,['initial','current']);
    await assert.rejects(()=>credentials.ensure({checkout:nativeApiContext.checkout,configDirectory:contextDirectory,identity:{username:'other',email:'other@example.test'}}),/identity-binding-mismatch/);
    phase='replacement-verified';steps.length=0;await credentials.ensure({checkout:nativeApiContext.checkout,configDirectory:contextDirectory});assert.deepEqual(steps,['initial','complete','current']);
  } finally {fs.rmSync(contextDirectory,{recursive:true,force:true});}
  const {GitlabLockExecService}=require('../../dist/modules/gitlab-provision/lockExec.service');
  const lockDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'gitlab-activation-lock-'));
  try {
    const journals=new GitlabAuthJournalService(), commands=[], executions=new Map();let nextExec=0, launches=0, cancels=0, lostStart=true, lostWrite=true, lostCancel=false, loseProofAfterWrite=false, writes=0, variable, backend;
    const transport={async request(method,route,body){
      if(route.endsWith('/exec')){const id=(++nextExec).toString(16).padStart(64,'0');executions.set(id,{command:body,running:false,exitCode:null});commands.push(body.Cmd);return {status:201,value:{Id:id}};}
      const id=route.split('/')[2], execution=executions.get(id);if(!execution)return {status:404,value:{message:'No such exec'}};
      if(route.endsWith('/json'))return {status:200,value:{ID:id,ContainerID:nativeApiContext.containerId,Running:execution.running,ExitCode:execution.exitCode,OpenStdin:false,OpenStdout:false,OpenStderr:false,ProcessConfig:{entrypoint:execution.command.Cmd[0],arguments:execution.command.Cmd.slice(1),user:execution.command.User,tty:false,privileged:false}}};
      assert(route.endsWith('/start'));assert.deepEqual(body,{Detach:true,Tty:false});
      if(execution.running||execution.exitCode!==null)return {status:409,value:{message:'already running or already run'}};
      execution.running=true;launches++;backend={pid:1234,started:'1763668800.123456'};
      if(lostStart){lostStart=false;throw Object.assign(Error('lost detached start response'),{uncertain:true});}
      return {status:200,value:null};
    }};
    const database={async open(){return {main:0,ci:1,databases:[0,1],command(index,options){assert.equal(index,0);return ['exec','--user','998:998',nativeApiContext.containerId,'env','-i','PATH=/usr/bin:/bin','HOME=/tmp/owned','/opt/gitlab/embedded/bin/psql','--dbname','service=database0 application_name='+options.applicationName];},async query(index,sql){assert.equal(index,0);if(sql.includes('pg_cancel_backend')){cancels++;assert(sql.includes("EXTRACT(EPOCH FROM backend_start)::text='1763668800.123456'"));backend=undefined;for(const execution of executions.values())if(execution.running){execution.running=false;execution.exitCode=3;}if(lostCancel){lostCancel=false;throw Error('lost cancellation response');}return 't';}assert(sql.includes("l.locktype='advisory'"));assert(sql.includes('l.classid=0::oid AND l.objid=42::oid AND l.objsubid=1'));return JSON.stringify(backend?[backend]:[]);},async close(){}};}};
    const api={async request(context,token,method,route,body){assert.equal(token,'project-private-token');if(method==='GET')return {status:variable?200:404,value:variable||{message:'not found'}};
      const journal=JSON.parse(fs.readFileSync(path.join(lockDirectory,'system-bootstrapper-auth/project-7.json')));assert.equal(journal.phase,'held');assert.equal(journal.backend.pid,1234);assert(journal.pending);
      writes++;variable={...body};if(loseProofAfterWrite){loseProofAfterWrite=false;backend=undefined;}if(lostWrite){lostWrite=false;throw Object.assign(Error('lost variable response'),{uncertain:true});}return {status:200,value:variable};}};
    const service=()=>new GitlabActivationSessionService(journals,database,api,new GitlabLockExecService(transport),{async run(){throw Error('unexpected process');}});
    const session=()=>service().create(nativeApiContext,lockDirectory,7,'a'.repeat(64),'project-private-token');
    let current=session();await assert.rejects(()=>current.withAdvisoryLock('42',async()=>{}),/lost detached start response/);assert.equal(launches,1);assert.equal(nextExec,1);
    const body={key:'WIZARD_REVIEW_HOST',value:'review.example.test',environment_scope:'*',variable_type:'env_var',protected:false,masked:false,raw:true};
    current=session();await assert.rejects(()=>current.withAdvisoryLock('42',()=>current.request('PUT','projects/7/variables/WIZARD_REVIEW_HOST',body)),/lost variable response/);
    assert.equal(launches,1,'same Exec ID must not execute twice');assert.equal(nextExec,1);assert.equal(cancels,0,'uncertain write retains database barrier');
    const recorded=JSON.parse(fs.readFileSync(path.join(lockDirectory,'system-bootstrapper-auth/project-7.json')));assert.equal(recorded.pending.body.value,body.value);assert(commands[0].at(-1).includes('pg_try_advisory_lock(42::bigint)'));
    backend={pid:9999,started:'1763668800.123456'};current=session();await assert.rejects(()=>current.withAdvisoryLock('42',async()=>{}),/backend-ownership-lost/);assert.equal(cancels,0);backend={pid:1234,started:'1763668800.123456'};
    variable={...body,value:'foreign'};current=session();await assert.rejects(()=>current.withAdvisoryLock('42',async()=>{}),/write-reconciliation-required/);assert.equal(cancels,0);
    variable={...body};current=session();await current.withAdvisoryLock('42',async()=>{});assert.equal(cancels,1);assert.equal(launches,1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(lockDirectory,'system-bootstrapper-auth/project-7.json'))).phase,'idle');
    current=session();lostCancel=true;await assert.rejects(()=>current.withAdvisoryLock('42',async()=>{}),/lost cancellation response/);
    executions.clear(); // Docker may garbage-collect completed execs before the controller retries.
    current=session();await assert.rejects(()=>current.withAdvisoryLock('42',async()=>{}),/release-reconciled-retry/);assert.equal(launches,2);assert.equal(cancels,2);
    current=session();await current.withAdvisoryLock('42',async()=>{await assert.rejects(()=>current.request('POST','projects/7/repository/commits',{branch:'main',actions:[]}),/write-route-invalid/);const original=backend, before=writes;backend=undefined;await assert.rejects(()=>current.request('PUT','projects/7/variables/WIZARD_REVIEW_HOST',body),/backend-ownership-lost/);assert.equal(writes,before);backend=original;});
    current=session();await assert.rejects(()=>current.withAdvisoryLock('42',async()=>{backend=undefined;for(const execution of executions.values()){execution.running=false;execution.exitCode=3;}throw Error('database holder exited');}),/release-ownership-lost/);
    current=session();await assert.rejects(()=>current.withAdvisoryLock('42',async()=>{}),/release-reconciled-retry/);
    current=session();loseProofAfterWrite=true;await assert.rejects(()=>current.withAdvisoryLock('42',()=>current.request('PUT','projects/7/variables/WIZARD_REVIEW_HOST',body)),/backend-ownership-lost/);
    assert(JSON.parse(fs.readFileSync(path.join(lockDirectory,'system-bootstrapper-auth/project-7.json'))).pending,'successful response without lock proof must retain pending write');

    // Recipe writes use the same native lock holder and retain only bounded readback proofs.
    const recipeParent='a'.repeat(40),recipeCommit='b'.repeat(40),recipeOperation='c'.repeat(48),recipeRows={
      'projects/7/repository/branches/main':{commit:{id:recipeParent}},
      'projects/7/repository/files/.system-bootstrapper%2Fci.yml?ref=main':{content:Buffer.from('recipe').toString('base64'),last_commit_id:recipeCommit},
      ['projects/7/repository/commits/'+recipeCommit]:{parent_ids:[recipeParent]},
      ['projects/7/pipelines?ref=main&sha='+recipeCommit+'&source=api&per_page=100&page=1']:[],
    };
    let recipePosts=0;
    api.request=async(context,token,method,route,body)=>{
      assert.equal(token,'project-private-token');
      if(method==='GET')return {status:recipeRows[route]?200:404,value:recipeRows[route]||{}};
      recipePosts++;const journal=JSON.parse(fs.readFileSync(path.join(lockDirectory,'system-bootstrapper-auth/project-build-7.json')));
      assert(journal.pending);assert.equal(journal.phase,'held');assert(!JSON.stringify(journal.pending).includes('"content"'));
      throw Error('lost recipe response');
    };
    const recipeSession=()=>service().create(nativeApiContext,lockDirectory,7,'b'.repeat(64),'project-private-token','build');
    current=recipeSession();await assert.rejects(()=>current.withAdvisoryLock('42',()=>current.request('POST','projects/7/repository/commits',{branch:'main',actions:[{action:'update',file_path:'.system-bootstrapper/ci.yml',content:'recipe',last_commit_id:recipeParent}]})),/lost recipe response/);
    assert.equal(recipePosts,1);current=recipeSession();await current.withAdvisoryLock('42',async()=>{});assert.equal(recipePosts,1);
    const pipelineBody={ref:'main',variables:[{key:'SYSTEM_WIZARD_OPERATION',value:recipeOperation},{key:'SYSTEM_WIZARD_EXPECTED_SHA',value:recipeCommit}]};
    current=recipeSession();await assert.rejects(()=>current.withAdvisoryLock('42',()=>current.request('POST','projects/7/pipeline',pipelineBody)),/lost recipe response/);
    const cancelCount=cancels;current=recipeSession();await current.withAdvisoryLock('42',async()=>{await assert.rejects(()=>current.request('POST','projects/7/pipeline',pipelineBody),/held-lock-required/);});
    assert.equal(cancels,cancelCount);assert.equal(recipePosts,2,'missing pipeline proof must never replay POST');
    recipeRows['projects/7/pipelines?ref=main&sha='+recipeCommit+'&source=api&per_page=100&page=1']=[{id:19,sha:recipeCommit,ref:'main',source:'api'}];
    recipeRows['projects/7/pipelines/19/variables']=[{key:'SYSTEM_WIZARD_OPERATION',value:recipeOperation}];
    current=recipeSession();await current.withAdvisoryLock('42',async()=>{});assert.equal(cancels,cancelCount+1);assert.equal(recipePosts,2);

  } finally {fs.rmSync(lockDirectory,{recursive:true,force:true});}
  // Shared typed activation: the same reservation survives uncertain writes.
  const {SourcePrimaryActivationService} = require('../../dist/modules/gitlab-provision/sourcePrimaryActivation.service');
  const activationService = new SourcePrimaryActivationService();
  const activationFiles = ['.gitlab/primary.yml', '.gitlab/delivery/environment.sh'].map(path => ({path, sha256: crypto.createHash('sha256').update('owned').digest('hex')}));
  const activationProject = {id: 7, path_with_namespace: 'team/wizard', default_branch: 'main', namespace: {id: 9}, ci_config_path: '.gitlab/primary.yml', visibility: 'private', only_allow_merge_if_pipeline_succeeds: true, only_allow_merge_if_all_discussions_are_resolved: true};
  const activationEnvironment = {version: 1, managementMode: 'source-primary', operation: 'a'.repeat(48), helperImage: 'sha256:'+'b'.repeat(64), controller: 'system_bootstrapper_1', activationCommit: 'c'.repeat(40), ciFiles: activationFiles, settings: {review: {enabled: true, host: 'review.example.test'}, beta: {enabled: false, host: ''}}, initialVariablesMissing: true, deployments: {review: {lastPipelineId: 43, stoppedThroughPipelineId: 43}}};
  const activationInput = {action: 'wizard-environments-primary', controller: 'system_bootstrapper_1', repository: {id: 7, path: 'team/wizard', defaultBranch: 'main', namespaceId: 9, managementMode: 'source-primary'}, sourcePrimary: {version: 1, bootstrap: true, adoptionCommit: 'c'.repeat(40), ciFiles: activationFiles}, environments: activationEnvironment};
  const activationVariables = new Map(), activationWrites = [];let activationLocked = false, loseActivationResponse = true;
  const activationSession = {
    async withAdvisoryLock(key, execute) {
      assert.equal(key, BigInt('0x'+crypto.createHash('sha256').update('system-wizard-environments:7').digest('hex').slice(0,15)).toString());
      assert(!activationLocked);activationLocked=true;try{return await execute();}finally{activationLocked=false;}
    },
    async request(method, route, body) {
      if (route.includes('/repository/branches/')) return {status:200,value:{commit:{id:'d'.repeat(40)}}};
      if (route.includes('/repository/files/')) return {status:200,value:{content:Buffer.from('owned').toString('base64')}};
      assert(activationLocked, 'All variable reads and writes require the same advisory lock');
      const name = route.split('/variables/')[1]?.split('?')[0];
      if(method==='GET') return {status:activationVariables.has(name)?200:404,value:activationVariables.get(name)};
      activationWrites.push(body.key);activationVariables.set(body.key,{...body});
      if(loseActivationResponse){loseActivationResponse=false;throw Error('applied write with lost response');}
      return {status:201,value:body};
    }
  };
  const activate = () => activationService.activate(activationInput, activationProject, activationSession);
  activationInput.action='wizard-environments-primary-status';assert.equal((await activate()).environments.phase,'pending');assert.equal(activationWrites.length,0);assert.equal(activationVariables.size,0);
  activationInput.action='wizard-environments-primary';
  assert.equal((await activate()).environments.phase,'pending');assert.equal(activationWrites.length,1);assert(!activationLocked);
  activationInput.action='wizard-environments-primary-status';assert.equal((await activate()).environments.phase,'pending');assert.equal(activationWrites.length,1);
  activationInput.action='wizard-environments-primary';assert.equal((await activate()).environments.phase,'ready');assert.equal(activationWrites.length,4);
  activationInput.action='wizard-environments-primary-status';assert.equal((await activate()).environments.phase,'ready');assert.equal(activationWrites.length,4);
  assert.equal(activationEnvironment.deployments.review.lastPipelineId,43);
  activationVariables.get('WIZARD_REVIEW_HOST').value='foreign.example.test';assert.equal((await activate()).environments.phase,'requires-reconciliation');assert.equal(activationWrites.length,4);
  activationVariables.delete('WIZARD_REVIEW_HOST');activationInput.sourcePrimary.bootstrap=false;assert.equal((await activate()).environments.phase,'requires-reconciliation');assert.equal(activationWrites.length,4);
  activationVariables.set('WIZARD_REVIEW_HOST',{key:'WIZARD_REVIEW_HOST',value:'review.example.test',environment_scope:'*',variable_type:'env_var',protected:false,masked:false,raw:true});
  const readyReads = new Map();
  const raceSession = {...activationSession, async request(method, route, body) {
    if (method==='GET' && route.includes('/variables/')) {
      const name=route.split('/variables/')[1].split('?')[0], count=(readyReads.get(name)||0)+1;readyReads.set(name,count);
      if(name==='WIZARD_REVIEW_HOST'&&count===2)activationVariables.get(name).value='foreign.example.test';
    }
    return activationSession.request(method,route,body);
  }};
  await assert.rejects(()=>activationService.activate(activationInput,activationProject,raceSession),/changed after synchronization/);
  assert.equal(activationWrites.length,4,'A ready status check must never repair a concurrent variable change');
  activationVariables.get('WIZARD_REVIEW_HOST').value='review.example.test';activationVariables.get('WIZARD_REVIEW_HOST').hidden=true;
  await assert.rejects(activate,/variable ownership changed/);delete activationVariables.get('WIZARD_REVIEW_HOST').hidden;
  await assert.rejects(()=>activationService.activate(activationInput,activationProject,{...activationSession,async withAdvisoryLock(){throw Error('busy');}}),/busy/);
  assert.equal(activationWrites.length,4);
  // Settings changes resume from previous owned values, preserving generation floors.
  const previousEnvironment = structuredClone(activationEnvironment);
  const nextEnvironment = structuredClone(previousEnvironment);
  nextEnvironment.operation = '3'.repeat(48);
  nextEnvironment.settings.review.host = 'new-review.example.test';
  activationInput.previousEnvironments = previousEnvironment;
  activationInput.environments = nextEnvironment;
  activationInput.action = 'wizard-environments-primary';
  loseActivationResponse = true;
  assert.equal((await activate()).environments.phase, 'pending');
  assert.deepEqual(activationWrites.slice(4), ['SYSTEM_WIZARD_ENVIRONMENT_OPERATION']);
  activationInput.action = 'wizard-environments-primary-status';
  assert.equal((await activate()).environments.phase, 'pending');assert.equal(activationWrites.length, 5);
  activationInput.action = 'wizard-environments-primary';
  assert.equal((await activate()).environments.phase, 'ready');
  assert.deepEqual(activationWrites.slice(4), ['SYSTEM_WIZARD_ENVIRONMENT_OPERATION', 'WIZARD_REVIEW_HOST']);
  assert.deepEqual(nextEnvironment.deployments, previousEnvironment.deployments);
  activationInput.action = 'wizard-environments-primary-status';
  assert.equal((await activate()).environments.phase, 'ready');assert.equal(activationWrites.length, 6);
  activationVariables.get('WIZARD_REVIEW_HOST').value = 'foreign.example.test';
  assert.equal((await activate()).environments.phase, 'requires-reconciliation');assert.equal(activationWrites.length, 6);
  activationProject.visibility='public';await assert.rejects(activate,/ownership changed/);assert(!activationLocked);
  console.log('Source-primary adoption: exact ownership/native evidence, versioned rebind/refusals, metadata-only refresh with unchanged Production/native CI/recovery aliases, preserved private history/floors, CAS, shared mutex, idempotency and initial private-image guard passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
