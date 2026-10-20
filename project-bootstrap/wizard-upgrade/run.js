'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {validate, safePath} = require('../wizard-source/package');
const builds = require('../wizard-build/recipe');
const environments = require('../wizard-environments/recipe');
const {atomic, hash, signature} = require('../wizard-production/run');
const SOURCE = '.system-bootstrapper/wizard-source.json';
const BUILD = '.system-bootstrapper/wizard-build.json';
const ENVIRONMENT = '.system-bootstrapper/wizard-environments.json';
const CI = '.system-bootstrapper/ci.yml';
const PREFIX = '# BOOTSTRAPPER_PROJECT=';
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const copy = value => JSON.parse(JSON.stringify(value));
function publicSetting(text, key) {
  const found = text.split('\n').map(line => /^(?:export )?([A-Z_]+)=(?:'([^']*)'|"([^"$`\\]*)"|([A-Za-z0-9_./:@+-]+))\s*$/.exec(line))
    .filter(match => match?.[1] === key).pop();
  return found && (found[2] ?? found[3] ?? found[4]);
}
function readConfiguration(file) {
  const text = fs.readFileSync(file, 'utf8'); signature(text);
  const markers = text.split('\n').filter(line => line.startsWith(PREFIX));
  if (markers.length !== 1) throw Error('Expected one canonical project receipt.');
  const receipt = JSON.parse(Buffer.from(markers[0].slice(PREFIX.length), 'base64').toString());
  if (receipt.repository?.managementMode === 'source-primary')
    throw Error('Source-primary Wizard changes use native repository merge requests; legacy import/upgrade is disabled.');
  if (!receipt.defaultProject || receipt.template !== 'wizard' || receipt.state !== 'complete' ||
      !receipt.repository?.systemProject || receipt.repository.ciPath !== CI || !sha(receipt.wizardWorkflow?.importCommit))
    throw Error('Canonical managed Wizard ownership changed.');
  const environment = receipt.wizardWorkflow.environments;
  if (!environment || environment.phase !== 'ready' || environment.controller !== 'system_bootstrapper_1' ||
      Object.values(environment.deployments || {}).some(slot => slot.active || slot.pending || slot.retired?.length))
    throw Error('Stop active environments and reconcile pending or retired leases before upgrading.');
  return {text, receipt};
}
function sourceMarker(receipt, snapshot) {
  return JSON.stringify({version: 1, operation: receipt.operation, sourceRevision: snapshot.sourceRevision, manifestHash: snapshot.manifestHash});
}
function buildMarker(build, workflow) {
  return JSON.stringify({version: 1, operation: build.operation, recipeHash: build.recipeHash,
    sourceRevision: workflow.sourceRevision, importCommit: workflow.importCommit});
}
function environmentMarker(environment, parent) {
  return JSON.stringify({version: 1, operation: environment.operation, recipeHash: environment.recipeHash,
    settingsHash: environment.settingsHash, helperImage: environment.helperImage,
    controller: environment.controller, parentCommit: parent});
}
class Upgrade {
  constructor(options = {}) {
    this.config = options.config || '/state/.projects.env/.wizard.env';
    this.directory = options.directory || '/state/wizard-upgrades';
    this.mainConfig = options.mainConfig || path.join(path.dirname(path.dirname(this.config)), '.docker.env');
    this.lock = this.config + '.environments.lock';
    this.helperImage = options.helperImage;
    if (!/^sha256:[a-f0-9]{64}$/.test(this.helperImage || '')) throw Error('Configure the reviewed immutable clean helper image.');
    // An explicit target keeps existing build-only checkpoint identities stable.
    this.buildProfile = options.buildProfile === undefined ? 'node24-vite8-cleanup-v2' : options.buildProfile;
    if (!['node24-vite8-cleanup-v2', 'node24-vite8-overview-v3'].includes(this.buildProfile))
      throw Error('Configure a known modern Wizard build upgrade profile.');
    this.snapshot = validate(options.snapshot || JSON.parse(fs.readFileSync(path.join(__dirname, '../wizard-source/snapshot.json'), 'utf8')));
    this.request = options.request || this.api(options.credentialFile);
    this.checkHelper = options.checkHelper || this.verifyHelper.bind(this);
    this.token = crypto.randomBytes(24).toString('hex');
  }
  api(file) {
    const info = fs.statSync(file);
    if (!info.isFile() || (info.mode & 0o077)) throw Error('API credential file must be private.');
    const credential = JSON.parse(fs.readFileSync(file, 'utf8'));
    const base = new URL(credential.baseUrl.replace(/\/$/, '').replace(/\/api\/v4$/, '') + '/api/v4/');
    const main = fs.readFileSync(this.mainConfig, 'utf8'); signature(main);
    if (base.protocol !== 'https:' || base.pathname !== '/api/v4/' || base.username || base.password || base.search || base.hash ||
        base.host !== publicSetting(main, 'GITLAB_HOST') ||
        typeof credential.token !== 'string' || !credential.token) throw Error('Use a private TLS-verified GitLab credential file.');
    return async (method, route, body, expected = 200) => {
      const target = new URL(route, base);
      if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) throw Error('Invalid GitLab route.');
      try {
        const response = await fetch(target, {method, redirect: 'error', signal: AbortSignal.timeout(120000),
          headers: {'PRIVATE-TOKEN': credential.token, 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
        if (response.status !== expected) throw Error('status');
        const text = await response.text(); if (text.length > 16000000) throw Error('size');
        return JSON.parse(text);
      } catch (_) { throw Error('GitLab upgrade request failed; inspect the same checkpoint before retrying.'); }
    };
  }
  async get(route) { return this.request('GET', route); }
  prefix(receipt) { return 'projects/' + receipt.repository.id + '/'; }
  async file(receipt, name, ref) {
    if (!safePath(name) || !(sha(ref) || /^[A-Za-z0-9_./-]+$/.test(ref))) throw Error('Invalid repository file identity.');
    return this.get(this.prefix(receipt) + 'repository/files/' + encodeURIComponent(name) + '?ref=' + encodeURIComponent(ref));
  }
  content(row) { return Buffer.from(row.content.replace(/\n/g, ''), 'base64'); }
  async branch(receipt, branch = receipt.repository.defaultBranch) {
    return (await this.get(this.prefix(receipt) + 'repository/branches/' + encodeURIComponent(branch))).commit.id;
  }
  async matching(receipt, name, content, ref, commit) {
    const row = await this.file(receipt, name, ref);
    if (!this.content(row).equals(Buffer.isBuffer(content) ? content : Buffer.from(content)) ||
        (commit && row.last_commit_id !== commit)) throw Error('Managed Wizard content changed: ' + name);
    return row;
  }
  async project(receipt) {
    const row = await this.get('projects/' + receipt.repository.id);
    if (row.visibility !== 'private' || row.id !== receipt.repository.id || row.path_with_namespace !== receipt.repository.path ||
        row.default_branch !== receipt.repository.defaultBranch || row.ci_config_path !== CI ||
        row.description !== 'System Bootstrapper operation ' + receipt.operation) throw Error('Canonical GitLab project identity changed.');
    return row;
  }
  recipe(logo, environment) { return environments.generate(logo, environment); }
  verifyHelper() {
    // Hash the entire helper dependency tree, not just its entrypoint. The
    // container has no network, credentials, volume, socket or writable root.
    const directory = path.resolve(__dirname, '..'), files = [];
    const walk = relative => {
      for (const entry of fs.readdirSync(path.join(directory, relative), {withFileTypes: true})) {
        const name = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) walk(name);
        else if (entry.isFile()) files.push({path: '/system/project-bootstrap/' + name, sha256: hash(fs.readFileSync(path.join(directory, name)))});
        else throw Error('Helper dependency links are unsupported.');
      }
    };
    walk('wizard-environments'); walk('wizard-build');
    const script = 'const fs=require("fs"),c=require("crypto");const expected=' + JSON.stringify(files) +
      ';if(expected.some(f=>c.createHash("sha256").update(fs.readFileSync(f.path)).digest("hex")!==f.sha256))process.exit(2);process.stdout.write("verified");';
    try {
      const output = execFileSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--memory', '128m', '--cpus', '0.5', '--pids-limit', '64',
        '--entrypoint', 'node', this.helperImage, '-e', script], {encoding: 'utf8', timeout: 60000, maxBuffer: 2000000, stdio: ['ignore', 'pipe', 'pipe']});
      if (output !== 'verified') throw Error('proof');
    } catch (_) { throw Error('The clean helper image does not contain the reviewed modern helper dependency tree.'); }
  }
  async tree(receipt, ref) {
    const rows = [];
    for (let page = 1; page <= 20; page++) {
      const found = await this.get(this.prefix(receipt) + 'repository/tree?recursive=true&per_page=100&page=' + page + '&ref=' + ref);
      rows.push(...found); if (found.length < 100) return rows;
    }
    throw Error('Wizard repository tree exceeds its inspection bound.');
  }
  async originalSource(receipt) {
    const workflow = receipt.wizardWorkflow, files = [];
    for (const entry of await this.tree(receipt, workflow.importCommit)) {
      if (entry.type !== 'blob' || entry.path === CI || entry.path === SOURCE) continue;
      const row = await this.file(receipt, entry.path, workflow.importCommit);
      if (row.last_commit_id !== workflow.importCommit) continue;
      const content = this.content(row);
      files.push({path: entry.path, mode: row.execute_filemode ? '100755' : '100644', sha256: hash(content), content: content.toString('base64')});
    }
    files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    return validate({version: 1, sourceRevision: workflow.sourceRevision, manifestHash: workflow.manifestHash, files});
  }
  operation(receipt, logo, buildOnly = false) {
    return hash(JSON.stringify(buildOnly ? {version: 1, scope: 'build-environment', registration: receipt.operation,
      importCommit: receipt.wizardWorkflow.importCommit, helper: this.helperImage,
      buildRecipeHash: builds.generate(logo, this.buildProfile).recipeHash} :
      {version: 1, registration: receipt.operation, source: this.snapshot.manifestHash, helper: this.helperImage})).slice(0, 48);
  }
  async preservedTree(receipt, ref, managedPaths) {
    const managed = new Set(managedPaths), files = [];
    for (const entry of await this.tree(receipt, ref)) {
      if (entry.type === 'tree' || managed.has(entry.path)) continue;
      if (!safePath(entry.path)) throw Error('Invalid preserved Wizard path.');
      if (entry.type === 'commit' && entry.mode === '160000' && sha(entry.id)) {
        files.push({path: entry.path, mode: entry.mode, commit: entry.id}); continue;
      }
      if (entry.type !== 'blob' || !['100644', '100755', '120000'].includes(entry.mode)) throw Error('Unsupported preserved Wizard tree entry.');
      const row = await this.file(receipt, entry.path, ref);
      if (!sha(row.last_commit_id)) throw Error('Invalid preserved Wizard file history.');
      files.push({path: entry.path, mode: entry.mode, sha256: hash(this.content(row)), lastCommit: row.last_commit_id});
    }
    return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  }
  async verifyPreserved(checkpoint, ref) {
    const actual = await this.preservedTree(checkpoint.receipt, ref, checkpoint.plan.managedPaths);
    if (hash(JSON.stringify(actual)) !== checkpoint.plan.preservedTreeHash)
      throw Error('Preserved Wizard source or import history changed.');
  }
  async plan(buildOnly = false) {
    const current = readConfiguration(this.config), {receipt, text} = current, workflow = receipt.wizardWorkflow;
    const main = fs.readFileSync(this.mainConfig, 'utf8'); signature(main);
    const project = await this.project(receipt); const head = await this.branch(receipt);
    if (!sha(head)) throw Error('Invalid canonical branch head.');
    const original = await this.originalSource(receipt), logo = text.slice(0, 1184);
    await this.matching(receipt, SOURCE, sourceMarker(receipt, original), head, workflow.importCommit);
    const oldBuild = builds.select(logo, workflow.build.recipeHash), oldEnvironment = this.recipe(logo, workflow.environments);
    if (oldEnvironment.recipeHash !== workflow.environments.recipeHash) throw Error('Old environment recipe changed.');
    await this.matching(receipt, BUILD, buildMarker(workflow.build, workflow), head, workflow.build.activationCommit);
    for (const file of oldBuild.files) await this.matching(receipt, file.path, file.content, head, workflow.build.activationCommit);
    const envRow = await this.file(receipt, ENVIRONMENT, head), envMarker = JSON.parse(this.content(envRow).toString());
    if (!sha(envMarker.parentCommit)) throw Error('Old environment ancestry changed.');
    await this.matching(receipt, ENVIRONMENT, environmentMarker(workflow.environments, envMarker.parentCommit), head, workflow.environments.activationCommit);
    const oldActivation = await this.get(this.prefix(receipt) + 'repository/commits/' + workflow.environments.activationCommit);
    if (JSON.stringify(oldActivation.parent_ids) !== JSON.stringify([envMarker.parentCommit])) throw Error('Old environment commit ancestry changed.');
    for (const file of [...oldEnvironment.files, {path: CI, content: oldEnvironment.ci}])
      await this.matching(receipt, file.path, file.content, head, workflow.environments.activationCommit);
    const oldFiles = new Map(original.files.map(file => [file.path, file]));
    const currentTree = new Set((await this.tree(receipt, head)).filter(row => row.type === 'blob').map(row => row.path));
    for (const file of buildOnly ? [] : original.files) {
      const row = await this.matching(receipt, file.path, Buffer.from(file.content, 'base64'), head);
      if (!!row.execute_filemode !== (file.mode === '100755')) throw Error('Managed source mode changed: ' + file.path);
    }
    for (const file of buildOnly ? [] : this.snapshot.files) if (!oldFiles.has(file.path) && currentTree.has(file.path)) throw Error('New source path is occupied: ' + file.path);
    const modern = buildOnly ? builds.generate(logo, this.buildProfile) : builds.forSource(logo, this.snapshot.sourceRevision);
    if (!['node24-vite8', 'node24-vite8-cleanup-v2', 'node24-vite8-overview-v3'].includes(modern.profile) ||
        (buildOnly && !['node24-vite8', 'node24-vite8-cleanup-v2', 'node24-vite8-overview-v3'].includes(oldBuild.profile)))
      throw Error('The reviewed upgrade requires the modern Wizard profile.');
    if (buildOnly && oldBuild.profile === 'node24-vite8-overview-v3' && modern.profile !== oldBuild.profile)
      throw Error('Retain the overview-compatible Wizard build profile.');
    const operation = this.operation(receipt, logo, buildOnly);
    const environment = {...copy(workflow.environments), helperImage: this.helperImage, buildRecipeHash: modern.recipeHash};
    const recipe = this.recipe(logo, environment); environment.recipeHash = recipe.recipeHash;
    const newPaths = new Set(this.snapshot.files.map(file => file.path));
    const publicPlan = {version: 1, operation, projectId: receipt.repository.id, projectPath: receipt.repository.path,
      defaultBranch: receipt.repository.defaultBranch, expectedHead: head, configHash: hash(text),
      mainConfigHash: hash(main), requiresFastForward: true,
      mergeMethod: project.merge_method,
      sourceRevision: buildOnly ? workflow.sourceRevision : this.snapshot.sourceRevision, manifestHash: buildOnly ? workflow.manifestHash : this.snapshot.manifestHash,
      buildRecipeHash: modern.recipeHash, environmentRecipeHash: recipe.recipeHash, helperImage: this.helperImage,
      branch: 'system-wizard-upgrade-v1-' + operation.slice(0, 16),
      updates: buildOnly ? [...modern.files, ...recipe.files, {path: BUILD}, {path: ENVIRONMENT}, {path: CI}].map(file => file.path) : this.snapshot.files.map(file => file.path),
      deletes: buildOnly ? [] : original.files.filter(file => !newPaths.has(file.path)).map(file => file.path)};
    if (buildOnly) {
      publicPlan.scope = 'build-environment';
      publicPlan.managedPaths = [...new Set([...oldBuild.files, ...oldEnvironment.files, ...modern.files, ...recipe.files,
        {path: BUILD}, {path: ENVIRONMENT}, {path: CI}].map(file => file.path))].sort();
      if (publicPlan.managedPaths.includes(SOURCE) || original.files.some(file => publicPlan.managedPaths.includes(file.path)))
        throw Error('Managed upgrade paths overlap imported source.');
      publicPlan.preservedTreeHash = hash(JSON.stringify(await this.preservedTree(receipt, head, publicPlan.managedPaths)));
    }
    return {...current, original, modern, environment, recipe, publicPlan, planHash: hash(JSON.stringify(publicPlan))};
  }
  checkpointPath(operation) { return path.join(this.directory, operation + '.json'); }
  save(checkpoint) { atomic(this.checkpointPath(checkpoint.plan.operation), JSON.stringify(checkpoint)); }
  load(operation) { return JSON.parse(fs.readFileSync(this.checkpointPath(operation), 'utf8')); }
  acquire() {
    fs.mkdirSync(this.lock, {mode: 0o700});
    try { fs.writeFileSync(path.join(this.lock, 'owner'), JSON.stringify({token: this.token, helper: 'wizard-upgrade'}), {mode: 0o600, flag: 'wx'}); }
    catch (error) { fs.rmdirSync(this.lock); throw error; }
  }
  release() {
    if (JSON.parse(fs.readFileSync(path.join(this.lock, 'owner'), 'utf8')).token !== this.token) throw Error('Upgrade lock ownership changed.');
    fs.unlinkSync(path.join(this.lock, 'owner')); fs.rmdirSync(this.lock);
  }
  async exactCommit(checkpoint, name, parent, actions, marker) {
    const receipt = checkpoint.receipt, ref = checkpoint.plan.branch;
    const verify = async commit => {
      if (!sha(commit)) throw Error('Invalid migration commit.');
      const installed = await this.get(this.prefix(receipt) + 'repository/commits/' + commit);
      if (JSON.stringify(installed.parent_ids) !== JSON.stringify([parent])) throw Error('Migration branch ancestry changed.');
      for (const action of actions.filter(row => !['delete', 'chmod'].includes(row.action))) {
        const content = action.encoding === 'base64' ? Buffer.from(action.content, 'base64') : action.content;
        await this.matching(receipt, action.file_path, content, commit, commit);
      }
      const tree = new Map((await this.tree(receipt, commit)).filter(row => row.type === 'blob').map(row => [row.path, row]));
      for (const action of actions) {
        if (action.action === 'delete' && tree.has(action.file_path)) throw Error('Obsolete source file remains.');
        if (action.action === 'chmod' && (tree.get(action.file_path)?.mode === '100755') !== action.execute_filemode) throw Error('Migration source mode changed.');
      }
      return commit;
    };
    if (checkpoint.commits[name]) return verify(checkpoint.commits[name]);
    const head = await this.branch(receipt, ref);
    if (checkpoint.intents[name]) {
      if (head === parent) throw Error('Uncertain commit has no observable result; administrator reconciliation is required.');
      await this.matching(receipt, marker.path, marker.content, head, head);
      const commit = await verify(head); checkpoint.commits[name] = commit; this.save(checkpoint); return commit;
    }
    if (head !== parent) throw Error('Migration branch changed before commit.');
    checkpoint.intents[name] = {parent, actionsHash: hash(JSON.stringify(actions))}; this.save(checkpoint);
    const result = await this.request('POST', this.prefix(receipt) + 'repository/commits', {branch: ref,
      commit_message: 'Upgrade managed Wizard v1: ' + name + (name === 'environment' ? '' : ' [skip ci]'), actions}, 201);
    const commit = await verify(result.id); checkpoint.commits[name] = commit; this.save(checkpoint); return commit;
  }
  async ensureBranch(checkpoint) {
    const receipt = checkpoint.receipt, prefix = this.prefix(receipt), branch = checkpoint.plan.branch;
    const rows = await this.get(prefix + 'repository/branches?search=' + encodeURIComponent('^' + branch + '$') + '&per_page=100');
    const matches = rows.filter(row => row.name === branch);
    if (matches.length > 1) throw Error('Ambiguous migration branch.');
    if (matches.length) {
      if (!checkpoint.branchIntent) throw Error('Migration branch is already occupied.');
      return;
    }
    if (checkpoint.branchIntent) throw Error('Uncertain branch creation requires administrator reconciliation.');
    checkpoint.branchIntent = true; this.save(checkpoint);
    await this.request('POST', prefix + 'repository/branches', {branch, ref: checkpoint.plan.expectedHead}, 201);
  }
  async ensureMr(checkpoint) {
    const receipt = checkpoint.receipt;
    const rows = await this.get(this.prefix(receipt) + 'merge_requests?scope=all&source_branch=' + encodeURIComponent(checkpoint.plan.branch) + '&per_page=100');
    const matches = rows.filter(row => row.source_project_id === receipt.repository.id && row.target_project_id === receipt.repository.id &&
      row.source_branch === checkpoint.plan.branch && row.target_branch === receipt.repository.defaultBranch);
    if (matches.length > 1 || (matches.length && !checkpoint.mrIntent)) throw Error('Migration MR is occupied or ambiguous.');
    if (matches.length) {
      if (matches[0].state !== 'opened') throw Error('Migration MR is no longer open.');
      checkpoint.mr = {iid: matches[0].iid, webUrl: matches[0].web_url}; this.save(checkpoint); return;
    }
    if (checkpoint.mrIntent) throw Error('Uncertain MR creation requires administrator reconciliation.');
    checkpoint.mrIntent = true; this.save(checkpoint);
    const mr = await this.request('POST', this.prefix(receipt) + 'merge_requests', {source_branch: checkpoint.plan.branch,
      target_branch: receipt.repository.defaultBranch, title: checkpoint.plan.scope === 'build-environment' ? 'Upgrade managed Wizard build and environment recipes' : 'Upgrade managed Wizard source and toolchain in place',
      description: 'Versioned migration ' + checkpoint.plan.operation + (checkpoint.plan.scope === 'build-environment' ? '. Preserve current source and import history; review only managed recipes and required build/browser checks.' : '. Review the pinned public source, required modern build/browser checks and preserved receipt.') + ' Merge without squash/rebase; adoption and Production rollout are separate operator steps.',
      remove_source_branch: false, squash: false}, 201);
    checkpoint.mr = {iid: mr.iid, webUrl: mr.web_url}; this.save(checkpoint);
  }
  async stage(confirmedHash, buildOnly = false) {
    const value = await this.plan(buildOnly);
    if (confirmedHash !== value.planHash) throw Error('Preview and confirm the exact migration plan hash.');
    this.acquire();
    try {
      if (fs.readFileSync(this.config, 'utf8') !== value.text || hash(fs.readFileSync(this.mainConfig)) !== value.publicPlan.mainConfigHash ||
          (await this.project(value.receipt)).merge_method !== value.publicPlan.mergeMethod ||
          await this.branch(value.receipt) !== value.publicPlan.expectedHead)
        throw Error('Canonical configuration or main changed after preview.');
      await this.checkHelper();
      fs.mkdirSync(this.directory, {recursive: true, mode: 0o700});
      let checkpoint;
      try { checkpoint = this.load(value.publicPlan.operation); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        checkpoint = {version: 1, phase: 'staging', plan: value.publicPlan, planHash: value.planHash,
          originalConfiguration: value.text, receipt: value.receipt, commits: {}, intents: {}}; this.save(checkpoint);
      }
      if (checkpoint.planHash !== value.planHash) throw Error('Existing upgrade checkpoint has a different reviewed plan.');
      await this.ensureBranch(checkpoint);
      const preparationPaths = [...(buildOnly ? [] : value.original.files.map(file => file.path)),
        ...builds.select(value.text.slice(0, 1184), value.receipt.wizardWorkflow.build.recipeHash).files.map(file => file.path),
        ...this.recipe(value.text.slice(0, 1184), value.receipt.wizardWorkflow.environments).files.map(file => file.path), ...(buildOnly ? [] : [BUILD]), ENVIRONMENT];
      const preparationMarker = JSON.stringify({version: 1, operation: value.publicPlan.operation, phase: 'preparation'});
      const preparationActions = [...preparationPaths.map(file_path => ({action: 'delete', file_path})),
        {action: 'update', file_path: buildOnly ? BUILD : SOURCE, content: preparationMarker}];
      const prepared = await this.exactCommit(checkpoint, 'preparation', value.publicPlan.expectedHead, preparationActions,
        {path: buildOnly ? BUILD : SOURCE, content: preparationMarker});
      if (buildOnly) await this.verifyPreserved(checkpoint, prepared);
      const actions = [];
      for (const file of buildOnly ? [] : this.snapshot.files) {
        actions.push({action: 'create', file_path: file.path, encoding: 'base64', content: file.content});
        if (file.mode === '100755') actions.push({action: 'chmod', file_path: file.path, execute_filemode: true});
      }
      const source = sourceMarker(value.receipt, this.snapshot);
      actions.push({action: 'update', file_path: SOURCE, content: source});
      const imported = buildOnly ? value.receipt.wizardWorkflow.importCommit :
        await this.exactCommit(checkpoint, 'source', prepared, actions, {path: SOURCE, content: source});
      const workflow = buildOnly ? value.receipt.wizardWorkflow :
        {...value.receipt.wizardWorkflow, sourceRevision: this.snapshot.sourceRevision, manifestHash: this.snapshot.manifestHash, importCommit: imported};
      const build = {version: 1, operation: value.publicPlan.operation, recipeHash: value.modern.recipeHash};
      const marker = buildMarker(build, workflow);
      const buildActions = [...value.modern.files, {path: CI, content: value.modern.ci}, {path: BUILD, content: marker}]
        .map(file => ({action: file.path === CI || (buildOnly && file.path === BUILD) ? 'update' : 'create', file_path: file.path, content: file.content}));
      const built = await this.exactCommit(checkpoint, 'build', buildOnly ? prepared : imported, buildActions, {path: BUILD, content: marker});
      if (buildOnly) await this.verifyPreserved(checkpoint, built);
      await this.ensureMr(checkpoint);
      const envMarker = environmentMarker(value.environment, built);
      const envActions = [...value.recipe.files, {path: CI, content: value.recipe.ci}, {path: ENVIRONMENT, content: envMarker}]
        .map(file => ({action: file.path === CI ? 'update' : 'create', file_path: file.path, content: file.content}));
      const installed = await this.exactCommit(checkpoint, 'environment', built, envActions, {path: ENVIRONMENT, content: envMarker});
      if (buildOnly) await this.verifyPreserved(checkpoint, installed);
      if (await this.branch(value.receipt, value.publicPlan.branch) !== installed) throw Error('Migration branch advanced after its verified environment commit.');
      checkpoint.phase = 'awaiting-reviewed-merge'; this.save(checkpoint);
      return {version: 1, projectId: value.receipt.repository.id, branch: value.publicPlan.branch, mr: checkpoint.mr,
        sourceCommit: imported, buildCommit: built, environmentCommit: installed, phase: checkpoint.phase};
    } finally { this.release(); }
  }
  async adoptionPlan(buildOnly = false) {
    const current = readConfiguration(this.config), {receipt, text} = current;
    const main = fs.readFileSync(this.mainConfig, 'utf8'); signature(main);
    const operation = this.operation(receipt, text.slice(0, 1184), buildOnly);
    const checkpoint = this.load(operation);
    if ((checkpoint.plan.scope === 'build-environment') !== buildOnly) throw Error('Migration scope changed.');
    if (!checkpoint.commits.environment) throw Error('Migration has not completed staging.');
    if ((await this.project(receipt)).merge_method !== 'ff') throw Error('Configure the reviewed fast-forward merge method before adoption.');
    const previous = checkpoint.receipt, workflow = previous.wizardWorkflow, logo = text.slice(0, 1184);
    const modern = builds.select(logo, checkpoint.plan.buildRecipeHash);
    const environment = {...copy(workflow.environments), helperImage: this.helperImage, buildRecipeHash: modern.recipeHash};
    const recipe = this.recipe(logo, environment); environment.recipeHash = recipe.recipeHash;
    const importedWorkflow = buildOnly ? workflow : {...workflow, sourceRevision: this.snapshot.sourceRevision, manifestHash: this.snapshot.manifestHash, importCommit: checkpoint.commits.source};
    const build = {version: 1, operation, recipeHash: modern.recipeHash, activationCommit: checkpoint.commits.build};
    const head = await this.branch(receipt), prefix = this.prefix(receipt);
    const mr = await this.get(prefix + 'merge_requests/' + checkpoint.mr.iid);
    if (head !== checkpoint.commits.environment || mr.state !== 'merged' || mr.source_project_id !== receipt.repository.id || mr.target_project_id !== receipt.repository.id ||
        mr.target_branch !== receipt.repository.defaultBranch || mr.sha !== checkpoint.commits.environment || mr.squash_commit_sha)
      throw Error('Fast-forward the reviewed migration without squash/rebase before adopting.');
    for (const name of buildOnly ? ['preparation', 'build', 'environment'] : ['preparation', 'source', 'build', 'environment']) {
      const commit = await this.get(prefix + 'repository/commits/' + checkpoint.commits[name]);
      const expected = name === 'preparation' ? checkpoint.plan.expectedHead : checkpoint.commits[{source: 'preparation', build: buildOnly ? 'preparation' : 'source', environment: 'build'}[name]];
      if (JSON.stringify(commit.parent_ids) !== JSON.stringify([expected])) throw Error('Preserve migration commit ancestry.');
    }
    for (const file of buildOnly ? [] : this.snapshot.files) {
      const row = await this.matching(receipt, file.path, Buffer.from(file.content, 'base64'), head, checkpoint.commits.source);
      if (!!row.execute_filemode !== (file.mode === '100755')) throw Error('Migrated source mode changed.');
    }
    const remaining = new Set((await this.tree(receipt, head)).map(row => row.path));
    if (checkpoint.plan.deletes.some(name => remaining.has(name))) throw Error('Obsolete source remains after merge.');
    if (buildOnly) await this.verifyPreserved(checkpoint, head);
    else await this.matching(receipt, SOURCE, sourceMarker(receipt, this.snapshot), head, checkpoint.commits.source);
    for (const file of [...modern.files, {path: BUILD, content: buildMarker(build, importedWorkflow)}])
      await this.matching(receipt, file.path, file.content, head, checkpoint.commits.build);
    for (const file of [...recipe.files, {path: CI, content: recipe.ci}, {path: ENVIRONMENT, content: environmentMarker(environment, checkpoint.commits.build)}])
      await this.matching(receipt, file.path, file.content, head, checkpoint.commits.environment);
    const pipelines = await this.get(prefix + 'merge_requests/' + checkpoint.mr.iid + '/pipelines?per_page=100');
    const matches = pipelines.filter(row => row.sha === checkpoint.commits.environment && row.source === 'merge_request_event').sort((a, b) => b.id - a.id);
    if (!matches.length) throw Error('The exact migration MR pipeline is missing.');
    const pipeline = await this.get(prefix + 'pipelines/' + matches[0].id);
    if (pipeline.id !== matches[0].id || pipeline.status !== 'success' || pipeline.sha !== checkpoint.commits.environment || pipeline.source !== 'merge_request_event')
      throw Error('The exact modern migration pipeline must succeed.');
    const jobs = await this.get(prefix + 'pipelines/' + pipeline.id + '/jobs?per_page=100&include_retried=false');
    const artifacts = [];
    for (const [name, filename] of [['build:wizard', 'build-evidence.json'], ['test:wizard', 'wizard-evidence.json']]) {
      const job = jobs.filter(row => row.name === name).sort((a, b) => b.id - a.id)[0];
      if (!job || job.status !== 'success' || job.allow_failure !== false || job.commit?.id !== pipeline.sha) throw Error('Modern checks must be required and successful.');
      const artifact = await this.get(prefix + 'jobs/' + job.id + '/artifacts/' + filename);
      if (artifact.version !== 1 || artifact.sourceCommit !== pipeline.sha || artifact.pipelineId !== pipeline.id) throw Error('Migration artifact identity changed.');
      artifacts.push(artifact);
    }
    const [built, smoke] = artifacts;
    const registry = new URL(publicSetting(main, 'GITLAB_REGISTRY_URL'));
    if (!['http:', 'https:'].includes(registry.protocol) || registry.username || registry.password || registry.pathname !== '/' || registry.search || registry.hash)
      throw Error('Invalid own registry configuration.');
    if (Number(publicSetting(main, 'GITLAB_REGISTRY_DOMAIN_MODE') || 0) < 2) registry.port = '5050';
    const registryPrefix = registry.host + '/' + receipt.repository.path + '@sha256:';
    if (built.unitTests !== true || built.testRunner !== 'vitest' || built.lint !== true || built.typecheck !== true || built.productionBuild !== true ||
        !['http', 'renderedUI', 'projects', 'spa', 'configurationBackup', 'cubeSignature'].every(key => smoke[key] === true) ||
        smoke.imageRef !== built.imageRef || typeof built.imageRef !== 'string' || !built.imageRef.startsWith(registryPrefix) ||
        !/^[a-f0-9]{64}$/.test(built.imageRef.slice(registryPrefix.length)))
      throw Error('Modern migration evidence is incomplete or disagrees.');
    const adopted = workflow.upgradeHistory?.some(row => row.operation === operation) || receipt.wizardWorkflow.upgradeHistory?.some(row => row.operation === operation);
    if ((!adopted && text !== checkpoint.originalConfiguration) || hash(main) !== checkpoint.plan.mainConfigHash) throw Error('Canonical configuration changed before adoption.');
    if (adopted && (receipt.wizardWorkflow.sourceRevision !== checkpoint.plan.sourceRevision || receipt.wizardWorkflow.environments.recipeHash !== recipe.recipeHash))
      throw Error('Adopted migration receipt changed.');
    const publicPlan = {version: 1, action: 'adopt', operation, projectId: receipt.repository.id, configHash: hash(text),
      mainConfigHash: hash(main),
      mainHead: head, sourceRevision: checkpoint.plan.sourceRevision, pipelineId: pipeline.id,
      sourceCommit: pipeline.sha, imageRef: built.imageRef, alreadyAdopted: !!adopted, ...(buildOnly ? {scope: 'build-environment'} : {})};
    return {publicPlan, planHash: hash(JSON.stringify(publicPlan)), checkpoint, current,
      workflow: importedWorkflow, build: {...build, phase: 'candidate-verified', pipeline: {id: pipeline.id, sha: pipeline.sha, status: pipeline.status, webUrl: pipeline.web_url},
        artifact: {imageRef: built.imageRef, sourceCommit: pipeline.sha, pipelineId: pipeline.id}},
      environment: {...environment, activationCommit: checkpoint.commits.environment, phase: 'ready'}};
  }
  async adopt(confirmedHash, buildOnly = false) {
    const value = await this.adoptionPlan(buildOnly);
    if (value.planHash !== confirmedHash) throw Error('Preview and confirm the exact adoption plan hash.');
    this.acquire();
    try {
      const head = await this.branch(value.current.receipt);
      if (fs.readFileSync(this.config, 'utf8') !== value.current.text || hash(fs.readFileSync(this.mainConfig)) !== value.publicPlan.mainConfigHash ||
          head !== value.publicPlan.mainHead)
        throw Error('Canonical configuration or main changed after adoption preview.');
      if (value.publicPlan.alreadyAdopted) {
        value.checkpoint.phase = 'adopted'; value.checkpoint.adoptedConfigHash = hash(value.current.text); this.save(value.checkpoint);
        return {phase: 'adopted', unchanged: true};
      }
      const receipt = copy(value.current.receipt), previous = copy(receipt.wizardWorkflow);
      delete previous.upgradeHistory;
      const history = [...(receipt.wizardWorkflow.upgradeHistory || []), {version: 1, operation: value.publicPlan.operation,
        previous, ...(buildOnly ? {scope: 'build-environment'} : {}), sourceRevision: value.publicPlan.sourceRevision, mrIid: value.checkpoint.mr.iid, pipelineId: value.publicPlan.pipelineId,
        imageRef: value.publicPlan.imageRef}];
      receipt.wizardWorkflow = {...value.workflow, build: value.build, environments: value.environment, upgradeHistory: history};
      const next = value.current.text.split('\n').map(line => line.startsWith(PREFIX) ? PREFIX + Buffer.from(JSON.stringify(receipt)).toString('base64') : line).join('\n');
      signature(next); atomic(this.config, next);
      value.checkpoint.phase = 'adopted'; value.checkpoint.adoptedConfigHash = hash(next); this.save(value.checkpoint);
      return {phase: 'adopted', projectId: receipt.repository.id, sourceRevision: value.publicPlan.sourceRevision, imageRef: value.publicPlan.imageRef};
    } finally { this.release(); }
  }
}
module.exports = {Upgrade, readConfiguration, sourceMarker, buildMarker, environmentMarker};
if (require.main === module) (async () => {
  const [action, optionsFile, confirmation] = process.argv.slice(2);
  const options = JSON.parse(fs.readFileSync(optionsFile, 'utf8'));
  if (Object.keys(options).some(key => !['credentialFile', 'helperImage', 'config', 'mainConfig', 'directory', 'buildProfile'].includes(key)))
    throw Error('Unknown operator option.');
  const upgrade = new Upgrade(options);
  const buildOnly = action.startsWith('build-'), command = buildOnly ? action.slice(6) : action;
  if (command === 'plan' || command === 'adoption-plan') {
    const result = await (command === 'plan' ? upgrade.plan(buildOnly) : upgrade.adoptionPlan(buildOnly));
    console.log(JSON.stringify({plan: result.publicPlan, planHash: result.planHash}));
  } else if (command === 'stage' || command === 'adopt') console.log(JSON.stringify(await upgrade[command](confirmation, buildOnly)));
  else throw Error('Use plan, stage, adoption-plan or adopt; prefix build- for the source-preserving recipe upgrade.');
})().catch(() => { console.error('Managed Wizard upgrade failed. Inspect the private checkpoint and reviewed preconditions; uncertain writes are never blindly repeated.'); process.exitCode = 1; });
