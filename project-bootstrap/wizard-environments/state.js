'use strict';
const crypto = require('crypto');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function validRequest(request) {
  if (!['deploy', 'stop'].includes(request.action) || !['review', 'beta'].includes(request.kind) ||
      !['projectId', 'pipelineId', 'jobId'].every(key => Number.isSafeInteger(request[key]) && request[key] > 0) ||
      !/^[a-f0-9]{40}$/.test(request.sourceCommit || '') || !/^[a-f0-9]{48}$/.test(request.operation || '') ||
      (request.kind === 'review' && (!Number.isSafeInteger(request.mrIid) || request.mrIid <= 0)) ||
      (request.kind === 'beta' && request.mrIid !== 0)) throw new Error('Invalid environment job identity.');
  return request;
}
function record(request, host, imageRef) {
  validRequest(request);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(host) || !/^.+@sha256:[a-f0-9]{64}$/.test(imageRef))
    throw new Error('Invalid environment artifact or host.');
  const identity = 'p' + request.projectId + (request.kind === 'review' ? '-mr' + request.mrIid : '-beta');
  const generation = 'p' + request.pipelineId + '-j' + request.jobId;
  return {...request, host, imageRef, generation, state: 'pending',
    containerName: 'wizard-env-' + identity + '-' + generation,
    networkName: 'wizard-env-' + identity,
    environment: request.kind === 'review' ? 'review/' + request.projectId + '/mr-' + request.mrIid : 'beta'};
}
function sameGeneration(a, b) {
  return !!a && !!b && a.projectId === b.projectId && a.pipelineId === b.pipelineId && a.jobId === b.jobId &&
    a.sourceCommit === b.sourceCommit && a.mrIid === b.mrIid && a.operation === b.operation;
}
function before(a, b) { return a.pipelineId < b.pipelineId || (a.pipelineId === b.pipelineId && a.jobId < b.jobId); }
function deployPlan(slot = {}, next) {
  const occupied = slot.pending || slot.active;
  if (occupied && occupied.projectId !== next.projectId) throw new Error('Environment host belongs to another project.');
  if (occupied && next.kind === 'review' && occupied.mrIid !== next.mrIid)
    throw new Error('Review host is leased by another merge request. Stop that review first.');
  if ((slot.lastPipelineId || 0) > next.pipelineId || (slot.stoppedThroughPipelineId || 0) >= next.pipelineId)
    throw new Error('Stale deployment cannot replace or revive a newer generation.');
  if (slot.active && before(next, slot.active)) throw new Error('Stale deployment job.');
  if (slot.pending && !sameGeneration(slot.pending, next)) throw new Error('Pending deployment requires reconciliation.');
  if (slot.active && slot.active.pipelineId === next.pipelineId && slot.active.sourceCommit === next.sourceCommit &&
      slot.active.imageRef === next.imageRef) return {noop: true, slot};
  return {noop: false, slot: {...slot, pending: next, lastPipelineId: Math.max(slot.lastPipelineId || 0, next.pipelineId)}};
}
function stopPlan(slot = {}, request) {
  validRequest(request);
  if (slot.pending) throw new Error('Pending deployment requires reconciliation before stop.');
  if (!slot.active) {
    const stopped = slot.tombstone;
    if (stopped && (stopped.projectId !== request.projectId || stopped.mrIid !== request.mrIid || stopped.pipelineId !== request.pipelineId ||
        stopped.sourceCommit !== request.sourceCommit || stopped.operation !== request.operation)) throw new Error('Stale stop cannot clean another tombstone.');
    return {noop: true, slot};
  }
  const active = slot.active;
  if (active.projectId !== request.projectId || active.mrIid !== request.mrIid || active.pipelineId !== request.pipelineId ||
      active.sourceCommit !== request.sourceCommit || active.operation !== request.operation)
    throw new Error('Stale stop cannot remove another generation.');
  return {noop: false, active, slot: {...slot, active: null, tombstone: {...active, state: 'stopped'},
    stoppedThroughPipelineId: Math.max(slot.stoppedThroughPipelineId || 0, active.pipelineId)}};
}
function recoveryAllowed(slot, request) {
  validRequest(request);
  for (const value of [slot.active, slot.pending].filter(Boolean)) {
    if (value.projectId !== request.projectId || value.mrIid !== request.mrIid || value.operation !== request.operation)
      throw new Error('Environment lease belongs to another job or merge request.');
    if (before(request, value) || (request.pipelineId === value.pipelineId && request.sourceCommit !== value.sourceCommit))
      throw new Error('Stale job cannot reconcile a newer generation.');
  }
  if ((slot.lastPipelineId || 0) > request.pipelineId || (slot.stoppedThroughPipelineId || 0) >= request.pipelineId)
    throw new Error('Stale job cannot reconcile or revive another generation.');
}
function marker(value) { return '# system-wizard-environments:' + value.operation + ':' + value.kind + ':' + value.generation + (value.state === 'stopped' ? ':stopped' : ''); }
function route(value, setting, address) {
  if (value.state === 'stopped') {
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(setting.host || '') || value.host !== setting.host) throw new Error('Invalid stopped candidate route.');
    return `${marker(value)}
server {
    listen 80;
    server_name ${setting.host};
    location ^~ /.well-known/acme-challenge/ { root /ssl/acme-http01; default_type text/plain; }
    location / { return 410; }
}
server {
    listen 443 ssl;
    server_name ${setting.host};
    ssl_reject_handshake on;
}
`;
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) || address.split('.').some(n => +n > 255) ||
      !/^[a-z0-9][a-z0-9.-]*$/.test(setting.host || '') || value.host !== setting.host ||
      ![setting.ssl, setting.sslKey].every(p => /^\/ssl\/[A-Za-z0-9_./-]+$/.test(p || '') && !p.includes('..')))
    throw new Error('Invalid candidate route.');
  return `${marker(value)}
server {
    listen 80;
    server_name ${setting.host};
    location ^~ /.well-known/acme-challenge/ { root /ssl/acme-http01; default_type text/plain; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    server_name ${setting.host};
    ssl_certificate ${setting.ssl};
    ssl_certificate_key ${setting.sslKey};
    server_tokens off;
    location / {
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_pass http://${address}:80;
    }
}
`;
}
function labels(value) {
  return {'system.wizard.environments.operation': value.operation,
    'system.wizard.environments.project': String(value.projectId), 'system.wizard.environments.kind': value.kind,
    'system.wizard.environments.mr': String(value.mrIid), 'system.wizard.environments.generation': value.generation};
}
module.exports = {hash, validRequest, record, sameGeneration, deployPlan, stopPlan, recoveryAllowed, marker, route, labels};
