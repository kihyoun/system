'use strict';
// Trusted server-side settings-update maintenance; not a CI job endpoint.
// The only removable routes/resources are canonical stopped receipt entries.
const {Runtime} = require('./helper');
async function cleanupStopped(operation) {
  if (!/^[a-f0-9]{48}$/.test(operation || '')) throw new Error('Invalid environment reservation.');
  const runtime = new Runtime({operation, action: 'stop', kind: 'review', projectId: 1, mrIid: 1,
    pipelineId: 1, jobId: 1, sourceCommit: '0'.repeat(40)});
  runtime.helperName = 'wizard-environment-maintenance-' + runtime.token;
  let attempted = false, locked = false;
  try {
    attempted = true; await runtime.canonical('lock'); locked = true;
    runtime.context = await runtime.canonical('read');
    runtime.environment = runtime.context.receipt.wizardWorkflow.environments;
    if (runtime.environment.operation !== operation) throw new Error('Environment reservation changed.');
    const deployments = runtime.environment.deployments || {};
    if (Object.values(deployments).some(slot => slot.active || slot.pending))
      throw new Error('Stop active and reconcile pending deployments before settings cleanup.');
    for (const kind of ['review', 'beta']) {
      runtime.request.kind = kind;
      await runtime.cleanupStoppedRoute(runtime.environment.deployments?.[kind] || {});
    }
    return {state: 'complete'};
  } finally {
    if (attempted) {
      try { await runtime.canonical('unlock', {}, true); }
      catch (error) { if (locked) throw error; }
    }
  }
}
if (require.main === module) cleanupStopped(process.argv[2]).then(value => console.log(JSON.stringify(value)))
  .catch(error => { console.error(JSON.stringify({state: 'failed', message: error.message})); process.exitCode = 1; });
module.exports = {cleanupStopped};
