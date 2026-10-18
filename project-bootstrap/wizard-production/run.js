'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawn} = require('child_process');
const os = require('os');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value || '');
const imageRef = value => /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(value || '');
const ipv4 = value => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value || '') && value.split('.').every(n => +n < 256);
function signature(data) {
  if (data[807] !== '$' || crypto.createHash('md5').update(data.slice(0, 1184)).digest('hex') !== 'bd4a8426355824593a5e21ad759830c1')
    throw new Error('Configuration signature changed.');
}
function replaceUpstream(template, expected, next) {
  if (!ipv4(expected) || !ipv4(next)) throw new Error('Invalid Wizard address.');
  let matches = 0;
  const result = template.replace(/(\bupstream wizard\s*\{\s*server\s+)([0-9.]+)(:80;\s*\})/g, (_all, before, address, after) => {
    matches++;
    if (address !== expected) throw new Error('Production Wizard route changed.');
    return before + next + after;
  });
  if (matches !== 1) throw new Error('Production requires exactly one canonical Wizard upstream.');
  return result;
}
function atomic(file, content, mode = 0o600) {
  const temporary = file + '.production-' + crypto.randomBytes(12).toString('hex');
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', mode); fs.writeFileSync(fd, content); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
    const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function setting(content, key) {
  let value;
  for (const line of content.split('\n')) {
    const match = /^(?:export )?([A-Z_]+)=(?:"([^"$`\\]*)"|'([^']*)'|([A-Za-z0-9_./:@+-]+))\s*$/.exec(line);
    if (match?.[1] === key) value = match[2] ?? match[3] ?? match[4];
  }
  return value;
}
function proofInput(value) {
  const keys = ['version', 'projectId', 'projectPath', 'pipelineId', 'sourceCommit', 'imageRef', 'productionHost'];
  if (!value || Object.keys(value).some(key => !keys.includes(key)) || value.version !== 1 ||
      ![value.projectId, value.pipelineId].every(id => Number.isSafeInteger(id) && id > 0) ||
      !/^[A-Za-z0-9_./-]+$/.test(value.projectPath || '') || !/^[a-f0-9]{40}$/.test(value.sourceCommit || '') ||
      !imageRef(value.imageRef) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value.productionHost || ''))
    throw new Error('Provide an exact private GitLab pipeline, source, registry digest and Production host.');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
class Promotion {
  constructor(options = {}) {
    this.config = options.config || '/state/.docker.env';
    this.template = options.template || '/templates/default.conf.template';
    this.wizardEnv = options.wizardEnv || '/system/wizard/.docker.env';
    this.directory = options.directory || '/state/wizard-production';
    this.lock = options.lock || '/state/.projects.env/.wizard.env.environments.lock';
    this.compose = options.compose || '/system/system/docker-compose.yml';
    this.command = options.command || this.docker.bind(this);
    this.pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.token = crypto.randomBytes(24).toString('hex');
    this.checkpointFile = path.join(this.directory, 'checkpoint.json');
    this.recovering = false;
    this.ownerAlive = options.ownerAlive || (owner => {
      try { return owner.hostname === os.hostname() && fs.readFileSync('/proc/' + owner.pid + '/stat', 'utf8').split(' ')[21] === owner.processStart; }
      catch (_) { return false; }
    });
  }
  docker(args, input = '', timeout = 180000) {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', args, {stdio: ['pipe', 'pipe', 'pipe']});
      let output = '', size = 0, finished = false;
      const done = error => { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(output.trim()); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); done(new Error('Bounded Docker operation timed out.')); }, timeout);
      child.stdout.on('data', data => { size += data.length; if (size > 2000000) { child.kill('SIGKILL'); done(new Error('Docker response exceeded its bound.')); } else output += data; });
      // Docker/Rails diagnostics can contain credentials. They never reach logs.
      child.stderr.resume(); child.on('error', () => done(new Error('Docker command unavailable.')));
      child.on('close', code => done(code === 0 ? undefined : new Error('Owned Production operation failed.')));
      child.stdin.on('error', () => undefined); child.stdin.end(input);
    });
  }
  async inspect(name) {
    return JSON.parse(await this.command(['inspect', '--format', '{"id":{{json .Id}},"imageId":{{json .Image}},"labels":{{json .Config.Labels}},"networks":{{json .NetworkSettings.Networks}}}', name]));
  }
  address(container) {
    const networks = Object.entries(container.networks || {}).filter(([, network]) => ipv4(network.IPAddress));
    if (networks.length !== 1) throw new Error('The canonical Wizard must have exactly one IPv4 Docker network.');
    return {network: networks[0][0], address: networks[0][1].IPAddress};
  }
  async image(reference) {
    return JSON.parse(await this.command(['image', 'inspect', '--format', '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"labels":{{json .Config.Labels}}}', reference]));
  }
  async plan(input, rollback = false) {
    const proof = rollback ? input : proofInput(input);
    const config = fs.readFileSync(this.config, 'utf8'), template = fs.readFileSync(this.template, 'utf8');
    signature(config);
    if (setting(config, 'WIZARD_HOST') !== proof.productionHost || setting(config, 'WIZARD_ENABLE') !== 'true')
      throw new Error('Production host does not match the enabled canonical configuration.');
    const current = await this.inspect('system_wizard_1');
    if (!imageId(current.imageId) || current.labels?.['com.docker.compose.project'] !== 'system' ||
        current.labels?.['com.docker.compose.service'] !== 'wizard') throw new Error('Canonical Wizard ownership changed.');
    const network = this.address(current);
    replaceUpstream(template, network.address, network.address);
    const target = await this.image(proof.imageRef);
    if (!imageId(target.id) || (!rollback && (!target.digests?.includes(proof.imageRef) ||
        target.labels?.['org.opencontainers.image.revision'] !== proof.sourceCommit)))
      throw new Error('Pre-pull the exact verified image; its digest and source label must agree.');
    const publicPlan = {version: 1, action: rollback ? 'rollback' : 'promote', proof,
      previousImageId: current.imageId, targetImageId: target.id, configHash: hash(config), templateHash: hash(template), network: network.network};
    return {publicPlan, planHash: hash(JSON.stringify(publicPlan)), config, template, current, network, target, proof};
  }
  acquire() {
    fs.mkdirSync(this.directory, {recursive: true, mode: 0o700});
    fs.mkdirSync(this.lock, {mode: 0o700});
    try { fs.writeFileSync(path.join(this.lock, 'owner'), JSON.stringify({token: this.token, helper: 'wizard-production', pid: process.pid, hostname: os.hostname(),
      processStart: fs.readFileSync('/proc/self/stat', 'utf8').split(' ')[21]}), {flag: 'wx', mode: 0o600}); }
    catch (error) { fs.rmdirSync(this.lock); throw error; }
  }
  release() {
    const owner = JSON.parse(fs.readFileSync(path.join(this.lock, 'owner'), 'utf8'));
    if (owner.token !== this.token) throw new Error('Production mutex ownership changed.');
    fs.unlinkSync(path.join(this.lock, 'owner')); fs.rmdirSync(this.lock);
  }
  save(checkpoint, phase) { checkpoint.phase = phase; atomic(this.checkpointFile, JSON.stringify(checkpoint)); }
  compare(file, expected) { if (fs.readFileSync(file, 'utf8') !== expected) throw new Error('Configuration or route changed concurrently.'); }
  async reload() {
    await this.command(['exec', 'system_web_1', '/docker-entrypoint.d/20-envsubst-on-templates.sh']);
    await this.command(['exec', 'system_web_1', 'nginx', '-t']);
    await this.command(['exec', 'system_web_1', 'nginx', '-s', 'reload']);
  }
  async route(checkpoint, next) {
    this.compare(this.template, checkpoint.liveTemplate);
    atomic(this.template, next, 0o644); checkpoint.liveTemplate = next;
    this.save(checkpoint, 'route-written'); await this.reload();
  }
  async health(name) {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const html = await this.command(['exec', name, 'wget', '-q', '-O', '-', 'http://127.0.0.1/'], '', 10000);
        if (html.includes('<div id="root"></div>') && html.includes('<title>System Bootstrapper</title>')) return;
      } catch (_) { /* bounded readiness retry, no diagnostic contents */ }
      await this.pause(1000);
    }
    throw new Error('Wizard health gate failed.');
  }
  async composeImage(checkpoint, reference, config) {
    if (!(imageId(reference) || imageRef(reference))) throw new Error('Only immutable Wizard images can be applied.');
    const snapshot = path.join(this.directory, checkpoint.operation + '.env');
    const content = config + (config.endsWith('\n') ? '' : '\n') + "export WIZARD_IMAGE='" + reference + "'\n";
    signature(content); atomic(snapshot, content);
    await this.command(['exec', 'system_bootstrapper_1', 'bash', '-e', '-c',
      'set -a; . "$1"; exec docker-compose -f "$2" up --no-deps --pull never -d wizard',
      '--', snapshot, this.compose], '', 180000);
    const result = await this.inspect('system_wizard_1');
    const expected = await this.image(reference);
    if (result.imageId !== expected.id) throw new Error('Canonical Wizard image changed during deployment.');
    await this.health('system_wizard_1');
    atomic(this.wizardEnv, 'WIZARD_IP=' + this.address(result).address + '\n');
    return result;
  }
  async removeCandidate(checkpoint) {
    const ids = checkpoint.candidateId ? [checkpoint.candidateId] :
      (await this.command(['ps', '-aq', '--filter', 'label=system.wizard.production.operation=' + checkpoint.operation])).split('\n').filter(Boolean);
    for (const id of ids) {
      const row = await this.inspect(id);
      if (row.id !== id || row.labels?.['system.wizard.production.operation'] !== checkpoint.operation)
        throw new Error('Candidate ownership changed; refusing cleanup.');
      await this.command(['rm', '-f', id]);
    }
    checkpoint.candidateId = null;
  }
  async verify(proof) {
    const ruby = fs.readFileSync(path.join(__dirname, 'verify.rb'), 'utf8');
    const script = "WIZARD_PRODUCTION_PROOF = '" + Buffer.from(JSON.stringify(proof)).toString('base64') + "'\n" + ruby;
    const result = JSON.parse((await this.command(['exec', '-i', 'system_gitlab_1', 'gitlab-rails', 'runner', '-'], script, 180000)).split('\n').pop());
    if (!result.ok) throw new Error('GitLab source, pipeline, required jobs or matching artifacts were not verified.');
  }
  async restore(checkpoint) {
    this.recovering = true;
    this.compare(this.config, checkpoint.liveConfig);
    this.compare(this.template, checkpoint.liveTemplate);
    const restored = checkpoint.canonicalAttempted ?
      await this.composeImage(checkpoint, checkpoint.previousImageId, checkpoint.previousConfig) : await this.inspect('system_wizard_1');
    if (restored.imageId !== checkpoint.previousImageId) throw new Error('Previous canonical image changed.');
    atomic(this.config, checkpoint.previousConfig); checkpoint.liveConfig = checkpoint.previousConfig;
    await this.route(checkpoint, replaceUpstream(checkpoint.previousTemplate, checkpoint.previousAddress, this.address(restored).address));
    this.save(checkpoint, 'rolled-back'); await this.removeCandidate(checkpoint);
  }
  async apply(input, confirmation, rollback = false) {
    this.acquire(); let checkpoint;
    try {
      if (fs.existsSync(this.checkpointFile) && !['complete', 'rolled-back'].includes(JSON.parse(fs.readFileSync(this.checkpointFile, 'utf8')).phase))
        throw new Error('Recover the existing incomplete Production checkpoint before another deployment.');
      const plan = await this.plan(input, rollback);
      if (plan.planHash !== confirmation) throw new Error('Preview and confirm the current exact plan before applying.');
      if (!rollback) await this.verify(plan.proof);
      this.compare(this.config, plan.config); this.compare(this.template, plan.template);
      if ((await this.inspect('system_wizard_1')).imageId !== plan.current.imageId) throw new Error('Current Wizard image changed.');
      checkpoint = {version: 1, operation: this.token, plan: plan.publicPlan, previousImageId: plan.current.imageId,
        previousAddress: plan.network.address, previousConfig: plan.config, previousTemplate: plan.template,
        liveConfig: plan.config, liveTemplate: plan.template, targetImageId: plan.target.id};
      this.save(checkpoint, 'prepared');
      const candidate = 'wizard-production-' + this.token;
      checkpoint.candidateId = await this.command(['create', '--name', candidate, '--network', plan.network.network,
        '--memory', '128m', '--cpus', '0.5', '--label', 'system.wizard.production.operation=' + this.token, plan.proof.imageRef]);
      this.save(checkpoint, 'candidate-created'); await this.command(['start', checkpoint.candidateId]);
      await this.health(checkpoint.candidateId);
      const candidateAddress = this.address(await this.inspect(checkpoint.candidateId)).address;
      await this.route(checkpoint, replaceUpstream(plan.template, plan.network.address, candidateAddress));
      this.save(checkpoint, 'candidate-serving');
      this.compare(this.config, checkpoint.liveConfig);
      const nextConfig = plan.config + (plan.config.endsWith('\n') ? '' : '\n') + "export WIZARD_IMAGE='" + plan.proof.imageRef + "'\n";
      signature(nextConfig); atomic(this.config, nextConfig); checkpoint.liveConfig = nextConfig;
      this.save(checkpoint, 'config-written');
      this.compare(this.config, checkpoint.liveConfig);
      checkpoint.canonicalAttempted = true; this.save(checkpoint, 'canonical-starting');
      const deployed = await this.composeImage(checkpoint, plan.proof.imageRef, nextConfig);
      this.compare(this.config, checkpoint.liveConfig);
      await this.route(checkpoint, replaceUpstream(plan.template, plan.network.address, this.address(deployed).address));
      checkpoint.activeImageId = deployed.imageId; checkpoint.activeConfigHash = hash(nextConfig); checkpoint.activeTemplateHash = hash(checkpoint.liveTemplate);
      this.save(checkpoint, 'complete'); await this.removeCandidate(checkpoint); this.save(checkpoint, 'complete');
      return {phase: checkpoint.phase, imageId: deployed.imageId, imageRef: plan.proof.imageRef};
    } catch (error) {
      if (checkpoint) {
        try { await this.restore(checkpoint); }
        catch (_) { this.save(checkpoint, 'requires-reconciliation'); throw new Error('Deployment recovery requires reconciliation. The owned candidate and private checkpoint are retained.'); }
      }
      throw error;
    } finally { if (checkpoint?.phase !== 'requires-reconciliation') this.release(); }
  }
  recoveryPlan() {
    const checkpoint = JSON.parse(fs.readFileSync(this.checkpointFile, 'utf8'));
    const owner = JSON.parse(fs.readFileSync(path.join(this.lock, 'owner'), 'utf8'));
    if (['complete', 'rolled-back'].includes(checkpoint.phase) || owner.token !== checkpoint.operation || this.ownerAlive(owner))
      throw new Error('Recovery requires the inactive, token-owned incomplete deployment.');
    const plan = {version: 1, operation: checkpoint.operation, phase: checkpoint.phase,
      configHash: hash(fs.readFileSync(this.config)), templateHash: hash(fs.readFileSync(this.template)),
      expectedConfigHash: hash(checkpoint.liveConfig), expectedTemplateHash: hash(checkpoint.liveTemplate),
      previousImageId: checkpoint.previousImageId};
    return {checkpoint, publicPlan: plan, planHash: hash(JSON.stringify(plan))};
  }
  async recover(confirmation) {
    const plan = this.recoveryPlan();
    if (plan.planHash !== confirmation) throw new Error('Confirm the exact current recovery plan.');
    this.token = plan.checkpoint.operation;
    try { await this.restore(plan.checkpoint); this.release(); return {phase: 'rolled-back'}; }
    catch (_) { this.save(plan.checkpoint, 'requires-reconciliation'); throw new Error('Private checkpoint and mutex retained; reconcile changed configuration or unavailable Docker resources.'); }
  }
  async rollbackPlan() {
    const checkpoint = JSON.parse(fs.readFileSync(this.checkpointFile, 'utf8'));
    if (checkpoint.phase !== 'complete' || !imageId(checkpoint.previousImageId) ||
        hash(fs.readFileSync(this.config)) !== checkpoint.activeConfigHash || hash(fs.readFileSync(this.template)) !== checkpoint.activeTemplateHash ||
        (await this.inspect('system_wizard_1')).imageId !== checkpoint.activeImageId)
      throw new Error('The completed deployment checkpoint no longer matches the live configuration, route and image.');
    return this.plan({...checkpoint.plan.proof, imageRef: checkpoint.previousImageId}, true);
  }
}
module.exports = {Promotion, hash, signature, replaceUpstream, atomic, proofInput};
if (require.main === module) {
  (async () => {
    const [action, file, confirmation] = process.argv.slice(2);
    const promotion = new Promotion();
    if (action === 'plan' && file && !confirmation) {
      const result = await promotion.plan(JSON.parse(fs.readFileSync(file, 'utf8')));
      console.log(JSON.stringify({...result.publicPlan, planHash: result.planHash}));
    } else if (action === 'apply' && file && confirmation) {
      console.log(JSON.stringify(await promotion.apply(JSON.parse(fs.readFileSync(file, 'utf8')), confirmation)));
    } else if (action === 'recover-plan' && !file) {
      const result = promotion.recoveryPlan(); console.log(JSON.stringify({...result.publicPlan, planHash: result.planHash}));
    } else if (action === 'recover' && file && !confirmation) {
      console.log(JSON.stringify(await promotion.recover(file)));
    } else if (action === 'rollback-plan' && !file) {
      const result = await promotion.rollbackPlan(); console.log(JSON.stringify({...result.publicPlan, planHash: result.planHash}));
    } else if (action === 'rollback' && file && !confirmation) {
      const result = await promotion.rollbackPlan(); console.log(JSON.stringify(await promotion.apply(result.proof, file, true)));
    } else throw new Error('Usage: run.js plan PROOF | apply PROOF PLAN_HASH | rollback-plan | rollback PLAN_HASH | recover-plan | recover PLAN_HASH');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
