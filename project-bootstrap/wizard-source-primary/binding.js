'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const digest = value => /^[a-f0-9]{64}$/.test(value || '');
const PREFIX = '# BOOTSTRAPPER_PROJECT=';
const CI = '.gitlab/primary.yml';
function primary(receipt) { return receipt?.repository?.managementMode === 'source-primary'; }
function read(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (text[807] !== '$' || crypto.createHash('md5').update(text.slice(0, 1184)).digest('hex') !== 'bd4a8426355824593a5e21ad759830c1') throw Error('Wizard configuration signature changed.');
  const rows = text.split('\n').filter(line => line.startsWith(PREFIX));
  if (rows.length !== 1) throw Error('Expected one canonical Wizard receipt.');
  const receipt = JSON.parse(Buffer.from(rows[0].slice(PREFIX.length), 'base64').toString());
  if (receipt.defaultProject !== true || receipt.template !== 'wizard' || receipt.state !== 'complete' || receipt.repository?.systemProject !== true) throw Error('Managed Wizard ownership changed.');
  return {text, receipt};
}
function validate(receipt) {
  const r = receipt?.repository, p = receipt?.sourcePrimary;
  if (!primary(receipt) || r.ciPath !== CI || !Number.isSafeInteger(r.id) || r.id < 1 ||
      !Number.isSafeInteger(receipt.namespaceId) || receipt.namespaceId !== r.namespaceId ||
      !/^[A-Za-z0-9_./-]+$/.test(r.path || '') || !/^[A-Za-z0-9_./-]+$/.test(r.defaultBranch || '') ||
      p?.version !== 1 || !/^[a-f0-9]{48}$/.test(p.operation || '') || !sha(p.adoptionCommit) ||
      !Array.isArray(p.ciFiles) || !p.ciFiles.some(file => file.path === CI) ||
      new Set(p.ciFiles.map(file => file.path)).size !== p.ciFiles.length ||
      p.ciFiles.some(file => !/^(?:\.gitlab|\.system-bootstrapper)\/[A-Za-z0-9_./-]+$/.test(file.path || '') || file.path.split('/').includes('..') || !digest(file.sha256))) throw Error('Invalid source-primary Wizard binding.');
  return receipt;
}
function pipelineChecks(pipeline, jobs) {
  if (!['created', 'pending', 'running', 'success', 'failed', 'canceled', 'manual', 'scheduled', 'waiting_for_resource', 'preparing'].includes(pipeline.status) || !Array.isArray(jobs)) throw Error('Native Wizard pipeline state is invalid.');
  for (const name of ['build:source', 'test:browser', 'build:wizard', 'test:wizard']) {
    const found = jobs.filter(job => job.name === name);
    if (found.length !== 1 || found[0].status !== 'success' || found[0].allow_failure !== false ||
        found[0].commit?.id !== pipeline.sha || found[0].pipeline?.id !== pipeline.id) throw Error('All required native source and delivery checks must succeed.');
  }
  const publishers = jobs.filter(job => job.name === 'deploy:github');
  const publisher = publishers[0];
  if (publishers.length > 1 || publisher && (publisher.allow_failure !== false || publisher.commit?.id !== pipeline.sha || publisher.pipeline?.id !== pipeline.id)) throw Error('Public mirror job identity changed.');
  const failures = jobs.filter(job => job.allow_failure === false && job.name !== 'deploy:github' && job.status !== 'success');
  if (failures.length || pipeline.status !== 'success' && (!publisher || publisher.status === 'success')) throw Error('Native Wizard pipeline failed outside the optional public mirror.');
  return {mirrorFailed: publisher?.status === 'failed', status: publisher?.status || 'absent'};
}
async function evidence(get, receipt, pipelineId, sourceCommit, expectedImage) {
  validate(receipt);
  const r = receipt.repository, prefix = 'projects/' + r.id + '/';
  const project = await get(prefix.slice(0, -1));
  if (project.id !== r.id || project.path_with_namespace !== r.path || project.namespace?.id !== receipt.namespaceId ||
      project.default_branch !== r.defaultBranch || project.visibility !== 'private' || project.ci_config_path !== CI ||
      project.only_allow_merge_if_pipeline_succeeds !== true || project.only_allow_merge_if_all_discussions_are_resolved !== true) throw Error('Canonical source-primary project identity or merge gates changed.');
  const pipeline = await get(prefix + 'pipelines/' + pipelineId);
  if (pipeline.id !== pipelineId || pipeline.sha !== sourceCommit ||
      pipeline.ref !== r.defaultBranch || pipeline.source !== 'push' || pipeline.yaml_errors) throw Error('Require the exact successful native default-branch push pipeline.');
  for (const file of receipt.sourcePrimary.ciFiles) {
    const row = await get(prefix + 'repository/files/' + encodeURIComponent(file.path) + '?ref=' + sourceCommit);
    if (hash(Buffer.from(row.content.replace(/\n/g, ''), 'base64')) !== file.sha256) throw Error('Approved native Wizard CI changed.');
  }
  const jobs = await get(prefix + 'pipelines/' + pipelineId + '/jobs?per_page=100&include_retried=false');
  const publishing = pipelineChecks(pipeline, jobs);
  const artifacts = [];
  for (const [name, file] of [['build:wizard', 'build-evidence.json'], ['test:wizard', 'wizard-evidence.json']]) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1) throw Error('Expected one required native Wizard job.');
    const job = matches[0];
    if (job.status !== 'success' || job.allow_failure !== false || job.commit?.id !== sourceCommit || job.pipeline?.id !== pipelineId) throw Error('Native Wizard checks are not successful and required.');
    const artifact = await get(prefix + 'jobs/' + job.id + '/artifacts/' + file);
    if (artifact.version !== 1 || artifact.pipelineId !== pipelineId || artifact.sourceCommit !== sourceCommit ||
        artifact.imageRef !== expectedImage) throw Error('Native Wizard evidence identity changed.');
    artifacts.push(artifact);
  }
  const [build, smoke] = artifacts;
  if (!['unitTests', 'lint', 'typecheck', 'productionBuild'].every(key => build[key] === true) || build.testRunner !== 'vitest' ||
      !['http', 'renderedUI', 'projects', 'spa', 'configurationBackup', 'cubeSignature'].every(key => smoke[key] === true)) throw Error('Native Wizard evidence is incomplete.');
  return {project, pipeline, build, smoke, publishing};
}
function environment(file) { return path.join(path.dirname(path.dirname(file)), '.docker.env'); }
module.exports = {CI, PREFIX, hash, sha, primary, read, validate, evidence, pipelineChecks, environment};
