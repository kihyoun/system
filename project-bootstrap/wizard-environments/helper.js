'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawn} = require('child_process');
const state = require('./state');
const ROOT = '/templates/wizard-environments';
const canonicalCode = fs.readFileSync(path.join(__dirname, 'canonical.js'), 'utf8')
  .replace("if (require.main === module)", 'if (true)');
const verifier = fs.readFileSync(path.join(__dirname, 'verify.rb'), 'utf8');
function canonicalLogo() {
  const source = fs.readFileSync(path.join(__dirname, '../../sync/src/Helper.ts'), 'utf8');
  const logo = source.match(/return `([\s\S]*?)`;/)?.[1];
  if (!logo || logo[807] !== '$' || crypto.createHash('md5').update(logo.slice(0, 1184)).digest('hex') !== 'bd4a8426355824593a5e21ad759830c1')
    throw new Error('Immutable helper signature source changed.');
  return logo;
}
function canonicalRecipe(environment) {
  const recipe = require('./recipe').generate(canonicalLogo(), environment);
  if (recipe.recipeHash !== environment.recipeHash) throw new Error('Immutable helper recipe identity changed.');
  return recipe;
}
function canonicalLegacyRecipe(recipeHash) {
  const recipes = require('../wizard-build/recipe');
  try { return recipeHash ? recipes.select(canonicalLogo(), recipeHash) : recipes.generate(canonicalLogo()); }
  catch (_) { throw new Error('Canonical managed build recipe identity changed.'); }
}
function parse(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z]+$/.test(args[i] || '') || args[i + 1] === undefined || values[args[i].slice(2)] !== undefined)
      throw new Error('Invalid helper arguments.');
    values[args[i].slice(2)] = args[i + 1];
  }
  if (values.controller !== 'system_bootstrapper_1' || Object.keys(values).length !== 9)
    throw new Error('Original controller is required.');
  return state.validRequest({action: values.action, kind: values.kind, projectId: Number(values.project),
    pipelineId: Number(values.pipeline), jobId: Number(values.job), sourceCommit: values.sha,
    mrIid: Number(values.mr), operation: values.operation});
}
class Runtime {
  constructor(request, options = {}) {
    this.request = request;
    this.token = crypto.randomBytes(24).toString('hex');
    this.helperName = 'wizard-environment-' + request.projectId + '-' + request.jobId;
    this.cancelled = false;
    this.children = new Set();
    this.root = options.root || ROOT;
    this.deadline = Date.now() + 480000;
  }
  cancel() { this.cancelled = true; this.cleanupDeadline ||= Date.now() + 90000; for (const child of this.children) child.kill('SIGTERM'); }
  command(args, input = '', options = {}) {
    if (!options.cleanup && (this.cancelled || Date.now() >= this.deadline)) return Promise.reject(new Error('Environment operation cancelled or timed out.'));
    if (options.cleanup && !options.release && this.cleanupDeadline && Date.now() >= this.cleanupDeadline)
      return Promise.reject(new Error('Bounded recovery budget exhausted; reservation retained for reconciliation.'));
    return new Promise((resolve, reject) => {
      const child = spawn('docker', args, {stdio: ['pipe', 'pipe', 'pipe']});
      this.children.add(child);
      let output = '', total = 0, finished = false;
      const budget = options.cleanup && !options.release && this.cleanupDeadline ? Math.max(1, this.cleanupDeadline - Date.now()) : Infinity;
      const timer = setTimeout(() => { child.kill('SIGKILL'); done(new Error('Bounded Docker operation timed out.')); }, Math.min(options.timeout || 180000, budget));
      const done = (error) => {
        if (finished) return; finished = true; clearTimeout(timer); this.children.delete(child);
        if (error) reject(error); else resolve(output.trim());
      };
      child.stdout.on('data', chunk => {
        total += chunk.length;
        if (total > 2000000) { child.kill('SIGKILL'); done(new Error('Bounded Docker response exceeded its limit.')); }
        else output += chunk;
      });
      child.stderr.resume();
      child.on('error', () => done(new Error('Docker command unavailable.')));
      child.on('close', code => done(code === 0 ? undefined : new Error('Owned Docker or canonical environment check failed.')));
      child.stdin.on('error', () => undefined); child.stdin.end(input);
    });
  }
  async json(args, input, options) {
    try { return JSON.parse(await this.command(args, input, options)); }
    catch (_) { throw new Error('Canonical environment operation failed; inspect the recorded reservation.'); }
  }
  async canonical(action, extra = {}, cleanup = false) {
    const result = await this.json(['exec', '-i', 'system_bootstrapper_1', 'node', '-e', canonicalCode],
      JSON.stringify({action, payload: {operation: this.request.operation, token: this.token, helper: this.helperName, ...extra}}),
      {timeout: 20000, cleanup, release: action === 'unlock'});
    if (result.ok === false) throw new Error('Canonical environment check failed; reconcile the reservation or held lock.');
    return result;
  }
  async save(deployments, cleanup = false) {
    const result = await this.canonical('cas', {expectedHash: this.context.contentHash, deployments}, cleanup);
    this.context.contentHash = result.contentHash;
    this.environment.deployments = deployments;
  }
  async inspected(name, type = 'container', cleanup = false) {
    const format = type === 'network' ? '{"labels":{{json .Labels}},"containers":{{json .Containers}}}' :
      '{"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"image":{{json .Image}},"networks":{{json .NetworkSettings.Networks}}}';
    const listing = await this.command(type === 'network' ? ['network', 'ls', '--filter', 'name=^' + name + '$', '--format', '{{.Name}}'] :
      ['container', 'ls', '--all', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}'], '', {timeout: 15000, cleanup});
    if (!listing) return null;
    if (listing !== name) throw new Error('Ambiguous owned resource identity.');
    return this.json([type, 'inspect', '--format', format, name], '', {timeout: 15000, cleanup});
  }
  async owned(value, cleanup = false) {
    const data = await this.inspected(value.containerName, 'container', cleanup);
    if (!data) return null;
    for (const [key, expected] of Object.entries(state.labels(value))) {
      if (data.labels?.[key] !== expected) throw new Error('Candidate container ownership changed.');
    }
    return data;
  }
  async remove(value, cleanup = false) {
    if (await this.owned(value, cleanup)) await this.command(['rm', '-f', value.containerName], '', {cleanup, timeout: 20000});
  }
  async network(value) {
    const expected = {...state.labels(value)}; delete expected['system.wizard.environments.generation'];
    const current = await this.inspected(value.networkName, 'network');
    if (current) {
      if (Object.entries(expected).some(([key, val]) => current.labels?.[key] !== val)) throw new Error('Candidate network ownership changed.');
      return;
    }
    const args = ['network', 'create', '--internal'];
    for (const [key, val] of Object.entries(expected)) args.push('--label', key + '=' + val);
    args.push(value.networkName); await this.command(args);
  }
  async removeNetwork(value, cleanup = false) {
    const data = await this.inspected(value.networkName, 'network', cleanup);
    if (!data) return;
    const expected = {...state.labels(value)}; delete expected['system.wizard.environments.generation'];
    if (Object.entries(expected).some(([key, val]) => data.labels?.[key] !== val)) throw new Error('Candidate network ownership changed.');
    if (Object.keys(data.containers || {}).length === 0) await this.command(['network', 'rm', value.networkName], '', {cleanup, timeout: 15000});
  }
  async health(value, options = {}) {
    for (let attempt = 0; attempt < (options.once ? 1 : 30); attempt++) {
      if (this.cancelled || Date.now() >= this.deadline) throw new Error('Environment operation cancelled or timed out.');
      const data = await this.owned(value, options.cleanup);
      if (data?.running) {
        try {
          await this.command(['exec', value.containerName, 'wget', '-q', '-T', '2', '-O', '/dev/null', 'http://127.0.0.1/'], '',
            {timeout: 5000, cleanup: options.cleanup});
          return true;
        } catch (_) {
          if (this.cancelled || Date.now() >= this.deadline) throw new Error('Environment operation cancelled or timed out.');
        }
      }
      if (!options.once) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
  }
  fragment(kind) { return path.join(this.root, kind + '.conf'); }
  readFragment(kind) {
    try { return fs.readFileSync(this.fragment(kind), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  writeFragment(kind, text) {
    fs.mkdirSync(this.root, {recursive: true, mode: 0o700});
    if (text === null) { try { fs.unlinkSync(this.fragment(kind)); } catch (e) { if (e.code !== 'ENOENT') throw e; } return; }
    const temporary = this.fragment(kind) + '.next-' + this.token;
    fs.writeFileSync(temporary, text, {flag: 'wx', mode: 0o600}); fs.renameSync(temporary, this.fragment(kind));
  }
  async reload(cleanup = false) {
    await this.command(['exec', 'system_web_1', 'nginx', '-t'], '', {cleanup, timeout: 15000});
    await this.command(['exec', 'system_web_1', 'nginx', '-s', 'reload'], '', {cleanup, timeout: 15000});
  }
  checkFragment(text, allowed) {
    if (text !== null && !allowed.filter(Boolean).some(value => text.startsWith(state.marker(value) + '\n') && value.routeHash === state.hash(text)))
      throw new Error('Candidate route is not owned by this reservation.');
  }
  async reconcile(slot) {
    if (!slot.pending) return slot;
    const pending = slot.pending;
    const fragment = this.readFragment(pending.kind);
    this.checkFragment(fragment, [pending, slot.active]);
    if (fragment?.startsWith(state.marker(pending) + '\n') && state.hash(fragment) === pending.routeHash) {
      if (!await this.health(pending, {once: true})) throw new Error('Pending routed candidate is unhealthy; explicit recovery is required.');
      await this.reload();
      const next = {...slot, active: {...pending, state: 'active'}, pending: null, tombstone: null,
        retired: [...(slot.retired || []), ...(slot.active && slot.active.containerName !== pending.containerName ? [slot.active] : [])]};
      await this.save({...this.environment.deployments, [pending.kind]: next});
      return next;
    }
    if (pending.containerName !== slot.active?.containerName) { await this.remove(pending); await this.removeNetwork(pending); }
    const next = {...slot, pending: null};
    await this.save({...this.environment.deployments, [pending.kind]: next});
    return next;
  }
  async cleanupRetired(slot) {
    if (!slot.retired?.length) return slot;
    for (const value of slot.retired) { await this.remove(value); await this.removeNetwork(value); }
    const next = {...slot, retired: []};
    await this.save({...this.environment.deployments, [this.request.kind]: next});
    return next;
  }
  async cleanupTombstone(slot) {
    if (!slot.tombstone || slot.active || slot.pending) return slot;
    const stopped = slot.tombstone;
    await this.remove(stopped); await this.removeNetwork(stopped);
    if (await this.inspected(stopped.networkName, 'network')) throw new Error('Stopped owned network is still in use; reconcile it before reusing the host.');
    const next = {...slot, tombstone: {...stopped, cleanupComplete: true}};
    await this.save({...this.environment.deployments, [this.request.kind]: next});
    return next;
  }
  async cleanupStoppedRoute(slot) {
    if (slot.active || slot.pending) throw new Error('Stop active and reconcile pending deployments before route cleanup.');
    if (!slot.tombstone) return slot;
    slot = await this.cleanupTombstone(slot);
    const previous = this.readFragment(this.request.kind);
    this.checkFragment(previous, [slot.tombstone]);
    if (previous === null) return slot;
    this.writeFragment(this.request.kind, null);
    try {
      await this.reload();
      const next = {...slot, tombstone: {...slot.tombstone, routeRemoved: true}};
      await this.save({...this.environment.deployments, [this.request.kind]: next});
      return next;
    } catch (error) { this.writeFragment(this.request.kind, previous); await this.reload(true); throw error; }
  }
  async refreshActive(slot) {
    const active = slot.active;
    const previous = this.readFragment(active.kind);
    this.checkFragment(previous, [active]);
    if (!await this.health(active, {once: true})) throw new Error('Existing candidate is unhealthy.');
    const inspected = await this.owned(active);
    const route = state.route(active, this.setting, inspected.networks?.[active.networkName]?.IPAddress);
    if (route === previous) return {state: 'active', unchanged: true};
    const pending = {...active, state: 'pending', routeHash: state.hash(route)};
    await this.save({...this.environment.deployments, [active.kind]: {...slot, pending}});
    try {
      this.writeFragment(active.kind, route); await this.reload();
      await this.save({...this.environment.deployments, [active.kind]: {...slot, active: {...pending, state: 'active'}, pending: null}});
      return {state: 'active', reconciled: true};
    } catch (error) {
      this.cleanupDeadline ||= Date.now() + 90000;
      this.writeFragment(active.kind, previous); await this.reload(true);
      await this.save({...this.environment.deployments, [active.kind]: {...slot, pending: null}}, true);
      throw error;
    }
  }
  async readiness() {
    await this.canonical('dns');
    const production = this.context.publicSettings.WIZARD_HOST;
    const reserved = new Set([production, this.context.publicSettings.GITLAB_HOST, this.context.publicSettings.GITLAB_REGISTRY_HOST]);
    const hosts = [];
    for (const kind of ['review', 'beta']) {
      const setting = this.environment.settings[kind];
      if (!setting.enabled) continue;
      if (setting.domainMode !== 2 || !/^[a-z0-9][a-z0-9.-]*$/.test(setting.host || '') || reserved.has(setting.host) || hosts.includes(setting.host))
        throw new Error('Candidate host conflicts with a platform route.');
      hosts.push(setting.host);
      if (![setting.ssl, setting.sslKey].every(p => /^\/ssl\/[A-Za-z0-9_./-]+$/.test(p || '') && !p.includes('..')))
        throw new Error('Invalid candidate certificate path.');
      let certificate;
      try {
        const sslRoot = fs.realpathSync('/ssl') + path.sep;
        if (![setting.ssl, setting.sslKey].every(p => fs.realpathSync(p).startsWith(sslRoot))) throw new Error('certificate-path');
        certificate = new crypto.X509Certificate(fs.readFileSync(setting.ssl));
        const key = crypto.createPrivateKey(fs.readFileSync(setting.sslKey));
        if (!certificate.checkPrivateKey(key)) throw new Error('key');
      } catch (_) { throw new Error('Candidate certificate is unavailable.'); }
      if (certificate.checkHost(setting.host, {subject: 'never', wildcards: false}) !== setting.host ||
          Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now())
        throw new Error('Candidate certificate does not cover its exact host or is expired.');
    }
  }
  async verify() {
    const registry = new URL(this.context.publicSettings.GITLAB_REGISTRY_URL);
    if (Number(this.context.publicSettings.GITLAB_REGISTRY_DOMAIN_MODE || 0) < 2) registry.port = '5050';
    const workflow = this.context.receipt.wizardWorkflow;
    const build = workflow?.build;
    if (this.context.receipt.repository.managementMode === 'source-primary') {
      const proof = require('./source-primary').reservation(this.environment);
      if (proof.recipeHash !== this.environment.recipeHash || build?.version !== 1 || build.mode !== 'source-primary' ||
          this.context.receipt.sourcePrimary?.version !== 1 ||
          JSON.stringify(this.context.receipt.sourcePrimary.ciFiles) !== JSON.stringify(this.environment.ciFiles))
        throw new Error('Canonical source-primary CI reservation changed.');
      return this.verifyInput({repository: this.context.receipt.repository, sourcePrimary: this.context.receipt.sourcePrimary,
        request: this.request, registryPrefix: registry.host + '/' + this.context.receipt.repository.path,
        environments: this.environment});
    }
    const legacy = canonicalLegacyRecipe(build?.recipeHash);
    if (build?.version !== 1 || build.recipeHash !== legacy.recipeHash ||
        (this.environment.buildRecipeHash && this.environment.buildRecipeHash !== build.recipeHash) || !/^[a-f0-9]{40}$/.test(build.activationCommit || ''))
      throw new Error('Canonical managed build recipe identity changed.');
    const legacyMarker = {path: '.system-bootstrapper/wizard-build.json', content: JSON.stringify({version: 1,
      operation: build.operation, recipeHash: legacy.recipeHash, sourceRevision: workflow.sourceRevision, importCommit: workflow.importCommit})};
    const input = {repository: this.context.receipt.repository, registrationOperation: this.context.receipt.operation,
      request: this.request, registryPrefix: registry.host + '/' + this.context.receipt.repository.path,
      environments: this.environment, recipe: canonicalRecipe(this.environment),
      legacyFiles: legacy.files, legacyMarker, buildActivationCommit: build.activationCommit};
    return this.verifyInput(input);
  }
  async verifyInput(input) {
    const script = "BOOTSTRAPPER_ENVIRONMENT_INPUT = '" + Buffer.from(JSON.stringify(input)).toString('base64') + "'\n" + verifier;
    const result = await this.json(['exec', '-i', 'system_gitlab_1', 'gitlab-rails', 'runner', '-'], script, {timeout: 180000});
    if (!result.ok) throw new Error('Canonical GitLab job, source, or candidate checks failed.');
    return result;
  }
  async deploy(slot, imageRef) {
    const value = state.record(this.request, this.setting.host, imageRef);
    let plan = state.deployPlan(slot, value);
    if (plan.noop) return this.refreshActive(slot);
    const previous = this.readFragment(this.request.kind);
    this.checkFragment(previous, [slot.active, slot.pending, slot.tombstone]);
    slot = await this.cleanupTombstone(slot);
    plan = state.deployPlan(slot, value);
    await this.save({...this.environment.deployments, [this.request.kind]: plan.slot});
    let routed = false, committed = false;
    try {
      await this.network(value);
      const existing = await this.owned(value);
      if (!existing) {
        // CI preloads using its ordinary job-scoped registry credential. No
        // credential crosses into the helper or canonical controller.
        await this.command(['image', 'inspect', '--format', '{{.Id}}', imageRef]);
        const args = ['run', '-d', '--restart', 'unless-stopped', '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
          '--network', value.networkName, '--name', value.containerName];
        for (const [key, val] of Object.entries(state.labels(value))) args.push('--label', key + '=' + val);
        args.push(imageRef); await this.command(args);
      }
      if (!await this.health(value)) throw new Error('Candidate did not become healthy.');
      const inspected = await this.owned(value);
      const address = inspected.networks?.[value.networkName]?.IPAddress;
      const route = state.route(value, this.setting, address);
      value.routeHash = state.hash(route);
      await this.save({...this.environment.deployments, [this.request.kind]: {...plan.slot, pending: value}});
      this.writeFragment(this.request.kind, route); routed = true;
      await this.reload();
      const next = {...plan.slot, active: {...value, state: 'active'}, pending: null, tombstone: null,
        retired: [...(slot.retired || []), ...(slot.active && slot.active.containerName !== value.containerName ? [slot.active] : [])]};
      await this.save({...this.environment.deployments, [this.request.kind]: next});
      committed = true;
      await this.cleanupRetired(next);
      return {state: 'active', host: value.host, sourceCommit: value.sourceCommit, pipelineId: value.pipelineId};
    } catch (error) {
      if (committed) throw new Error('Candidate is active; retired resource cleanup requires reconciliation.');
      this.cleanupDeadline ||= Date.now() + 90000;
      try {
        if (routed) { this.writeFragment(this.request.kind, previous); await this.reload(true); }
        await this.remove(value, true); await this.removeNetwork(value, true);
        await this.save({...this.environment.deployments, [this.request.kind]: {...plan.slot, pending: null}}, true);
      } catch (_) { throw new Error('Environment recovery is incomplete; inspect its pending receipt before retrying.'); }
      throw error;
    }
  }
  async stop(slot) {
    const plan = state.stopPlan(slot, this.request);
    if (plan.noop) return {state: 'stopped', unchanged: true};
    const previous = this.readFragment(this.request.kind);
    this.checkFragment(previous, [plan.active]);
    const tombstoneRoute = state.route(plan.slot.tombstone, this.setting);
    plan.slot.tombstone.routeHash = state.hash(tombstoneRoute);
    this.writeFragment(this.request.kind, tombstoneRoute);
    try { await this.reload(); }
    catch (_) {
      this.writeFragment(this.request.kind, previous); await this.reload(true);
      throw new Error('Stop route change failed; previous route restored.');
    }
    // Receipt tombstone is durable before deleting resources; retries may only
    // clean that exact tombstone, never a newer active generation.
    try { await this.save({...this.environment.deployments, [this.request.kind]: plan.slot}); }
    catch (_) {
      this.writeFragment(this.request.kind, previous); await this.reload(true);
      throw new Error('Stop receipt changed; previous route restored.');
    }
    await this.remove(plan.active); await this.removeNetwork(plan.active);
    return {state: 'stopped', host: plan.active.host};
  }
  async run() {
    let locked = false, lockAttempted = false;
    try {
      lockAttempted = true;
      await this.canonical('lock'); locked = true;
      this.context = await this.canonical('read');
      this.environment = this.context.receipt.wizardWorkflow?.environments;
      if (!this.environment || this.environment.operation !== this.request.operation || this.environment.phase !== 'ready' ||
          !this.environment.activationCommit || this.context.receipt.repository.id !== this.request.projectId)
        throw new Error('Managed environment reservation is not ready.');
      const own = await this.inspected(this.helperName);
      if (!own || own.image !== this.environment.helperImage || own.labels?.['system.wizard.environments.helper'] !== this.request.operation)
        throw new Error('Immutable clean helper image does not match the reservation.');
      this.environment.deployments ||= {};
      this.setting = this.environment.settings[this.request.kind];
      if (!this.setting?.enabled) throw new Error('Requested candidate environment is disabled.');
      if (this.request.action === 'deploy') await this.readiness();
      const verified = await this.verify();
      let slot = this.environment.deployments[this.request.kind] || {};
      if (this.request.action === 'stop') {
        state.stopPlan(slot, this.request); // validate before any recovery/cleanup
        slot = await this.cleanupRetired(slot);
        if (!slot.active && slot.tombstone) { await this.remove(slot.tombstone); await this.removeNetwork(slot.tombstone); }
        return await this.stop(slot);
      }
      state.recoveryAllowed(slot, this.request);
      state.deployPlan({...slot, pending: null}, state.record(this.request, this.setting.host, verified.imageRef));
      slot = await this.reconcile(slot);
      slot = await this.cleanupRetired(slot);
      return await this.deploy(slot, verified.imageRef);
    } finally {
      if (lockAttempted) {
        try { await this.canonical('unlock', {}, true); }
        catch (error) { if (locked) throw error; }
      }
    }
  }
}
if (require.main === module) {
  let runtime;
  try {
    runtime = new Runtime(parse(process.argv.slice(2)));
    process.once('SIGTERM', () => runtime.cancel()); process.once('SIGINT', () => runtime.cancel());
    runtime.run().then(result => console.log(JSON.stringify(result))).catch(error => {
      console.error(JSON.stringify({state: 'failed', message: error.message})); process.exitCode = 1;
    });
  } catch (_) { console.error('Invalid managed environment invocation.'); process.exitCode = 2; }
}
module.exports = {parse, Runtime, canonicalRecipe, canonicalLegacyRecipe};
