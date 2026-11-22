'use strict';
const assert = require('assert');
const {EventEmitter} = require('events');
const childProcess = require('child_process');
const originalExecFile = childProcess.execFile, originalTimeout = global.setTimeout;
let scenario;
childProcess.execFile = (command, args, options, callback) => {
  assert.equal(command, process.execPath); assert(args[0].endsWith('/dist/cli/main.js')); assert.deepEqual(args.slice(1,3), ['gitlab-provision','preview']);
  assert.equal(options.timeout, 240000); assert.equal(options.maxBuffer, 2 * 1024 * 1024);
  const child = new EventEmitter();
  child.stdin = new EventEmitter(); child.stdin.end = text => {assert(JSON.parse(text).action.startsWith('preview-setup-'));};
  queueMicrotask(() => {
    if (scenario === 'spawn-error') {callback(Error('fixture spawn failure'), ''); return;}
    child.emit('spawn');
    if (['timeout','transport-loss','client-exit','oversized-output'].includes(scenario)) callback(Error('fixture private transport diagnostic'), '');
    else if (scenario === 'truncated-json') callback(null, '{"state":');
    else if (scenario === 'invalid-json-shape') callback(null, 'null');
    else if (scenario === 'settled-failure') callback(null, JSON.stringify({state:'failed',message:'Settled native refusal.'}));
    else throw Error('Unknown fixture scenario');
  });
  return child;
};
const {rails, startJob} = require('../../dist/modules/project-workflow/projectWorkflow');
(async () => {
  for (const action of ['preview-setup-project', 'preview-setup-revoke'])
   for (scenario of ['timeout', 'transport-loss', 'client-exit', 'truncated-json', 'invalid-json-shape', 'oversized-output']) {
    await assert.rejects(rails({action}), error => {
      assert.equal(error.uncertain, true, scenario + ' lost its unconfirmed mutation marker');
      assert.equal(error.action, action); return true;
    });
  }
  scenario = 'spawn-error';
  await assert.rejects(rails({action: 'preview-setup-project'}), error => error.uncertain === false);
  scenario = 'settled-failure';
  assert.equal((await rails({action: 'preview-setup-project'})).state, 'failed');
  scenario = 'timeout';
  await assert.rejects(rails({action: 'preview-setup-read'}), error => error.uncertain === false);
  for (const action of ['preview-setup-read-many', 'preview-setup-source-context', 'preview-setup-source-evidence', 'preview-setup-adoption-evidence'])
    for (scenario of ['timeout', 'transport-loss', 'oversized-output'])
      await assert.rejects(rails({action}), error => error.uncertain === false && error.action === action);
  const job = startJob('nested-uncertainty-fixture', async () => {throw Object.assign(Error('Fixture uncertain mutation.'), {uncertain: true, action: 'wizard-environments-primary'});});
  await new Promise(resolve => originalTimeout(resolve, 0));
  assert.equal(job.state, 'failed'); assert.equal(job.uncertain, true); assert.equal(job.uncertainAction, 'wizard-environments-primary');
  console.log('Native preview completion witness: mutation timeout, transport loss, client exit and incomplete JSON retain uncertainty; pre-spawn refusal, read-only timeout and settled native failures stay distinct; nested jobs preserve the marker.');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {childProcess.execFile = originalExecFile;});
