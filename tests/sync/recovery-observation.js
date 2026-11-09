'use strict';
const assert = require('node:assert/strict');
const {recoveryObservation} = require('../../sync/dist/RecoveryObservation');
const id = n => 'sha256:' + n.repeat(64), sha = 'a'.repeat(40), wizard = 'b'.repeat(40);
const row = (name, image, source) => ({Name: '/' + name, State: {Running: true}, Image: image,
  Config: {Image: 'example/' + name + '@' + image, Env: ['SYNC_PASS=must-not-leak'], Labels: {
    'org.opencontainers.image.revision': source, 'org.system-bootstrapper.source-revision': sha,
    secret: 'must-not-leak'}}});
const containers = {system_bootstrapper_1: row('system_bootstrapper_1', id('1'), sha),
  system_wizard_1: row('system_wizard_1', id('2'), wizard),
  runner_docker_1: row('runner_docker_1', id('3'), null)};
const calls = [];
function inspect(args) {
  calls.push(args);
  if (args[1] === 'ls') return 'runner_docker_1\nforeign_container\n';
  if (args[0] === 'container') {
    if (args.slice(2).some(name => !containers[name])) throw Error('not-running');
    return JSON.stringify(args.slice(2).map(name => containers[name]));
  }
  return JSON.stringify(args.slice(2).map(Id => ({Id, RepoDigests: ['example/runtime@' + Id], Config: {Env: ['secret'], Labels: Object.values(containers).find(row => row.Image === Id)?.Config.Labels}})));
}
const receipt = () => ({productRelease: {version: '1.0.0', tag: 'v1.0.0', sourceRevision: sha},
  images: {controller: {imageId: id('1')}, wizard: {imageId: id('2')}}});
const evidence = recoveryObservation(inspect, receipt);
assert.equal(evidence.system.sourceRevision, sha);
assert.equal(evidence.system.release, '1.0.0');
assert.equal(evidence.wizard.sourceRevision, wizard);
assert.equal(evidence.images.gitlab, null);
assert.equal(evidence.images.runner.length, 1);
assert.equal(evidence.images.runner[0].imageId, id('3'));
assert(!JSON.stringify(evidence).includes('must-not-leak'));
assert(calls.length <= 6, 'bounded batch inspection, independent of manager count');
const changed = recoveryObservation(inspect, () => ({...receipt(), images: {controller: {imageId: id('9')}, wizard: {imageId: id('2')}}}));
assert.equal(changed.system.release, null, 'stale accepted selection cannot identify another running controller');
const offline = recoveryObservation(() => { throw Error('daemon-unavailable'); }, receipt);
assert.equal(offline.status, 'unavailable');
assert.equal(offline.system, null);
assert.equal(offline.wizard, null);
assert.deepEqual(offline.images.runner, []);
console.log('PASS authenticated runtime evidence is bounded, secret-free, source accurate and honest when unavailable.');
