'use strict';
// Operator-only adoption of an existing source repository. It never imports or
// overwrites repository files, disables gates, or deletes the retired project.
const fs = require('fs');
const path = require('path');
const b = require('./binding');
const {atomic, signature} = require('../wizard-production/run');
const builds = require('../wizard-build/recipe');
function setting(text, name) {
  const matches = text.split('\n').map(line => /^(?:export )?([A-Z_]+)=(?:'([^']*)'|"([^"$`\\]*)"|([A-Za-z0-9_./:@+-]+))\s*$/.exec(line)).filter(row => row?.[1] === name);
  const value = matches.at(-1); return value && (value[2] ?? value[3] ?? value[4]);
}
class Adoption {
  constructor(options = {}) {
    this.config = options.config || '/state/.projects.env/.wizard.env';
    this.mainConfig = options.mainConfig || b.environment(this.config);
    this.directory = options.directory || '/state/wizard-source-primary';
    this.lock = this.config + '.environments.lock';
    this.request = options.request || this.api(options.credentialFile);
    this.environments = options.environments || require('../wizard-environments/source-primary').sourcePrimaryEnvironment;
  }
  api(file) {
    const metadata = fs.statSync(file);
    if (!metadata.isFile() || (metadata.mode & 0o077)) throw Error('Use a private expiring GitLab credential file.');
    const credential = JSON.parse(fs.readFileSync(file, 'utf8'));
    const base = new URL(credential.baseUrl.replace(/\/$/, '').replace(/\/api\/v4$/, '') + '/api/v4/');
    const main = fs.readFileSync(this.mainConfig, 'utf8'); signature(main);
    if (base.protocol !== 'https:' || base.host !== setting(main, 'GITLAB_HOST') || base.pathname !== '/api/v4/' || base.username || base.password || base.search || base.hash || !credential.token) throw Error('Use the configured TLS-verified GitLab API.');
    return async route => {
      const target = new URL(route, base);
      if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) throw Error('Invalid source-primary GitLab route.');
      try {
        const response = await fetch(target, {redirect: 'error', headers: {'PRIVATE-TOKEN': credential.token}, signal: AbortSignal.timeout(120000)});
        if (response.status !== 200) throw Error('status');
        const text = await response.text(); if (text.length > 16000000) throw Error('size'); return JSON.parse(text);
      } catch (_) { throw Error('Cannot independently verify the source-primary GitLab state.'); }
    };
  }
  async plan(input) {
    const keys = ['version', 'projectId', 'projectPath', 'namespaceId', 'defaultBranch', 'pipelineId', 'sourceCommit', 'imageRef', 'helperImage', 'ciFiles'];
    if (!input || Object.keys(input).some(key => !keys.includes(key)) || input.version !== 1 ||
        !['projectId', 'namespaceId', 'pipelineId'].every(key => Number.isSafeInteger(input[key]) && input[key] > 0) ||
        !b.sha(input.sourceCommit) || !/^sha256:[a-f0-9]{64}$/.test(input.helperImage || '')) throw Error('Provide an exact source-primary project, pipeline, helper and immutable image.');
    const current = b.read(this.config), main = fs.readFileSync(this.mainConfig, 'utf8'); signature(main);
    if (b.primary(current.receipt)) {
      b.validate(current.receipt);
      if (current.receipt.sourcePrimary.inputHash === b.hash(JSON.stringify(input))) {
        const archive = path.join(this.directory, current.receipt.sourcePrimary.operation + '.json');
        const record = JSON.parse(fs.readFileSync(archive, 'utf8'));
        if (JSON.stringify(record.nextReceipt) !== JSON.stringify(current.receipt) || record.plan.operation !== current.receipt.sourcePrimary.operation) throw Error('Applied source-primary receipt changed.');
        return {publicPlan: record.plan, planHash: b.hash(JSON.stringify(record.plan)), current, main, next: current.receipt, alreadyAdopted: true};
      }
      const r = current.receipt.repository;
      if (input.projectId !== r.id || input.projectPath !== r.path || input.namespaceId !== current.receipt.namespaceId || input.defaultBranch !== r.defaultBranch)
        throw Error('A source-primary CI update must retain its canonical repository identity.');
    }
    const old = current.receipt, environments = old.wizardWorkflow?.environments;
    if (!environments || environments.phase !== 'ready' || Object.values(environments.deployments || {}).some(slot => slot.active || slot.pending || slot.retired?.length)) throw Error('Stop and reconcile Review/Beta before reassignment.');
    const project = await this.request('projects/' + old.repository.id);
    if (project.id !== old.repository.id || project.path_with_namespace !== old.repository.path || project.namespace?.id !== old.namespaceId ||
        project.visibility !== 'private' || project.ci_config_path !== old.repository.ciPath ||
        (!b.primary(old) && (project.description !== 'System Bootstrapper operation ' + old.operation || old.repository.ciPath !== '.system-bootstrapper/ci.yml')))
      throw Error('Previous managed Wizard ownership changed.');
    if (!b.primary(old) && input.projectId === old.repository.id) throw Error('Select the existing distinct source-primary project.');
    const registry = new URL(setting(main, 'GITLAB_REGISTRY_URL'));
    if (!['https:', 'http:'].includes(registry.protocol) || registry.username || registry.password || registry.pathname !== '/' || registry.search || registry.hash) throw Error('Invalid configured own registry.');
    if (Number(setting(main, 'GITLAB_REGISTRY_DOMAIN_MODE')) < 2) registry.port = '5050';
    const prefix = registry.host + '/' + input.projectPath + '@sha256:';
    if (!input.imageRef?.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(input.imageRef.slice(prefix.length))) throw Error('Use an immutable image from the adopted project registry.');
    const previousImage = setting(main, 'WIZARD_IMAGE');
    const previousPrefix = registry.host + '/' + old.repository.path + '@sha256:';
    if (!previousImage?.startsWith(previousPrefix) || !/^[a-f0-9]{64}$/.test(previousImage.slice(previousPrefix.length))) throw Error('Retain the exact previous managed Production image.');
    const operation = b.hash(JSON.stringify({version: 1, config: b.hash(current.text), main: b.hash(main), input})).slice(0, 48);
    const next = JSON.parse(JSON.stringify(old));
    next.namespaceId = input.namespaceId;
    next.repository = {...old.repository, id: input.projectId, namespaceId: input.namespaceId, path: input.projectPath,
      defaultBranch: input.defaultBranch, ciPath: b.CI, managementMode: 'source-primary',
      webUrl: 'https://' + setting(main, 'GITLAB_HOST') + '/' + input.projectPath,
      pipelineUrl: 'https://' + setting(main, 'GITLAB_HOST') + '/' + input.projectPath + '/-/pipelines',
      recoveryImages: [...(old.repository.recoveryImages || []).filter(row => row.imageRef !== previousImage),
        {projectId: old.repository.id, projectPath: old.repository.path, imageRef: previousImage}]};
    next.sourcePrimary = {version: 1, operation, adoptionCommit: input.sourceCommit, pipelineId: input.pipelineId,
      ciFiles: input.ciFiles, previousRepository: {id: old.repository.id, path: old.repository.path},
      archive: operation + '.json', inputHash: b.hash(JSON.stringify(input))};
    b.validate(next);
    const branch = await this.request('projects/' + input.projectId + '/repository/branches/' + encodeURIComponent(input.defaultBranch));
    if (branch.commit?.id !== input.sourceCommit) throw Error('The source-primary default branch advanced.');
    const proof = await b.evidence(this.request, next, input.pipelineId, input.sourceCommit, input.imageRef);
    const recipe = builds.select(current.text.slice(0, 1184), old.wizardWorkflow.build.recipeHash);
    if (recipe.files.some(file => !input.ciFiles.some(source => source.path === file.path && source.sha256 === b.hash(file.content))) ||
        !input.ciFiles.some(source => source.path === '.gitlab/delivery/environment.sh')) throw Error('Approve the complete generic delivery and environment script manifest.');
    for (const file of recipe.files) {
      const row = await this.request('projects/' + input.projectId + '/repository/files/' + encodeURIComponent(file.path) + '?ref=' + input.sourceCommit);
      if (!Buffer.from(row.content.replace(/\n/g, ''), 'base64').equals(Buffer.from(file.content))) throw Error('The source-primary build recipe differs from the reviewed generic recipe.');
    }
    next.wizardWorkflow = {version: 1, phase: 'source-primary', sourceRevision: input.sourceCommit,
      build: {version: 1, mode: 'source-primary', recipeHash: recipe.recipeHash, phase: 'candidate-verified',
        pipeline: {id: proof.pipeline.id, sha: proof.pipeline.sha, status: proof.pipeline.status, webUrl: proof.pipeline.web_url},
        publishing: proof.publishing,
        artifact: {imageRef: input.imageRef, sourceCommit: input.sourceCommit, pipelineId: input.pipelineId}},
      environments: this.environments(environments, {operation, helperImage: input.helperImage, activationCommit: input.sourceCommit, ciFiles: input.ciFiles})};
    const plan = {version: 1, action: 'reassign-source-primary', operation, previousProjectId: old.repository.id,
      projectId: input.projectId, projectPath: input.projectPath, sourceCommit: input.sourceCommit, pipelineId: input.pipelineId,
      imageRef: input.imageRef, previousImageRef: previousImage, helperImage: input.helperImage,
      configHash: b.hash(current.text), mainConfigHash: b.hash(main), nextReceiptHash: b.hash(JSON.stringify(next))};
    return {publicPlan: plan, planHash: b.hash(JSON.stringify(plan)), current, main, next};
  }
  async apply(input, confirmation) {
    const owner = b.hash(String(process.pid) + Date.now() + Math.random()).slice(0, 48);
    fs.mkdirSync(this.lock, {mode: 0o700});
    try {
      fs.writeFileSync(path.join(this.lock, 'owner'), JSON.stringify({token: owner, helper: 'wizard-source-primary'}), {flag: 'wx', mode: 0o600});
      const value = await this.plan(input);
      if (confirmation !== value.planHash) throw Error('Preview and confirm the current exact reassignment plan.');
      if (value.alreadyAdopted) return {phase: 'source-primary', projectId: value.next.repository.id, operation: value.publicPlan.operation, unchanged: true};
      if (fs.readFileSync(this.config, 'utf8') !== value.current.text || fs.readFileSync(this.mainConfig, 'utf8') !== value.main) throw Error('Wizard configuration changed after preview.');
      fs.mkdirSync(this.directory, {recursive: true, mode: 0o700});
      const archive = path.join(this.directory, value.publicPlan.operation + '.json');
      const record = JSON.stringify({version: 1, plan: value.publicPlan, previousConfiguration: value.current.text,
        previousMainConfiguration: value.main, previousReceipt: value.current.receipt, nextReceipt: value.next});
      if (fs.existsSync(archive)) {
        if (fs.readFileSync(archive, 'utf8') !== record) throw Error('Existing reassignment archive changed.');
      } else atomic(archive, record);
      const next = value.current.text.split('\n').map(line => line.startsWith(b.PREFIX) ? b.PREFIX + Buffer.from(JSON.stringify(value.next)).toString('base64') : line).join('\n');
      signature(next); atomic(this.config, next);
      return {phase: 'source-primary', projectId: value.next.repository.id, archiveHash: b.hash(record), operation: value.publicPlan.operation};
    } finally {
      const file = path.join(this.lock, 'owner');
      if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).token === owner) { fs.unlinkSync(file); fs.rmdirSync(this.lock); }
    }
  }
}
module.exports = {Adoption, setting};
if (require.main === module) {
  (async () => {
    const [command, inputFile, credentialFile, confirmation] = process.argv.slice(2);
    const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const helper = new Adoption({credentialFile});
    if (command === 'plan') { const value = await helper.plan(input); console.log(JSON.stringify({...value.publicPlan, planHash: value.planHash})); }
    else if (command === 'apply') console.log(JSON.stringify(await helper.apply(input, confirmation)));
    else throw Error('Use plan or apply with an exact input, private credential file and confirmation hash.');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
