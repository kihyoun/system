'use strict';
const crypto = require('crypto');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function environmentHash(environment) {
  const value = {...environment};
  delete value.deployments; delete value.historicalDeployments;
  return sha(JSON.stringify(value));
}
function validate(value, context, request) {
  const environment = context.receipt.wizardWorkflow?.environments;
  const repository = context.receipt.repository;
  if (!value || value.version !== 2 || value.sourceLayout !== 'system-monorepo-v1' || value.mrIid !== 0 || !environment || environment.phase !== 'ready' ||
      !environment.settings?.beta?.enabled || environment.controller !== 'system_bootstrapper_1' || value.operation !== environment.operation ||
      value.environmentHash !== environmentHash(environment) ||
      value.wizardProjectId !== repository.id || value.wizardProjectPath !== repository.path ||
      value.wizardDefaultBranch !== repository.defaultBranch || value.namespaceId !== repository.namespaceId ||
      !['projectId', 'namespaceId', 'pipelineId', 'candidateJobId', 'wizardProjectId'].every(key => Number.isSafeInteger(value[key]) && value[key] > 0) ||
       !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(value.projectPath || '') ||
      value.projectPath.split('/').some(part => part === '.' || part === '..') ||
      typeof value.defaultBranch !== 'string' || !value.defaultBranch || /[\s\x00-\x1f]/.test(value.defaultBranch) ||
      !['sourceCommit', 'wizardSourceTree'].every(key => /^[a-f0-9]{40}$/.test(value[key] || '')) ||
      !['helperImage', 'wizardImageId'].every(key => /^sha256:[a-f0-9]{64}$/.test(value[key] || '')) ||
      !/^\S+@sha256:[a-f0-9]{64}$/.test(value.wizardImageRef || ''))
    throw new Error('Explicit System Beta binding does not match the canonical Wizard reservation.');
  if (request && (request.kind !== 'beta' || request.delivery !== 'system' ||
      ['projectId', 'mrIid', 'pipelineId', 'sourceCommit', 'operation'].some(key => request[key] !== value[key])))
    throw new Error('System Beta job does not match its explicitly authorized candidate.');
  if (environment.managementMode === 'system-monorepo' && (!environment.systemSource ||
      ['id', 'path', 'namespaceId', 'defaultBranch'].some((key, index) => environment.systemSource[key] !== value[['projectId', 'projectPath', 'namespaceId', 'defaultBranch'][index]]))) throw Error('System Beta source differs from its explicitly configured shared project.');
  return value;
}
module.exports = {sha, environmentHash, validate};
