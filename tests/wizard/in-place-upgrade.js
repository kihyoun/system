'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');
const {Upgrade, sourceMarker, buildMarker, environmentMarker, readConfiguration} = require('../../project-bootstrap/wizard-upgrade/run');
const {hash, signature} = require('../../project-bootstrap/wizard-production/run');
const builds = require('../../project-bootstrap/wizard-build/recipe');
const environments = require('../../project-bootstrap/wizard-environments/recipe');
const logo = require('../../sync/dist/Helper').default.textLogo;
const currentSource = JSON.parse(fs.readFileSync(path.join(__dirname, '../../project-bootstrap/wizard-source/snapshot.json'), 'utf8')).sourceRevision;
const helper = 'sha256:' + 'b'.repeat(64), oldHelper = 'sha256:' + 'a'.repeat(64);
const sourceFile = (name, content, mode = '100644') => ({path: name, mode, sha256: hash(content), content: Buffer.from(content).toString('base64')});
function snapshot(revision, files) {
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifest = {version: 1, sourceRevision: revision, files: files.map(({path, mode, sha256}) => ({path, mode, sha256}))};
  return {...manifest, manifestHash: hash(JSON.stringify(manifest)), files};
}
class Fixture {
  constructor(modern = false) {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-upgrade-'));
    this.config = path.join(this.root, '.wizard.env'); this.mainConfig = path.join(this.root, '.docker.env'); this.directory = path.join(this.root, 'checkpoints');
    this.commits = new Map(); this.branches = new Map(); this.posts = []; this.mrs = []; this.serial = 10;
    const oldSource = snapshot('c'.repeat(40), [sourceFile('package.json', modern ? '{"devDependencies":{"vite":"8.3.4"}}' : '{"dependencies":{"react-scripts":"4"}}'),
      sourceFile('src/api/Helper.tsx', logo), sourceFile('.gitlab-ci.yml', '# Upstream roles preserved\n'), sourceFile('obsolete-cra.js', 'old\n'),
      ...(modern ? [sourceFile('src/App.tsx', 'export default function App() {}\n')] : [])]);
    this.snapshot = snapshot(currentSource, [sourceFile('package.json', '{"devDependencies":{"vite":"8.3.4"}}'),
      sourceFile('src/api/Helper.tsx', logo), sourceFile('.gitlab-ci.yml', '# Upstream roles preserved\n'), sourceFile('scripts/check.sh', '#!/bin/sh\ntrue\n', '100755')]);
    const settings = {review: {enabled: true, domainMode: 2, host: 'review.example.test', ssl: '/ssl/cert.pem', sslKey: '/ssl/key.pem'}, beta: {enabled: true, domainMode: 2, host: 'beta.example.test', ssl: '/ssl/cert.pem', sslKey: '/ssl/key.pem'}};
    const build = builds.generate(logo, typeof modern === 'string' ? modern : modern ? 'node24-vite8' : 'legacy'), environment = {version: 1, operation: 'd'.repeat(48), phase: 'ready', settings,
      settingsHash: hash(JSON.stringify(settings)), helperImage: oldHelper, controller: 'system_bootstrapper_1',
      deployments: {review: {active: null, pending: null, lastPipelineId: 6, stoppedThroughPipelineId: 6,
        tombstone: {projectId: 1, pipelineId: 6, sourceCommit: 'e'.repeat(40), operation: 'd'.repeat(48)}, retired: []}, beta: {active: null, pending: null, stoppedThroughPipelineId: 7}}};
    if (modern) environment.buildRecipeHash = build.recipeHash;
    const envRecipe = environments.generate(logo, environment); environment.recipeHash = envRecipe.recipeHash;
    this.receipt = {version: 1, defaultProject: true, template: 'wizard', state: 'complete', operation: 'f'.repeat(48), namespaceId: 1,
      registrationExtra: 'preserve-me', repository: {id: 1, path: 'root/wizard', defaultBranch: 'main', ciPath: '.system-bootstrapper/ci.yml', systemProject: true},
      wizardWorkflow: {version: 1, operation: '1'.repeat(48), phase: 'source-imported', sourceRevision: oldSource.sourceRevision, manifestHash: oldSource.manifestHash,
        importCommit: '1'.repeat(40), build: {version: 1, operation: '2'.repeat(48), phase: 'candidate-verified', recipeHash: build.recipeHash, activationCommit: '2'.repeat(40)}, environments: environment}};
    this.project = {id: 1, visibility: 'private', path_with_namespace: 'root/wizard', default_branch: 'main', ci_config_path: '.system-bootstrapper/ci.yml',
      description: 'System Bootstrapper operation ' + this.receipt.operation, merge_method: 'merge'};
    const oldFiles = new Map();
    for (const file of oldSource.files) oldFiles.set(file.path, this.row(Buffer.from(file.content, 'base64'), '1'.repeat(40), file.mode === '100755'));
    oldFiles.set('.system-bootstrapper/wizard-source.json', this.row(sourceMarker(this.receipt, oldSource), '1'.repeat(40)));
    oldFiles.set('user-notes.md', this.row('custom project file\n', '0'.repeat(40)));
    this.commits.set('1'.repeat(40), {id: '1'.repeat(40), parent_ids: ['0'.repeat(40)], files: new Map(oldFiles)});
    for (const file of [...build.files, {path: '.system-bootstrapper/wizard-build.json', content: buildMarker(this.receipt.wizardWorkflow.build, this.receipt.wizardWorkflow)}]) oldFiles.set(file.path, this.row(file.content, '2'.repeat(40)));
    oldFiles.set('.system-bootstrapper/ci.yml', this.row(build.ci, '2'.repeat(40)));
    this.commits.set('2'.repeat(40), {id: '2'.repeat(40), parent_ids: ['1'.repeat(40)], files: new Map(oldFiles)});
    environment.activationCommit = '3'.repeat(40);
    for (const file of [...envRecipe.files, {path: '.system-bootstrapper/wizard-environments.json', content: environmentMarker(environment, '2'.repeat(40))}, {path: '.system-bootstrapper/ci.yml', content: envRecipe.ci}]) oldFiles.set(file.path, this.row(file.content, '3'.repeat(40)));
    this.commits.set('3'.repeat(40), {id: '3'.repeat(40), parent_ids: ['2'.repeat(40)], files: oldFiles}); this.branches.set('main', '3'.repeat(40));
    if (modern) {
      // Ordinary user development after import must remain byte-for-byte, with
      // its last-change identity intact through the recipe-only migration.
      const files = new Map(oldFiles);
      files.set('src/App.tsx', this.row('export default function App() {}\n// User development survives\n', '4'.repeat(40)));
      files.set('local-tool.sh', this.row('#!/bin/sh\ntrue\n', '4'.repeat(40), true));
      files.delete('obsolete-cra.js');
      this.commits.set('4'.repeat(40), {id: '4'.repeat(40), parent_ids: ['3'.repeat(40)], files}); this.branches.set('main', '4'.repeat(40));
      for (const [kind, floor] of [['review', 43], ['beta', 44]]) environment.deployments[kind] = {active: null, pending: null, retired: [],
        lastPipelineId: floor, stoppedThroughPipelineId: floor, tombstone: {id: 'p' + floor + '-j' + (kind === 'review' ? 132 : 136)}};
    }
    this.writeReceipt();
    fs.writeFileSync(this.mainConfig, logo + "export GITLAB_HOST='gitlab.example.test'\nexport GITLAB_REGISTRY_URL='https://registry.example.test'\nexport GITLAB_REGISTRY_DOMAIN_MODE='2'\n");
    this.upgrade = new Upgrade({...this, helperImage: helper, request: this.request.bind(this), checkHelper: async () => { if (this.badHelper) throw Error('Helper dependency mismatch'); }});
  }
  row(content, commit, executable = false) { return {content: Buffer.from(content).toString('base64'), last_commit_id: commit, execute_filemode: executable}; }
  writeReceipt() { fs.writeFileSync(this.config, logo + "export PRIVATE_VALUE='never-in-plan'\n# BOOTSTRAPPER_PROJECT=" + Buffer.from(JSON.stringify(this.receipt)).toString('base64') + '\n'); }
  ref(ref) { return this.commits.get(this.branches.get(ref) || ref); }
  async request(method, route, body) {
    const url = new URL('https://gitlab.example.test/api/v4/' + route), endpoint = url.pathname.replace('/api/v4/', '');
    if (method === 'GET' && endpoint === 'projects/1') return structuredClone(this.project);
    const rest = endpoint.replace(/^projects\/1\//, '');
    if (method === 'GET' && rest.startsWith('repository/branches/')) return {commit: {id: this.branches.get(decodeURIComponent(rest.slice(20)))}};
    if (method === 'GET' && rest === 'repository/branches') return [...this.branches].filter(([name]) => name === url.searchParams.get('search').slice(1, -1)).map(([name, id]) => ({name, commit: {id}}));
    if (method === 'GET' && rest.startsWith('repository/files/')) {
      const name = decodeURIComponent(rest.slice(17)), row = this.ref(url.searchParams.get('ref'))?.files.get(name);
      if (!row) throw Error('Missing file: ' + name); return structuredClone(row);
    }
    if (method === 'GET' && rest === 'repository/tree') return [...this.ref(url.searchParams.get('ref')).files].map(([name, row]) => ({type: 'blob', path: name, mode: row.execute_filemode ? '100755' : '100644'})).slice((Number(url.searchParams.get('page')) - 1) * 100, Number(url.searchParams.get('page')) * 100);
    if (method === 'GET' && rest.startsWith('repository/commits/')) {
      const {files, ...row} = this.commits.get(rest.slice(19)); return structuredClone(row);
    }
    if (method === 'POST' && rest === 'repository/branches') { this.posts.push('branch'); this.branches.set(body.branch, body.ref); return {name: body.branch}; }
    if (method === 'POST' && rest === 'repository/commits') {
      const name = /v1: ([a-z]+)/.exec(body.commit_message)[1]; this.posts.push(name);
      const parent = this.branches.get(body.branch), files = new Map(this.commits.get(parent).files), id = (++this.serial).toString(16).padStart(40, '0');
      for (const action of body.actions) {
        const old = files.get(action.file_path);
        if (action.action === 'delete') { assert(old); files.delete(action.file_path); continue; }
        if (action.action === 'chmod') {
          assert(old); if (old.execute_filemode !== action.execute_filemode) files.set(action.file_path, {...old, execute_filemode: action.execute_filemode, last_commit_id: id}); continue;
        }
        assert.equal(!!old, action.action === 'update', 'GitLab create/update occupancy semantics');
        const content = action.encoding === 'base64' ? Buffer.from(action.content, 'base64') : Buffer.from(action.content);
        // GitLab no-op writes retain the older last-change commit. This is why
        // the migration needs its skipped preparation and fast-forward policy.
        files.set(action.file_path, old && old.content === content.toString('base64') ? old : this.row(content, id, old?.execute_filemode));
      }
      this.commits.set(id, {id, parent_ids: [parent], files}); this.branches.set(body.branch, id);
      if (name === 'environment') { this.mrs[0].sha = id; this.pipeline = {id: 8, sha: id, source: 'merge_request_event', status: 'success', web_url: 'https://gitlab.example.test/pipeline/8'}; }
      if (this.lostResponse === name) { this.lostResponse = undefined; throw Error('Lost commit response'); }
      return {id};
    }
    if (method === 'GET' && rest === 'merge_requests') return structuredClone(this.mrs);
    if (method === 'POST' && rest === 'merge_requests') {
      this.posts.push('mr'); const row = {iid: 1, state: 'opened', source_project_id: 1, target_project_id: 1, source_branch: body.source_branch,
        target_branch: 'main', sha: this.branches.get(body.source_branch), web_url: 'https://gitlab.example.test/mr/1'}; this.mrs.push(row); return structuredClone(row);
    }
    if (method === 'GET' && rest === 'merge_requests/1') return structuredClone(this.mrs[0]);
    if (method === 'GET' && rest === 'merge_requests/1/pipelines') return this.pipeline ? [structuredClone(this.pipeline)] : [];
    if (method === 'GET' && rest === 'pipelines/8') return structuredClone(this.pipeline);
    if (method === 'GET' && rest === 'pipelines/8/jobs') return ['build:wizard', 'test:wizard'].map((name, i) => ({id: i + 20, name, status: this.badJob ? 'failed' : 'success', allow_failure: false, commit: {id: this.pipeline.sha}}));
    if (method === 'GET' && /^jobs\/2[01]\/artifacts\//.test(rest)) {
      const common = {version: 1, sourceCommit: this.pipeline.sha, pipelineId: 8, imageRef: (this.foreignRegistry ? 'evil.example/' : 'registry.example.test/') + 'root/wizard@sha256:' + 'e'.repeat(64)};
      return rest.includes('jobs/20') ? {...common, unitTests: true, testRunner: 'vitest', lint: true, typecheck: true, productionBuild: true} :
        {...common, http: true, renderedUI: true, projects: true, spa: true, configurationBackup: true, cubeSignature: !this.badCube};
    }
    throw Error('Unexpected fake API: ' + method + ' ' + route);
  }
  async stage() { this.plan = await this.upgrade.plan(); return this.upgrade.stage(this.plan.planHash); }
  merge() { this.project.merge_method = 'ff'; this.mrs[0].state = 'merged'; this.branches.set('main', this.mrs[0].sha); }
  async adopt() { const plan = await this.upgrade.adoptionPlan(); return this.upgrade.adopt(plan.planHash); }
  destroy() { fs.rmSync(this.root, {recursive: true, force: true}); }
}
async function test(name, run, modern = false) { const f = new Fixture(modern); try { await run(f); console.log('In-place Wizard upgrade: ' + name + ' passed.'); } finally { f.destroy(); } }
(async () => {
  await test('actual Git deletion/recreation and fast-forward retain no-op file provenance', async f => {
    const repository = path.join(f.root, 'git-provenance'); fs.mkdirSync(repository);
    const git = (...args) => execFileSync('git', ['-C', repository, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
    fs.writeFileSync(path.join(repository, 'same.txt'), logo); git('add', '.'); git('commit', '-m', 'Original source');
    const old = git('rev-parse', 'HEAD'); git('checkout', '-b', 'upgrade');
    git('rm', 'same.txt'); git('commit', '-m', 'Skipped preparation');
    fs.writeFileSync(path.join(repository, 'same.txt'), logo); git('add', '.'); git('commit', '-m', 'Recreate source');
    const imported = git('rev-parse', 'HEAD'); git('checkout', 'main'); git('merge', '--ff-only', 'upgrade');
    assert.equal(git('rev-parse', 'HEAD'), imported); assert.equal(git('log', '-1', '--format=%H', '--', 'same.txt'), imported);
    assert.notEqual(imported, old); assert.equal(fs.readFileSync(path.join(repository, 'same.txt'), 'utf8'), logo);
  });
  await test('read-only plan, exact confirmation, own project and source edit guards', async f => {
    const before = fs.readFileSync(f.config, 'utf8'), plan = await f.upgrade.plan();
    assert.equal(f.posts.length, 0); assert(!fs.existsSync(f.directory)); assert(!JSON.stringify(plan.publicPlan).includes('never-in-plan'));
    await assert.rejects(f.upgrade.stage('stale'), /Preview and confirm/); assert.equal(fs.readFileSync(f.config, 'utf8'), before);
    f.project.visibility = 'public'; await assert.rejects(f.upgrade.plan(), /identity/); f.project.visibility = 'private';
    f.ref('main').files.set('package.json', f.row('custom development', '9'.repeat(40))); await assert.rejects(f.upgrade.plan(), /content changed/);
  });
  await test('active, pending and retired generations refuse migration', async f => {
    for (const state of [{active: {id: 1}}, {pending: {id: 2}}, {retired: [{id: 3}]}]) {
      const old = f.receipt.wizardWorkflow.environments.deployments.review;
      f.receipt.wizardWorkflow.environments.deployments.review = {...old, ...state}; f.writeReceipt();
      await assert.rejects(f.upgrade.plan(), /leases/); f.receipt.wizardWorkflow.environments.deployments.review = old;
    }
  });
  await test('unreviewed helper refuses GitLab mutations before checkpoint creation', async f => {
    f.badHelper = true; await assert.rejects(f.stage(), /Helper dependency mismatch/);
    assert.deepEqual(f.posts, []); assert(!fs.existsSync(f.directory)); assert(!fs.existsSync(f.upgrade.lock));
  });
  await test('single project/MR, separate main, recreated no-op files, retry and private checkpoint', async f => {
    const before = fs.readFileSync(f.config, 'utf8'), staged = await f.stage();
    assert.equal(f.branches.get('main'), '3'.repeat(40)); assert.equal(fs.readFileSync(f.config, 'utf8'), before); assert.equal(f.mrs.length, 1);
    assert.equal(f.ref(staged.environmentCommit).files.get('src/api/Helper.tsx').last_commit_id, staged.sourceCommit);
    assert(f.ref(staged.environmentCommit).files.get('scripts/check.sh').execute_filemode);
    assert.equal(f.ref(staged.environmentCommit).files.get('user-notes.md').last_commit_id, '0'.repeat(40));
    assert(!f.ref(staged.environmentCommit).files.has('obsolete-cra.js'));
    const posts = [...f.posts]; await f.upgrade.stage(f.plan.planHash); assert.deepEqual(f.posts, posts);
    assert.equal(fs.statSync(f.upgrade.checkpointPath(f.plan.publicPlan.operation)).mode & 0o777, 0o600); assert(!fs.existsSync(f.upgrade.lock));
  });
  await test('lost commit response reconciles the existing generation without duplicate POST', async f => {
    f.lostResponse = 'source'; await assert.rejects(f.stage(), /Lost commit response/);
    await f.upgrade.stage(f.plan.planHash); assert.equal(f.posts.filter(name => name === 'source').length, 1); assert.equal(f.mrs.length, 1);
  });
  await test('uncertain unobserved commit refuses a blind second POST', async f => {
    const original = f.upgrade.request;
    f.upgrade.request = async (method, route, body, expected) => {
      if (method === 'POST' && route.endsWith('repository/commits')) throw Error('Connection lost before observable result');
      return original(method, route, body, expected);
    };
    await assert.rejects(f.stage(), /Connection lost/); f.upgrade.request = original;
    await assert.rejects(f.upgrade.stage(f.plan.planHash), /administrator reconciliation/); assert.equal(f.posts.filter(name => name === 'preparation').length, 0);
  });
  await test('only reviewed FF merge plus modern exact artifacts can be adopted', async f => {
    await f.stage(); await assert.rejects(f.upgrade.adoptionPlan(), /fast-forward/);
    f.merge(); f.badJob = true; await assert.rejects(f.upgrade.adoptionPlan(), /required and successful/); f.badJob = false;
    f.badCube = true; await assert.rejects(f.upgrade.adoptionPlan(), /evidence/); f.badCube = false;
    f.foreignRegistry = true; await assert.rejects(f.upgrade.adoptionPlan(), /evidence/); f.foreignRegistry = false;
    const result = await f.adopt(); assert.equal(result.projectId, 1); assert.equal(result.sourceRevision, currentSource);
    const data = readConfiguration(f.config), workflow = data.receipt.wizardWorkflow; signature(data.text);
    assert.equal(data.receipt.registrationExtra, 'preserve-me'); assert.deepEqual(workflow.environments.deployments, f.receipt.wizardWorkflow.environments.deployments);
    assert.equal(workflow.upgradeHistory[0].previous.sourceRevision, 'c'.repeat(40)); assert.equal(workflow.upgradeHistory[0].previous.build.recipeHash, f.receipt.wizardWorkflow.build.recipeHash);
    assert.equal(workflow.environments.helperImage, helper); assert.equal(workflow.build.artifact.sourceCommit, f.pipeline.sha);
    assert.equal((await f.adopt()).unchanged, true);
  });
  await test('concurrent configuration, main, settings and managed recipe changes refuse adoption', async f => {
    await f.stage(); f.merge(); const originalConfig = fs.readFileSync(f.config, 'utf8');
    fs.appendFileSync(f.config, '# external edit\n'); await assert.rejects(f.upgrade.adoptionPlan(), /configuration changed/); fs.writeFileSync(f.config, originalConfig);
    const oldHead = f.branches.get('main'); f.branches.set('main', '3'.repeat(40)); await assert.rejects(f.upgrade.adoptionPlan(), /Fast-forward/); f.branches.set('main', oldHead);
    const main = fs.readFileSync(f.mainConfig, 'utf8'); fs.appendFileSync(f.mainConfig, '# external edit\n'); await assert.rejects(f.upgrade.adoptionPlan(), /configuration changed/); fs.writeFileSync(f.mainConfig, main);
    const files = f.ref('main').files, key = '.system-bootstrapper/build-v1/cleanup.sh', oldFile = files.get(key);
    files.set(key, f.row('custom script', oldHead)); await assert.rejects(f.upgrade.adoptionPlan(), /content changed/); files.set(key, oldFile);
    const plan = await f.upgrade.adoptionPlan(); fs.mkdirSync(f.upgrade.lock); await assert.rejects(f.upgrade.adopt(plan.planHash), /EEXIST/); fs.rmdirSync(f.upgrade.lock);
    await assert.rejects(f.upgrade.adopt('stale'), /Preview and confirm/);
  });
  await test('recipe-only upgrade preserves edited/deleted/new source and import-marker history through all three commits', async f => {
    await assert.rejects(f.upgrade.plan(), /content changed|Missing file/);
    const original = fs.readFileSync(f.config, 'utf8'), originalWorkflow = structuredClone(f.receipt.wizardWorkflow);
    const plan = await f.upgrade.plan(true); assert.equal(plan.publicPlan.scope, 'build-environment');
    assert(!plan.publicPlan.updates.includes('src/App.tsx')); assert.deepEqual(plan.publicPlan.deletes, []);
    assert.equal(f.posts.length, 0); assert(!fs.existsSync(f.directory));
    const preserved = await f.upgrade.preservedTree(f.receipt, 'main', plan.publicPlan.managedPaths);
    const staged = await f.upgrade.stage(plan.planHash, true), checkpoint = f.upgrade.load(plan.publicPlan.operation);
    assert.equal(staged.sourceCommit, originalWorkflow.importCommit); assert(!checkpoint.commits.source);
    assert.deepEqual(f.posts, ['branch', 'preparation', 'build', 'mr', 'environment']);
    assert.equal(fs.readFileSync(f.config, 'utf8'), original); assert.equal(f.branches.get('main'), '4'.repeat(40));
    for (const commit of Object.values(checkpoint.commits)) {
      assert.deepEqual(await f.upgrade.preservedTree(f.receipt, commit, plan.publicPlan.managedPaths), preserved);
      assert.equal(f.ref(commit).files.get('.system-bootstrapper/wizard-source.json').last_commit_id, originalWorkflow.importCommit);
    }
    assert.equal(f.ref(staged.environmentCommit).files.get('.system-bootstrapper/build-v1/Dockerfile').last_commit_id, staged.buildCommit);
    assert.equal(f.ref(staged.environmentCommit).files.get('.system-bootstrapper/environments-v1/run.sh').last_commit_id, staged.environmentCommit);
    f.merge(); const adoption = await f.upgrade.adoptionPlan(true); await f.upgrade.adopt(adoption.planHash, true);
    const workflow = readConfiguration(f.config).receipt.wizardWorkflow;
    for (const key of ['sourceRevision', 'manifestHash', 'importCommit', 'operation', 'phase']) assert.equal(workflow[key], originalWorkflow[key]);
    assert.deepEqual(workflow.environments.deployments, originalWorkflow.environments.deployments);
    assert.equal(workflow.build.recipeHash, builds.generate(logo, 'node24-vite8-cleanup-v2').recipeHash);
    assert.equal(workflow.upgradeHistory[0].scope, 'build-environment');
    assert.deepEqual((await f.upgrade.adoptionPlan(true)).publicPlan.alreadyAdopted, true);
    assert.equal((await f.upgrade.adopt((await f.upgrade.adoptionPlan(true)).planHash, true)).unchanged, true);
    assert.deepEqual(await f.upgrade.preservedTree(f.receipt, 'main', plan.publicPlan.managedPaths), preserved);
  }, true);
  for (const boundary of ['preparation', 'build', 'environment']) await test('recipe-only lost ' + boundary + ' response reconciles without rewriting source', async f => {
    const plan = await f.upgrade.plan(true); f.lostResponse = boundary;
    await assert.rejects(f.upgrade.stage(plan.planHash, true), /Lost commit response/);
    await f.upgrade.stage(plan.planHash, true);
    assert.equal(f.posts.filter(name => name === boundary).length, 1); assert.equal(f.posts.filter(name => name === 'source').length, 0);
    await f.upgrade.verifyPreserved(f.upgrade.load(plan.publicPlan.operation), f.mrs[0].sha);
  }, true);
  await test('recipe-only stale preview, mutex, source/history and managed-file conflicts fail closed', async f => {
    const plan = await f.upgrade.plan(true), config = fs.readFileSync(f.config, 'utf8');
    fs.appendFileSync(f.config, '# concurrent config\n'); await assert.rejects(f.upgrade.stage(plan.planHash, true), /Preview and confirm/); fs.writeFileSync(f.config, config);
    fs.mkdirSync(f.upgrade.lock); await assert.rejects(f.upgrade.stage(plan.planHash, true), /EEXIST/); fs.rmdirSync(f.upgrade.lock);
    assert.equal(f.posts.length, 0); await f.upgrade.stage(plan.planHash, true); f.merge();
    const files = f.ref('main').files, old = files.get('src/App.tsx');
    files.set('src/App.tsx', f.row('conflicting source', old.last_commit_id)); await assert.rejects(f.upgrade.adoptionPlan(true), /source or import history/);
    files.set('src/App.tsx', {...old, last_commit_id: '9'.repeat(40)}); await assert.rejects(f.upgrade.adoptionPlan(true), /source or import history/); files.set('src/App.tsx', {...old, execute_filemode: true}); await assert.rejects(f.upgrade.adoptionPlan(true), /source or import history/); files.set('src/App.tsx', old);
    files.set('unreviewed.txt', f.row('new source', '9'.repeat(40))); await assert.rejects(f.upgrade.adoptionPlan(true), /source or import history/); files.delete('unreviewed.txt');
    const managed = '.system-bootstrapper/build-v1/cleanup.sh', oldManaged = files.get(managed);
    files.set(managed, f.row('unreviewed cleanup', oldManaged.last_commit_id)); await assert.rejects(f.upgrade.adoptionPlan(true), /content changed/); files.set(managed, oldManaged);
    const adoption = await f.upgrade.adoptionPlan(true); await assert.rejects(f.upgrade.adopt('stale', true), /Preview and confirm/);
    // A fresh internal adoption preview includes the changed bytes, and refuses
    // to apply the earlier reviewed hash instead of overwriting them.
    fs.appendFileSync(f.config, '# changed after review\n'); await assert.rejects(f.upgrade.adopt(adoption.planHash, true), /configuration changed/);
    assert.equal(readConfiguration(f.config).receipt.wizardWorkflow.build.recipeHash, f.receipt.wizardWorkflow.build.recipeHash);
  }, true);
  await test('recipe-only rejects modified import marker and active or pending leases', async f => {
    const files = f.ref('main').files, name = '.system-bootstrapper/wizard-source.json', old = files.get(name);
    files.set(name, f.row('changed import marker', '4'.repeat(40))); await assert.rejects(f.upgrade.plan(true), /content changed/); files.set(name, old);
    for (const state of [{active: {id: 1}}, {pending: {id: 2}}, {retired: [{id: 3}]}]) {
      const before = f.receipt.wizardWorkflow.environments.deployments.review;
      f.receipt.wizardWorkflow.environments.deployments.review = {...before, ...state}; f.writeReceipt();
      await assert.rejects(f.upgrade.plan(true), /leases/); f.receipt.wizardWorkflow.environments.deployments.review = before;
    }
    assert.deepEqual(f.posts, []);
  }, true);
  await test('historical source-upgrade checkpoint adopts its reserved pre-cleanup recipe', async f => {
    const choose = builds.forSource;
    try { builds.forSource = () => builds.generate(logo, 'node24-vite8'); await f.stage(); }
    finally { builds.forSource = choose; }
    f.merge(); await f.adopt();
    assert.equal(readConfiguration(f.config).receipt.wizardWorkflow.build.recipeHash, builds.generate(logo, 'node24-vite8').recipeHash);
  });
  for (const profile of ['node24-vite8-cleanup-v2', 'node24-vite8-overview-v3']) await test('explicit overview recipe upgrade from ' + profile + ' preserves source and stopped generations', async f => {
    const previous = structuredClone(f.receipt.wizardWorkflow);
    const historicalOperation = f.upgrade.operation(f.receipt, logo, true);
    f.upgrade = new Upgrade({...f, helperImage: helper, buildProfile: 'node24-vite8-overview-v3', request: f.request.bind(f), checkHelper: async () => {}});
    const plan = await f.upgrade.plan(true);
    assert.equal(plan.publicPlan.buildRecipeHash, builds.generate(logo, 'node24-vite8-overview-v3').recipeHash);
    assert.notEqual(plan.publicPlan.operation, historicalOperation, 'Distinct recipe targets must not reuse old checkpoints');
    const preserved = await f.upgrade.preservedTree(f.receipt, 'main', plan.publicPlan.managedPaths);
    await f.upgrade.stage(plan.planHash, true); f.merge();
    await f.upgrade.adopt((await f.upgrade.adoptionPlan(true)).planHash, true);
    const workflow = readConfiguration(f.config).receipt.wizardWorkflow;
    assert.equal(workflow.build.recipeHash, plan.publicPlan.buildRecipeHash);
    for (const key of ['sourceRevision', 'manifestHash', 'importCommit']) assert.equal(workflow[key], previous[key]);
    assert.deepEqual(workflow.environments.deployments, previous.environments.deployments);
    assert.deepEqual(await f.upgrade.preservedTree(f.receipt, 'main', plan.publicPlan.managedPaths), preserved);
    assert.equal((await f.upgrade.adopt((await f.upgrade.adoptionPlan(true)).planHash, true)).unchanged, true);
  }, profile);
  await test('overview recipe rejects unknown upgrade target and accidental default downgrade', async f => {
    assert.throws(() => new Upgrade({...f, helperImage: helper, buildProfile: 'unknown'}), /known modern/);
    await assert.rejects(f.upgrade.plan(true), /Retain the overview-compatible/);
    assert.deepEqual(f.posts, []);
  }, 'node24-vite8-overview-v3');
  await test('native operator CLI accepts the explicit overview profile and rejects unknown options or profiles before requests', async f => {
    const responses = {}, request = f.request.bind(f);
    f.upgrade = new Upgrade({...f, helperImage: helper, buildProfile: 'node24-vite8-overview-v3',
      request: async (method, route, ...args) => {
        assert.equal(method, 'GET', 'A preview must remain read-only');
        const result = await request(method, route, ...args); responses[route] = result; return result;
      }});
    const preview = await f.upgrade.plan(true), before = fs.readFileSync(f.config, 'utf8');
    const credential = path.join(f.root, 'credential.json'), options = path.join(f.root, 'options.json');
    const fixture = path.join(f.root, 'responses.json'), preload = path.join(f.root, 'fetch-fixture.js'), trace = path.join(f.root, 'requests.jsonl');
    fs.writeFileSync(credential, JSON.stringify({baseUrl: 'https://gitlab.example.test/api/v4', token: 'synthetic-fixture-token'}), {mode: 0o600});
    fs.writeFileSync(fixture, JSON.stringify(responses));
    fs.writeFileSync(preload, `'use strict';
const fs = require('fs'), responses = JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'));
global.fetch = async (target, options) => {
  const url = new URL(target);
  if (options.method !== 'GET' || url.origin !== 'https://gitlab.example.test' || !url.pathname.startsWith('/api/v4/')) throw Error('Unexpected fixture request');
  const route = url.pathname.slice('/api/v4/'.length) + url.search;
  if (!Object.hasOwn(responses, route)) throw Error('Unknown fixture request');
  fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({method: options.method, route}) + '\\n');
  return {status: 200, text: async () => JSON.stringify(responses[route])};
};\n`);
    const invoke = extra => {
      fs.writeFileSync(trace, '');
      fs.writeFileSync(options, JSON.stringify({credentialFile: credential, helperImage: helper,
        config: f.config, mainConfig: f.mainConfig, directory: f.directory, ...extra}), {mode: 0o600});
      return spawnSync(process.execPath, ['--require', preload, path.resolve(__dirname, '../../project-bootstrap/wizard-upgrade/run.js'), 'build-plan', options],
        {encoding: 'utf8', timeout: 30000});
    };
    const accepted = invoke({buildProfile: 'node24-vite8-overview-v3'});
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.deepEqual(JSON.parse(accepted.stdout), {plan: preview.publicPlan, planHash: preview.planHash});
    assert(fs.readFileSync(trace, 'utf8').trim());
    const historical = invoke({}); assert.equal(historical.status, 0, historical.stderr);
    assert.equal(JSON.parse(historical.stdout).plan.buildRecipeHash, builds.generate(logo, 'node24-vite8-cleanup-v2').recipeHash);
    for (const invalid of [{buildProfile: 'unknown'}, {buildProfile: 'node24-vite8-overview-v3', unknownOption: true}]) {
      const rejected = invoke(invalid); assert.equal(rejected.status, 1); assert.match(rejected.stderr, /Managed Wizard upgrade failed/);
      assert.equal(rejected.stdout, ''); assert.equal(fs.readFileSync(trace, 'utf8'), '', 'Reject invalid operator options before GitLab requests');
    }
    assert.equal(fs.readFileSync(f.config, 'utf8'), before); assert(!fs.existsSync(f.directory));
    assert(!fs.existsSync(f.upgrade.lock)); assert.deepEqual(f.posts, []);
  }, 'node24-vite8-cleanup-v2');
  await test('recipe-only adoption CAS catches edits during final branch read', async f => {
    const plan = await f.upgrade.plan(true); await f.upgrade.stage(plan.planHash, true); f.merge();
    const adoption = await f.upgrade.adoptionPlan(true), request = f.upgrade.request, acquire = f.upgrade.acquire.bind(f.upgrade); let locked = false;
    f.upgrade.acquire = () => { acquire(); locked = true; };
    f.upgrade.request = async (...args) => {
      if (locked && args[1].startsWith('projects/1/repository/branches/main')) fs.appendFileSync(f.config, '# concurrent post-lock edit\n');
      return request(...args);
    };
    await assert.rejects(f.upgrade.adopt(adoption.planHash, true), /changed after adoption preview/);
    assert(fs.readFileSync(f.config, 'utf8').endsWith('# concurrent post-lock edit\n')); assert(!fs.existsSync(f.upgrade.lock));
    assert.equal(readConfiguration(f.config).receipt.wizardWorkflow.build.recipeHash, f.receipt.wizardWorkflow.build.recipeHash);
  }, true);
  await test('recipe-only adoption repairs checkpoint after a committed config loses its checkpoint response', async f => {
    const plan = await f.upgrade.plan(true); await f.upgrade.stage(plan.planHash, true); f.merge();
    const adoption = await f.upgrade.adoptionPlan(true), save = f.upgrade.save.bind(f.upgrade); let lost = false;
    f.upgrade.save = checkpoint => { if (checkpoint.phase === 'adopted' && !lost) { lost = true; throw Error('Checkpoint write interrupted'); } save(checkpoint); };
    await assert.rejects(f.upgrade.adopt(adoption.planHash, true), /Checkpoint write interrupted/);
    const installed = fs.readFileSync(f.config, 'utf8'), retry = await f.upgrade.adoptionPlan(true);
    assert.equal((await f.upgrade.adopt(retry.planHash, true)).unchanged, true); assert.equal(fs.readFileSync(f.config, 'utf8'), installed);
    const checkpoint = f.upgrade.load(plan.publicPlan.operation); assert.equal(checkpoint.phase, 'adopted'); assert.equal(checkpoint.adoptedConfigHash, hash(installed));
  }, true);
})().catch(error => { console.error(error); process.exitCode = 1; });
