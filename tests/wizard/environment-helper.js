'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Runtime, parse} = require('../../project-bootstrap/wizard-environments/helper');
const state = require('../../project-bootstrap/wizard-environments/state');
const op = 'a'.repeat(48), sha = 'b'.repeat(40), digest = 'registry.example.test/root/wizard@sha256:' + 'c'.repeat(64);
const request = (pipelineId = 10, jobId = 20, mrIid = 1, action = 'deploy', kind = 'review') =>
  ({action, kind, projectId: 1, pipelineId, jobId, mrIid, sourceCommit: sha, operation: op});
const setting = {enabled: true, host: 'review.example.test', domainMode: 2,
  ssl: '/ssl/live/reviews/fullchain.pem', sslKey: '/ssl/live/reviews/privkey.pem'};
class Fixture extends Runtime {
  constructor() {
    super(request(), {root: fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-environment-fixture-'))});
    this.context = {contentHash: 'fixture'};
    this.environment = {deployments: {}}; this.setting = setting;
    this.containers = new Map(); this.networks = new Map(); this.events = []; this.reloads = 0; this.saves = 0;
    this.unhealthy = false;
  }
  async save(deployments) {
    this.saves++;
    if (this.saves === this.failSave) throw new Error('simulated CAS conflict');
    this.events.push('save:' + (deployments.review?.active?.generation || '-') + ':' + !!deployments.review?.pending);
    this.environment.deployments = JSON.parse(JSON.stringify(deployments));
  }
  async inspected(name, type = 'container') { return (type === 'network' ? this.networks : this.containers).get(name) || null; }
  async command(args) {
    this.events.push(args[0] + ':' + args.join(' '));
    if (args[0] === 'image') return 'local-image';
    if (args[0] === 'run') {
      const value = this.environment.deployments.review.pending;
      this.containers.set(value.containerName, {labels: state.labels(value), running: true,
        networks: {[value.networkName]: {IPAddress: '172.28.0.2'}}});
      this.networks.get(value.networkName).containers[value.containerName] = {};
      return 'owned-id';
    }
    if (args[0] === 'rm') {
      if (this.failRemove === args[2]) throw new Error('simulated owned cleanup failure');
      this.containers.delete(args[2]);
      for (const network of this.networks.values()) delete network.containers[args[2]];
      return '';
    }
    if (args[0] === 'network' && args[1] === 'create') {
      const value = this.environment.deployments.review.pending;
      const labels = {...state.labels(value)}; delete labels['system.wizard.environments.generation'];
      this.networks.set(value.networkName, {labels, containers: {}}); return '';
    }
    if (args[0] === 'network' && args[1] === 'rm') { this.networks.delete(args[2]); return ''; }
    throw new Error('Unexpected simulated command');
  }
  async health() { return !this.unhealthy; }
  async reload() {
    this.events.push('reload'); this.reloads++;
    if (this.reloads === this.failReload) throw new Error('simulated nginx error');
  }
  slot() { return this.environment.deployments.review || {}; }
  destroy() { fs.rmSync(this.root, {recursive: true, force: true}); }
}
async function rejects(fn, pattern) { await assert.rejects(fn, pattern); }
(async () => {
  const args = ['--action', 'deploy', '--kind', 'review', '--project', '1', '--pipeline', '10', '--job', '20', '--sha', sha,
    '--mr', '1', '--operation', op, '--controller', 'system_bootstrapper_1'];
  assert.deepStrictEqual(parse(args), request());
  assert.throws(() => parse([...args, '--image', digest]));
  assert.throws(() => parse(args.map(value => value === 'system_bootstrapper_1' ? 'test-controller' : value)));
  assert.throws(() => state.validRequest({...request(), mrIid: 0}));
  assert.throws(() => state.route(state.record(request(), setting.host, digest), {...setting, ssl: '/ssl/../private'}, '172.28.0.2'));
  assert.throws(() => state.route(state.record(request(), setting.host, digest), setting, '999.0.0.1'));
  let fixture = new Fixture();
  try {
    await fixture.deploy(fixture.slot(), digest);
    const first = fixture.slot().active;
    const firstRoute = fixture.readFragment('review');
    assert(firstRoute.includes('server_name review.example.test;'));
    assert(firstRoute.includes('location ^~ /.well-known/acme-challenge/'));
    assert(!firstRoute.includes('system-bootstrapper.com'));
    assert.strictEqual(state.hash(firstRoute), first.routeHash);
    assert(fixture.containers.has(first.containerName));
    fixture.request = request(11, 21);
    await fixture.deploy(fixture.slot(), digest);
    const second = fixture.slot().active;
    assert(!fixture.containers.has(first.containerName));
    assert(fixture.containers.has(second.containerName));
    assert(fixture.events.indexOf('save:' + second.generation + ':false') < fixture.events.findIndex(x => x.startsWith('rm:') && x.includes(first.containerName)));
    fixture.request = request(12, 22, 2);
    await rejects(() => fixture.deploy(fixture.slot(), digest), /leased by another/);
    fixture.request = request(10, 23);
    await rejects(() => fixture.deploy(fixture.slot(), digest), /Stale/);
    fixture.request = request(10, 24, 1, 'stop');
    await rejects(() => fixture.stop(fixture.slot()), /Stale stop/);
    fixture.request = request(11, 25, 1, 'stop');
    await fixture.stop(fixture.slot());
    assert(fixture.readFragment('review').includes('return 410;'));
    assert(fixture.readFragment('review').includes('ssl_reject_handshake on;'));
    assert(!fixture.readFragment('review').includes('ssl_certificate'));
    assert.strictEqual(fixture.slot().active, null);
    assert.strictEqual(fixture.slot().stoppedThroughPipelineId, 11);
    assert.strictEqual(fixture.containers.size, 0);
    assert.strictEqual(fixture.networks.size, 0);
    fixture.request = request(11, 26);
    await rejects(() => fixture.deploy(fixture.slot(), digest), /revive/);
    fixture.request = request(12, 27, 2);
    await fixture.deploy(fixture.slot(), digest);
    assert.strictEqual(fixture.slot().active.mrIid, 2);
  } finally { fixture.destroy(); }
  for (const failure of ['unhealthy', 'reload', 'cas']) {
    fixture = new Fixture();
    try {
      await fixture.deploy(fixture.slot(), digest);
      const active = fixture.slot().active, oldRoute = fixture.readFragment('review');
      fixture.request = request(11, 21);
      if (failure === 'unhealthy') fixture.unhealthy = true;
      if (failure === 'reload') fixture.failReload = fixture.reloads + 1;
      if (failure === 'cas') fixture.failSave = fixture.saves + 3;
      await rejects(() => fixture.deploy(fixture.slot(), digest), /healthy|nginx|CAS/);
      assert.strictEqual(fixture.readFragment('review'), oldRoute, failure);
      assert.strictEqual(fixture.slot().active.containerName, active.containerName, failure);
      assert.strictEqual(fixture.slot().pending, null, failure);
      assert(fixture.containers.has(active.containerName), failure);
      assert.strictEqual(fixture.containers.size, 1, failure);
    } finally { fixture.destroy(); }
  }
  fixture = new Fixture();
  try {
    await fixture.deploy(fixture.slot(), digest);
    const active = fixture.slot().active;
    fixture.request = request(11, 21); fixture.failRemove = active.containerName;
    await rejects(() => fixture.deploy(fixture.slot(), digest), /Candidate is active/);
    assert.strictEqual(fixture.slot().active.pipelineId, 11);
    assert(fixture.readFragment('review').includes(':p11-j21'));
    assert.strictEqual(fixture.slot().retired[0].containerName, active.containerName);
    fixture.failRemove = null;
    await fixture.cleanupRetired(fixture.slot());
    assert.strictEqual(fixture.containers.size, 1);
    fixture.writeFragment('review', fixture.readFragment('review') + '# human edit\n');
    fixture.request = request(12, 22);
    await rejects(() => fixture.deploy(fixture.slot(), digest), /not owned/);
  } finally { fixture.destroy(); }
  fixture = new Fixture();
  try {
    const pending = state.record(request(), setting.host, digest);
    const rendered = state.route(pending, setting, '172.28.0.2'); pending.routeHash = state.hash(rendered);
    fixture.containers.set(pending.containerName, {labels: state.labels(pending), running: true});
    fixture.environment.deployments.review = {pending, lastPipelineId: 10};
    fixture.writeFragment('review', rendered);
    await fixture.reconcile(fixture.slot());
    assert.strictEqual(fixture.slot().active.pipelineId, 10);
    assert.strictEqual(fixture.slot().pending, null);
    fixture.request = request(10, 30, 1, 'stop'); fixture.failSave = fixture.saves + 1;
    await rejects(() => fixture.stop(fixture.slot()), /previous route restored/);
    assert.strictEqual(fixture.readFragment('review'), rendered);
    assert(fixture.containers.has(pending.containerName));
  } finally { fixture.destroy(); }
  fixture = new Fixture();
  try {
    await fixture.deploy(fixture.slot(), digest);
    const active = fixture.slot().active;
    fixture.containers.get(active.containerName).networks[active.networkName].IPAddress = '172.28.0.9';
    fixture.request = request(10, 21);
    const result = await fixture.deploy(fixture.slot(), digest);
    assert.strictEqual(result.reconciled, true);
    assert(fixture.readFragment('review').includes('http://172.28.0.9:80'));
    assert.strictEqual(fixture.slot().active.routeHash, state.hash(fixture.readFragment('review')));
    assert.strictEqual(fixture.containers.size, 1);
    const pending = {...fixture.slot().active, pipelineId: 12, jobId: 30};
    const before = JSON.stringify(fixture.slot());
    assert.throws(() => state.recoveryAllowed({...fixture.slot(), pending}, request(10, 31)), /Stale/);
    assert.throws(() => state.recoveryAllowed({...fixture.slot(), pending: {...pending, mrIid: 2}}, request(13, 32)), /another/);
    assert.strictEqual(JSON.stringify(fixture.slot()), before);
  } finally { fixture.destroy(); }
  const cancelled = new Runtime(request());
  cancelled.owned = async () => ({running: true});
  cancelled.command = async () => { cancelled.cancel(); throw new Error('cancelled CLI'); };
  const began = Date.now();
  await rejects(() => cancelled.health(state.record(request(), setting.host, digest)), /cancelled/);
  assert(Date.now() - began < 500, 'health swallowed cancellation and slept');
  const uncertain = new Runtime(request()); let acquired = false, released = false;
  uncertain.canonical = async action => {
    if (action === 'lock') { acquired = true; throw new Error('lost lock response'); }
    if (action === 'unlock') { acquired = false; released = true; return {ok: true}; }
    throw new Error('unexpected canonical action');
  };
  await rejects(() => uncertain.run(), /lost lock response/);
  assert(!acquired && released, 'uncertain acquisition skipped token-owned release');
  fixture = new Fixture();
  try {
    await fixture.deploy(fixture.slot(), digest);
    const old = fixture.slot().active;
    fixture.failRemove = old.containerName;
    fixture.request = request(10, 21, 1, 'stop');
    await rejects(() => fixture.stop(fixture.slot()), /cleanup failure/);
    assert(fixture.containers.has(old.containerName));
    assert.strictEqual(fixture.slot().active, null);
    fixture.failRemove = null;
    fixture.request = {...request(11, 22), operation: 'd'.repeat(48)};
    await fixture.deploy(fixture.slot(), digest);
    assert(!fixture.containers.has(old.containerName));
    assert.strictEqual(fixture.slot().active.operation, 'd'.repeat(48));
    assert.strictEqual(fixture.slot().tombstone, null);
    assert.strictEqual(fixture.networks.get(fixture.slot().active.networkName).labels['system.wizard.environments.operation'], 'd'.repeat(48));
  } finally { fixture.destroy(); }
  fixture = new Fixture();
  try {
    const pending = state.record(request(12, 30, 2), setting.host, digest);
    fixture.environment = {operation: op, phase: 'ready', activationCommit: sha, helperImage: 'sha256:' + 'f'.repeat(64),
      settings: {review: setting, beta: {...setting, enabled: false}}, deployments: {review: {pending, lastPipelineId: 12}}};
    const inspection = fixture.inspected.bind(fixture);
    fixture.inspected = async (name, ...args) => name === fixture.helperName ? {image: fixture.environment.helperImage,
      labels: {'system.wizard.environments.helper': op}} : inspection(name, ...args);
    fixture.canonical = async action => action === 'read' ? {receipt: {repository: {id: 1}, wizardWorkflow: {environments: fixture.environment}}, publicSettings: {}} : {ok: true};
    fixture.verify = async () => ({ok: true, imageRef: digest});
    fixture.readiness = async () => { throw new Error('Stop must skip DNS/TLS readiness'); };
    fixture.request = request(10, 20, 1, 'stop');
    await rejects(() => fixture.run(), /Pending deployment/);
    assert.strictEqual(fixture.events.length, 0, 'stale Stop mutated newer pending resources');
    fixture.request = request(13, 31, 1, 'deploy');
    fixture.readiness = async () => undefined;
    await rejects(() => fixture.run(), /another job/);
    assert.strictEqual(fixture.events.length, 0, 'other-MR deploy mutated pending resources');
  } finally { fixture.destroy(); }
  console.log('Environment helper: singleton MR lease, stale jobs/stops, owned resources, health gates, CAS/reload rollback, tombstones and interrupted cutover recovery passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
