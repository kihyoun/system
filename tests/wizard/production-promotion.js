'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Promotion, hash, signature} = require('../../project-bootstrap/wizard-production/run');
const logo = require('../../sync/dist/Helper').default.textLogo;
const oldId = 'sha256:' + 'a'.repeat(64), nextId = 'sha256:' + 'b'.repeat(64);
const ref = 'registry.example.test/root/wizard@sha256:' + 'c'.repeat(64);
const proof = {version: 1, projectId: 3, projectPath: 'root/wizard', pipelineId: 21,
  sourceCommit: 'd'.repeat(40), imageRef: ref, productionHost: 'system-bootstrapper.com'};
class Fixture {
  constructor() {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-production-'));
    this.config = path.join(this.root, '.docker.env'); this.template = path.join(this.root, 'default.conf.template');
    this.wizardEnv = path.join(this.root, 'wizard.env'); this.directory = path.join(this.root, 'recovery');
    this.lock = path.join(this.root, 'operation.lock'); this.events = []; this.containers = new Map();
    this.storageRoot = '/mnt/operator-volume/platform';
    this.controller = {labels: {'com.docker.compose.project': 'system', 'com.docker.compose.service': 'bootstrapper'}, mounts: [
      {Destination: '/state', Type: 'volume', Name: 'system_configuration', RW: true},
      {Destination: '/wizard-public', Type: 'volume', Name: 'system_wizardPublic', RW: true}
    ]};
    this.publicVolume = {Name: 'system_wizardPublic', Driver: 'local', Options: {type: 'none', o: 'bind', device: this.storageRoot + '/wizard-public'}};
    this.stateVolume = {Name: 'system_configuration', Driver: 'local', Options: {type: 'none', o: 'bind', device: this.storageRoot + '/configuration'}};
    this.containers.set('system_wizard_1', this.container('canonical-id', oldId, '172.18.0.2', {
      'com.docker.compose.project': 'system', 'com.docker.compose.service': 'wizard'}));
    this.originalConfig = logo + "\nexport WIZARD_ENABLE='true'\nexport WIZARD_HOST='system-bootstrapper.com'\nexport WIZARD_IMAGE='old-tag'\n";
    this.originalTemplate = '# Preserve all other services\nupstream gitlab { server 172.18.0.3:80; }\nupstream wizard {\n    server 172.18.0.2:80;\n}\ninclude /etc/nginx/templates/wizard-environments/*.conf;\n';
    fs.writeFileSync(this.config, this.originalConfig); fs.writeFileSync(this.template, this.originalTemplate); fs.writeFileSync(this.wizardEnv, 'WIZARD_IP=172.18.0.2\n');
    this.promotion = new Promotion({...this, command: this.command.bind(this), pause: async () => undefined, ownerAlive: () => false});
  }
  container(id, imageId, address, labels) { return {id, imageId, labels, networks: {system_default: {IPAddress: address}}}; }
  async command(args) {
    if (args[0] === 'inspect') {
      if (args.at(-1) === 'system_bootstrapper_1') return JSON.stringify(this.controller);
      const row = this.containers.get(args[args.length - 1]); if (!row) throw Error('Container not found'); return JSON.stringify(row);
    }
    if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify(args.at(-1) === 'system_wizardPublic' ? this.publicVolume : this.stateVolume);
    if (args[0] === 'image') {
      const reference = args[args.length - 1];
      return JSON.stringify({id: reference === oldId ? oldId : nextId, digests: [ref], labels: {'org.opencontainers.image.revision': proof.sourceCommit}});
    }
    if (args[0] === 'create') {
      this.candidateArguments = args;
      const operation = args[args.indexOf('--label') + 1].split('=')[1]; this.events.push('candidate-created');
      const id = operation + '1'.repeat(16), target = args[args.length - 1] === oldId ? oldId : nextId;
      this.containers.set(id, this.container(id, target, '172.18.0.4', {'system.wizard.production.operation': operation}));
      if (this.lostCreate) throw Error('Lost create response'); return id;
    }
    if (args[0] === 'start') return '';
    if (args[0] === 'ps') return [...this.containers].filter(([, row]) => row.labels?.['system.wizard.production.operation'] === this.promotion.token).map(([id]) => id).join('\n');
    if (args[0] === 'rm') { this.events.push('candidate-removed'); this.containers.delete(args[2]); return ''; }
    if (args[0] === 'exec' && args.includes('system_gitlab_1')) {
      this.events.push('proof'); if (this.afterProof) this.afterProof(); return JSON.stringify({ok: !this.badProof});
    }
    if (args[0] === 'exec' && args.includes('wget')) {
      const name = args[1]; const candidate = name !== 'system_wizard_1';
      if (candidate && this.badCandidate) throw Error('Unhealthy candidate');
      if (!candidate && this.badCanonical && this.containers.get(name).imageId === nextId) throw Error('Unhealthy canonical');
      this.events.push(candidate ? 'candidate-healthy' : 'canonical-healthy');
      return '<title>System Bootstrapper</title><div id="root"></div>';
    }
    if (args[0] === 'exec' && args[1] === 'system_bootstrapper_1') {
      if (args[2] === 'node') {
        if (this.badPublication) throw Error('Public publication filesystem or content check failed');
        return JSON.stringify({ok: true});
      }
      const snapshot = args[args.indexOf('--') + 1]; const data = fs.readFileSync(snapshot, 'utf8');
      const references = [...data.matchAll(/export WIZARD_IMAGE='([^']+)'/g)];
      const image = references.pop()[1] === oldId ? oldId : nextId; this.events.push('compose-' + (image === oldId ? 'old' : 'new'));
      this.containers.get('system_wizard_1').imageId = image;
      this.containers.get('system_wizard_1').mounts = [{Type: 'volume', Name: 'system_wizardPublic', Destination: '/usr/share/nginx/wizard-public', RW: false}];
      this.containers.get('system_wizard_1').networks.system_default.IPAddress = image === oldId ? '172.18.0.9' : '172.18.0.8';
      if (this.afterCompose) this.afterCompose(image);
      return '';
    }
    if (args[0] === 'exec' && args[1] === 'system_web_1') {
      if (args[args.length - 1] === 'reload') {
        this.events.push('reload');
        if (this.failedReloads) { this.failedReloads--; throw Error('Reload failed'); }
      }
      return '';
    }
    throw Error('Unexpected adapter command');
  }
  async apply() { const plan = await this.promotion.plan(proof); return this.promotion.apply(proof, plan.planHash); }
  checkpoint() { return JSON.parse(fs.readFileSync(this.promotion.checkpointFile, 'utf8')); }
  destroy() { fs.rmSync(this.root, {recursive: true, force: true}); }
}
async function test(name, callback) { const fixture = new Fixture(); try { await callback(fixture); console.log('Production promotion: ' + name + ' passed.'); } finally { fixture.destroy(); } }
(async () => {
  await test('read-only preview, explicit hash and independent GitLab proof', async f => {
    const plan = await f.promotion.plan(proof);
    assert.equal(fs.readFileSync(f.config, 'utf8'), f.originalConfig); assert.equal(f.events.length, 0);
    await assert.rejects(f.promotion.apply(proof, 'stale'), /Preview and confirm/); assert(!fs.existsSync(f.lock));
    f.badProof = true; await assert.rejects(f.apply(), /not verified/); assert(!fs.existsSync(f.lock));
    assert.equal(f.containers.size, 1); assert.equal(fs.readFileSync(f.template, 'utf8'), f.originalTemplate);
    assert(!JSON.stringify(plan.publicPlan).includes(f.originalConfig));
  });
  await test('health-before-routing, exact digest, stable recreation and reversible checkpoint', async f => {
    const result = await f.apply(); assert.equal(result.imageId, nextId);
    assert(f.events.indexOf('candidate-healthy') < f.events.indexOf('reload'));
    assert(f.events.indexOf('reload') < f.events.indexOf('compose-new'));
    assert.equal(f.containers.size, 1); assert(!fs.existsSync(f.lock));
    signature(fs.readFileSync(f.config, 'utf8'));
    assert.equal(f.checkpoint().phase, 'complete'); assert.equal(f.checkpoint().previousImageId, oldId);
    assert.equal(fs.statSync(f.promotion.checkpointFile).mode & 0o777, 0o600);
    assert(fs.readFileSync(f.template, 'utf8').includes('upstream gitlab { server 172.18.0.3:80; }'));
    const rollback = await f.promotion.rollbackPlan(); const restored = await f.promotion.apply(rollback.proof, rollback.planHash, true);
    assert.equal(restored.imageId, oldId); assert.equal(f.containers.size, 1);
  });
  await test('first transition keeps old unmounted Wizard until a validated read-only public candidate is healthy', async f => {
    assert.equal(f.containers.get('system_wizard_1').mounts, undefined);
    await f.apply();
    const argument = f.candidateArguments[f.candidateArguments.indexOf('--mount') + 1];
    assert.equal(argument, 'type=bind,src=' + f.storageRoot + '/wizard-public,dst=/usr/share/nginx/wizard-public,readonly');
    assert(!argument.includes('type=volume'), 'A missing publication path must fail instead of creating a root-disk volume');
    assert(f.events.indexOf('candidate-healthy') < f.events.indexOf('compose-new'));
    assert.equal(f.containers.get('system_wizard_1').mounts[0].RW, false);
  });
  await test('missing, writable or unrelated public storage fails before candidate creation', async f => {
    const originalController = structuredClone(f.controller), originalPublic = structuredClone(f.publicVolume);
    f.controller.mounts.pop(); await assert.rejects(f.promotion.plan(proof), /dedicated persistent/);
    f.controller = structuredClone(originalController); f.publicVolume.Options.device = '/elsewhere/wizard-public';
    await assert.rejects(f.promotion.plan(proof), /escaped/);
    f.publicVolume = structuredClone(originalPublic); f.publicVolume.Driver = 'foreign';
    await assert.rejects(f.promotion.plan(proof), /bind-volume/);
    f.publicVolume = structuredClone(originalPublic); f.badPublication = true;
    await assert.rejects(f.promotion.plan(proof), /filesystem or content/); f.badPublication = false;
    f.containers.get('system_wizard_1').mounts = [{Type: 'volume', Name: 'system_wizardPublic', Destination: '/usr/share/nginx/wizard-public', RW: true}];
    await assert.rejects(f.promotion.plan(proof), /read-only/);
    assert(!f.events.includes('candidate-created'));
    assert.equal(fs.readFileSync(f.config, 'utf8'), f.originalConfig);
  });
  await test('public volume replacement after proof fails without changing the existing service', async f => {
    f.afterProof = () => { f.publicVolume.Options.device = '/different/wizard-public'; };
    await assert.rejects(f.apply(), /escaped/);
    assert(!f.events.includes('candidate-created'));
    assert.equal(f.containers.get('system_wizard_1').imageId, oldId);
    assert.equal(fs.readFileSync(f.template, 'utf8'), f.originalTemplate);
  });
  await test('failed candidate leaves the original canonical container untouched', async f => {
    f.badCandidate = true; await assert.rejects(f.apply(), /health gate/);
    assert(!f.events.some(event => event.startsWith('compose-'))); assert.equal(f.containers.get('system_wizard_1').imageId, oldId);
    assert.equal(f.containers.size, 1); assert.equal(fs.readFileSync(f.config, 'utf8'), f.originalConfig);
  });
  await test('lost candidate creation cleans only operation-owned IDs', async f => {
    f.lostCreate = true; await assert.rejects(f.apply(), /Lost create/); assert.equal(f.containers.size, 1);
    assert(!f.events.some(event => event.startsWith('compose-')));
  });
  await test('reload failure restores the route without replacing the canonical image', async f => {
    f.failedReloads = 1; await assert.rejects(f.apply(), /Reload failed/);
    assert.equal(fs.readFileSync(f.template, 'utf8'), f.originalTemplate); assert.equal(f.containers.size, 1);
    assert(!f.events.some(event => event.startsWith('compose-')));
  });
  await test('canonical health failure recreates the previous immutable image and uses its actual new IP', async f => {
    f.badCanonical = true; await assert.rejects(f.apply(), /health gate/);
    assert.equal(f.containers.get('system_wizard_1').imageId, oldId); assert.equal(f.containers.size, 1);
    assert(fs.readFileSync(f.template, 'utf8').includes('server 172.18.0.9:80;'));
    assert.equal(fs.readFileSync(f.config, 'utf8'), f.originalConfig); assert.equal(f.checkpoint().phase, 'rolled-back');
  });
  await test('concurrent settings are never overwritten and retain the recovery mutex until confirmed reconciliation', async f => {
    let external;
    f.afterCompose = image => { if (image === nextId) { external = fs.readFileSync(f.config, 'utf8') + '# external edit\n'; fs.writeFileSync(f.config, external); } };
    await assert.rejects(f.apply(), /requires reconciliation/);
    assert.equal(fs.readFileSync(f.config, 'utf8'), external); assert(fs.existsSync(f.lock));
    assert.equal(f.checkpoint().phase, 'requires-reconciliation'); assert.equal(f.containers.size, 2);
    const first = f.promotion.recoveryPlan(); await assert.rejects(f.promotion.recover(first.planHash), /mutex retained/);
    fs.writeFileSync(f.config, f.checkpoint().liveConfig); f.afterCompose = undefined;
    const reconciled = f.promotion.recoveryPlan(); await f.promotion.recover(reconciled.planHash);
    assert(!fs.existsSync(f.lock)); assert.equal(f.containers.size, 1); assert.equal(f.containers.get('system_wizard_1').imageId, oldId);
  });
  await test('changed source image, signature or occupied mutex refuses the operation before writes', async f => {
    const plan = await f.promotion.plan(proof);
    fs.appendFileSync(f.config, '# edit\n'); await assert.rejects(f.promotion.apply(proof, plan.planHash), /Preview and confirm/);
    fs.writeFileSync(f.config, f.originalConfig.replace('https://www.system-bootstrapper.com', 'http://www.system-bootstrapper.com'));
    await assert.rejects(f.promotion.plan(proof), /signature/);
    fs.writeFileSync(f.config, f.originalConfig); fs.mkdirSync(f.lock);
    await assert.rejects(f.apply(), /EEXIST/); assert.equal(f.containers.size, 1);
    assert.equal(hash(f.originalConfig), hash(fs.readFileSync(f.config)));
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
