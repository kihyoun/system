'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-beta-setup-'));
process.env.SYSTEM_CONFIG_DIR = root;
process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE = 'sha256:' + 'f'.repeat(64);
const bootstrap = require('../../sync/dist/ProjectBootstrap');
const logo = require('../../sync/dist/Helper').default.textLogo;
const config = path.join(root, '.projects.env/.wizard.env'), main = path.join(root, '.docker.env');
fs.mkdirSync(path.dirname(config));
const receipt = {defaultProject: true, template: 'wizard', state: 'complete', operation: '1'.repeat(48), namespaceId: 1,
  repository: {id: 1, namespaceId: 1, path: 'team/wizard', defaultBranch: 'master', ciPath: '.system-bootstrapper/ci.yml', systemProject: true},
  wizardWorkflow: {sourceRevision: 'c'.repeat(40), importCommit: 'd'.repeat(40)}};
bootstrap.writeReceipt(config, logo, receipt);
fs.writeFileSync(main, logo + "GITLAB_HOST='gitlab.example.test'\nGITLAB_REGISTRY_URL='https://registry.example.test'\n");
const originalMain = fs.readFileSync(main, 'utf8');
const desired = {version: 2, namespace: 'team', wizard: {mode: 'existing', project: 'system', origin: ''},
  review: {enabled: false, host: '', ssl: '', sslKey: ''}, beta: {enabled: true, host: 'beta.example.test', ssl: '/ssl/beta/cert', sslKey: '/ssl/beta/key'}};
let checks = 0, failTls = false, sourceId = 7;
require('../../sync/dist/WizardEnvironments').preflightWizardEnvironmentSettings = async value => {
  assert.equal(value.review.enabled, false); checks++;
  if (failTls) throw Error('TLS fixture refusal');
  return value;
};
bootstrap.rails = async input => {
  assert.equal(input.action, 'preview-setup-preflight', 'setup must not mutate projects or start a build');
  assert.equal(input.sourceLayout, 'system-monorepo-v1');
  return {namespaceId: 1, projects: [{id: sourceId, path: 'team/system', namespaceId: 1, defaultBranch: 'main', sourceRevision: 'a'.repeat(40)}]};
};
const setup = require('../../sync/dist/PreviewSetup');
const wait = async job => {while (job.state === 'running') await new Promise(resolve => setTimeout(resolve, 5)); return job;};
(async () => {
  try {
    await assert.rejects(() => setup.preflightPreviewSetup({settings: {...desired, version: 1}}), /Explicitly migrate/);
    const before = fs.readFileSync(config, 'utf8');
    const plan = await setup.preflightPreviewSetup({settings: desired});
    assert.equal(fs.readFileSync(config, 'utf8'), before);
    failTls = true; await assert.rejects(() => setup.preflightPreviewSetup({settings: desired}), /TLS/); failTls = false;
    sourceId = 8;
    const stale = await wait(setup.applyPreviewSetup({settings: desired, previewHash: plan.previewHash}));
    assert.equal(stale.state, 'failed'); assert.equal(fs.readFileSync(config, 'utf8'), before); sourceId = 7;
    const result = await wait(setup.applyPreviewSetup({settings: desired, previewHash: plan.previewHash}));
    assert.equal(result.state, 'complete', result.message);
    const current = bootstrap.readReceipt(fs.readFileSync(config, 'utf8'));
    assert.deepEqual(current.repository, receipt.repository);
    assert.equal(current.wizardWorkflow.importCommit, receipt.wizardWorkflow.importCommit);
    assert.equal(current.wizardWorkflow.environments.systemSource.id, 7);
    assert.equal(current.wizardWorkflow.environments.settings.review.enabled, false);
    assert.equal(current.wizardWorkflow.environments.activationCommit, 'a'.repeat(40));
    assert.equal(setup.previewSetupStatus().previewUrl, 'https://beta.example.test');
    assert.equal(fs.readFileSync(main, 'utf8'), originalMain);
    current.wizardWorkflow.environments.deployments.review = {tombstone: {projectId: 1}};
    bootstrap.writeReceipt(config, logo, current);
    await assert.rejects(() => setup.preflightPreviewSetup({settings: desired}), /clean exactly owned/);
    assert(checks >= 4);
    console.log('System Beta setup: no Review host/build, TLS rejection, fresh source binding, inert legacy intent, owned cleanup boundary and preserved repository/history/Production passed.');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
})().catch(error => {console.error(error);process.exitCode=1;});
