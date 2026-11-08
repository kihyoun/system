'use strict';
// Operator-only selection of one tested candidate. No route or image switch.
const fs = require('fs');
const {Runtime} = require('../wizard-environments/helper');
const {sha, environmentHash, validate} = require('./binding');
async function plan(runtime, input) {
  const context = await runtime.canonical('read');
  const environment = context.receipt.wizardWorkflow.environments;
  if (input.operation !== environment.operation) throw new Error('The selected environment reservation changed.');
  const repository = context.receipt.repository;
  const binding = {version: 1, ...input, operation: environment.operation,
    wizardProjectId: repository.id, wizardProjectPath: repository.path, wizardDefaultBranch: repository.defaultBranch,
    environmentHash: environmentHash(environment)};
  validate(binding, context);
  const slot = environment.deployments?.review || {};
  if (slot.active || slot.pending || slot.retired?.length) throw new Error('Stop and reconcile the active Review before binding another candidate.');
  const image = (await runtime.json(['image', 'inspect', binding.helperImage]))[0];
  if (image.Id !== binding.helperImage || image.Config?.Labels?.['org.opencontainers.image.revision'] !== binding.sourceCommit ||
      image.Config?.Labels?.['org.system-bootstrapper.test-job'] !== String(binding.candidateJobId))
    throw new Error('The selected immutable helper is not the selected System candidate.');
  const result = {binding, configurationHash: context.contentHash, previousBindingHash: context.systemReviewBindingHash};
  return {...result, planHash: sha(JSON.stringify(result))};
}
async function main(args) {
  if (!['plan', 'apply'].includes(args[0]) || args.length !== (args[0] === 'plan' ? 2 : 3)) throw new Error('Use plan INPUT or apply INPUT PLAN_HASH.');
  const stat = fs.lstatSync(args[1]);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size > 10000) throw new Error('A private regular input file is required.');
  const input = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const runtime = new Runtime({operation: input.operation});
  let attempted = false, locked = false;
  try {
    if (args[0] === 'apply') { attempted = true; await runtime.canonical('lock'); locked = true; }
    const selected = await plan(runtime, input);
    if (args[0] === 'plan') return selected;
    if (selected.planHash !== args[2]) throw new Error('System review plan changed; inspect a fresh plan.');
    await runtime.canonical('bind-system-review', {binding: selected.binding, expectedHash: selected.configurationHash,
      previousBindingHash: selected.previousBindingHash});
    return {state: 'bound', projectId: selected.binding.projectId, mrIid: selected.binding.mrIid, pipelineId: selected.binding.pipelineId,
      sourceCommit: selected.binding.sourceCommit};
  } finally {
    if (attempted) { try { await runtime.canonical('unlock', {}, true); } catch (error) { if (locked) throw error; } }
  }
}
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {plan, main};
