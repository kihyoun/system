'use strict';
const assert = require('assert');
const {EventEmitter} = require('events');
const childProcess = require('child_process');
const originalSpawn = childProcess.spawn, originalTimeout = global.setTimeout, originalClear = global.clearTimeout;
let scenario, timeout;
childProcess.spawn = (command, args) => {
  assert.equal(command, 'docker'); assert(args.includes('gitlab-rails'));
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = {resume() {}};
  child.stdin = new EventEmitter(); child.stdin.end = () => {};
  child.kill = () => {queueMicrotask(() => child.emit('close', null)); return true;};
  queueMicrotask(() => {
    if (scenario === 'spawn-error') {child.emit('error', Error('fixture spawn failure')); return;}
    child.emit('spawn');
    if (scenario === 'timeout') timeout();
    else if (scenario === 'transport-loss') child.emit('error', Error('fixture transport lost'));
    else if (scenario === 'client-exit') child.emit('close', 1);
    else if (scenario === 'truncated-json') {child.stdout.emit('data', '{"state":'); child.emit('close', 0);}
    else if (scenario === 'invalid-json-shape') {child.stdout.emit('data', 'null'); child.emit('close', 0);}
    else if (scenario === 'oversized-output') {child.stdout.emit('data', 'x'.repeat(2000001)); child.emit('close', 0);}
    else if (scenario === 'settled-failure') {child.stdout.emit('data', JSON.stringify({state: 'failed', message: 'Settled native refusal.'})); child.emit('close', 0);}
    else throw Error('Unknown fixture scenario');
  });
  return child;
};
global.setTimeout = (callback, milliseconds, ...args) => milliseconds === 240000 ? (timeout = callback, {fixture: true}) : originalTimeout(callback, milliseconds, ...args);
global.clearTimeout = timer => {if (!timer?.fixture) originalClear(timer);};
const {rails, startJob} = require('../../sync/dist/ProjectBootstrap');
(async () => {
  for (scenario of ['timeout', 'transport-loss', 'client-exit', 'truncated-json', 'invalid-json-shape', 'oversized-output']) {
    await assert.rejects(rails({action: 'preview-setup-project'}), error => {
      assert.equal(error.uncertain, true, scenario + ' lost its unconfirmed mutation marker');
      assert.equal(error.action, 'preview-setup-project'); return true;
    });
  }
  scenario = 'spawn-error';
  await assert.rejects(rails({action: 'preview-setup-project'}), error => error.uncertain === false);
  scenario = 'settled-failure';
  assert.equal((await rails({action: 'preview-setup-project'})).state, 'failed');
  scenario = 'timeout';
  await assert.rejects(rails({action: 'preview-setup-read'}), error => error.uncertain === false);
  for (scenario of ['timeout', 'transport-loss', 'oversized-output'])
    await assert.rejects(rails({action: 'preview-setup-read-many'}), error => error.uncertain === false && error.action === 'preview-setup-read-many');
  const job = startJob('nested-uncertainty-fixture', async () => {throw Object.assign(Error('Fixture uncertain mutation.'), {uncertain: true, action: 'wizard-environments-primary'});});
  await new Promise(resolve => originalTimeout(resolve, 0));
  assert.equal(job.state, 'failed'); assert.equal(job.uncertain, true); assert.equal(job.uncertainAction, 'wizard-environments-primary');
  console.log('Rails completion witness: mutation timeout, transport loss, client exit and incomplete JSON retain uncertainty; pre-spawn refusal, read-only timeout and settled native failures stay distinct; nested jobs preserve the marker.');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {childProcess.spawn = originalSpawn; global.setTimeout = originalTimeout; global.clearTimeout = originalClear;});
