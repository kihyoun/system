'use strict';
const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
function ciFiles(input) {
  if (!Array.isArray(input) || !input.length || input.length > 40 ||
      input.some(row => !row || Object.keys(row).sort().join(',') !== 'path,sha256' ||
        typeof row.path !== 'string' || !/^(?:\.gitlab\/|\.system-bootstrapper\/build-v1\/)[A-Za-z0-9_./-]+$/.test(row.path) ||
        row.path.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(row.sha256 || '')) ||
      new Set(input.map(row => row.path)).size !== input.length ||
      !['.gitlab/primary.yml', '.gitlab/delivery/environment.sh'].every(name => input.some(row => row.path === name)))
    throw new Error('Source-primary CI requires an exact approved file manifest.');
  return copy(input);
}
function reservation(value) {
  if (!value || value.version !== 1 || value.managementMode !== 'source-primary' ||
      !/^[a-f0-9]{48}$/.test(value.operation || '') || !/^sha256:[a-f0-9]{64}$/.test(value.helperImage || '') ||
      value.controller !== 'system_bootstrapper_1' || !/^[a-f0-9]{40}$/.test(value.activationCommit || '') ||
      !value.settings || value.settingsHash !== hash(JSON.stringify(value.settings)))
    throw new Error('Invalid source-primary environment reservation.');
  const files = ciFiles(value.ciFiles);
  const manifest = {version: 1, managementMode: 'source-primary', operation: value.operation,
    settingsHash: value.settingsHash, helperImage: value.helperImage, controller: value.controller, ciFiles: files};
  return {...manifest, recipeHash: hash(JSON.stringify(manifest))};
}
function sourcePrimaryEnvironment(previous, options) {
  if (!previous || previous.phase !== 'ready' || previous.operation === options?.operation)
    throw new Error('Adoption requires a ready previous reservation and a new operation.');
  const deployments = {};
  for (const kind of ['review', 'beta']) {
    const slot = previous.deployments?.[kind] || {};
    if (slot.active || slot.pending || slot.retired?.length)
      throw new Error('Stop and reconcile all environments before source-primary adoption.');
    for (const key of ['lastPipelineId', 'stoppedThroughPipelineId']) {
      if (slot[key] !== undefined && (!Number.isSafeInteger(slot[key]) || slot[key] < 0))
        throw new Error('Invalid retained environment generation floor.');
    }
    deployments[kind] = previous.managementMode === 'source-primary' ? copy(slot) : {};
    for (const key of ['lastPipelineId', 'stoppedThroughPipelineId']) {
      if (slot[key] !== undefined) deployments[kind][key] = slot[key];
    }
  }
  const result = {version: 1, managementMode: 'source-primary', phase: 'ready', operation: options.operation,
    settings: copy(previous.settings), settingsHash: previous.settingsHash, helperImage: options.helperImage,
    controller: 'system_bootstrapper_1', activationCommit: options.activationCommit, ciFiles: ciFiles(options.ciFiles),
    deployments, historicalDeployments: [...(previous.historicalDeployments || []),
      {operation: previous.operation, deployments: copy(previous.deployments || {})}]};
  result.recipeHash = reservation(result).recipeHash;
  return result;
}
module.exports = {sourcePrimaryEnvironment, reservation, ciFiles};
