'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
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
  constructor() {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-upgrade-'));
    this.config = path.join(this.root, '.wizard.env'); this.mainConfig = path.join(this.root, '.docker.env'); this.directory = path.join(this.root, 'checkpoints');
    this.commits = new Map(); this.branches = new Map(); this.posts = []; this.mrs = []; this.serial = 10;
    const oldSource = snapshot('c'.repeat(40), [sourceFile('package.json', '{"dependencies":{"react-scripts":"4"}}'),
      sourceFile('src/api/Helper.tsx', logo), sourceFile('.gitlab-ci.yml', '# Upstream roles preserved\n'), sourceFile('obsolete-cra.js', 'old\n')]);
    this.snapshot = snapshot(currentSource, [sourceFile('package.json', '{"devDependencies":{"vite":"8.3.4"}}'),
      sourceFile('src/api/Helper.tsx', logo), sourceFile('.gitlab-ci.yml', '# Upstream roles preserved\n'), sourceFile('scripts/check.sh', '#!/bin/sh\ntrue\n', '100755')]);
    const settings = {review: {enabled: true, domainMode: 2, host: 'review.example.test', ssl: '/ssl/cert.pem', sslKey: '/ssl/key.pem'}, beta: {enabled: true, domainMode: 2, host: 'beta.example.test', ssl: '/ssl/cert.pem', sslKey: '/ssl/key.pem'}};
    const build = builds.generate(logo), environment = {version: 1, operation: 'd'.repeat(48), phase: 'ready', settings,
      settingsHash: hash(JSON.stringify(settings)), helperImage: oldHelper, controller: 'system_bootstrapper_1',
      deployments: {review: {active: null, pending: null, lastPipelineId: 6, stoppedThroughPipelineId: 6,
        tombstone: {projectId: 1, pipelineId: 6, sourceCommit: 'e'.repeat(40), operation: 'd'.repeat(48)}, retired: []}, beta: {active: null, pending: null, stoppedThroughPipelineId: 7}}};
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
async function test(name, run) { const f = new Fixture(); try { await run(f); console.log('In-place Wizard upgrade: ' + name + ' passed.'); } finally { f.destroy(); } }
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
})().catch(error => { console.error(error); process.exitCode = 1; });
