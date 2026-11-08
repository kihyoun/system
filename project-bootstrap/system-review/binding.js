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
  if (!value || value.version !== 1 || !environment || environment.phase !== 'ready' ||
      environment.controller !== 'system_bootstrapper_1' || value.operation !== environment.operation ||
      value.environmentHash !== environmentHash(environment) ||
      value.wizardProjectId !== repository.id || value.wizardProjectPath !== repository.path ||
      value.wizardDefaultBranch !== repository.defaultBranch || value.namespaceId !== repository.namespaceId ||
      !['projectId', 'namespaceId', 'mrIid', 'pipelineId', 'candidateJobId', 'wizardProjectId'].every(key => Number.isSafeInteger(value[key]) && value[key] > 0) ||
      value.projectId === value.wizardProjectId || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(value.projectPath || '') ||
      value.projectPath.split('/').some(part => part === '.' || part === '..') ||
      typeof value.defaultBranch !== 'string' || !value.defaultBranch || /[\s\x00-\x1f]/.test(value.defaultBranch) ||
      !['sourceCommit', 'wizardRevision'].every(key => /^[a-f0-9]{40}$/.test(value[key] || '')) ||
      !['helperImage', 'wizardImageId'].every(key => /^sha256:[a-f0-9]{64}$/.test(value[key] || '')) ||
      !/^\S+@sha256:[a-f0-9]{64}$/.test(value.wizardImageRef || ''))
    throw new Error('Explicit System review binding does not match the canonical Wizard reservation.');
  if (request && (request.kind !== 'review' || request.delivery !== 'system' ||
      ['projectId', 'mrIid', 'pipelineId', 'sourceCommit', 'operation'].some(key => request[key] !== value[key])))
    throw new Error('System review job does not match its explicitly authorized candidate.');
  return value;
}
module.exports = {sha, environmentHash, validate};
