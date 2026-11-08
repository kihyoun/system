'use strict';
const assert = require('assert');
const {environmentHash, validate, sha} = require('../../project-bootstrap/system-review/binding');
const {plan} = require('../../project-bootstrap/system-review/bind');
const {request} = require('../../project-bootstrap/system-review/run');
const {parse} = require('../../project-bootstrap/wizard-environments/helper');
const state = require('../../project-bootstrap/wizard-environments/state');
const copy = value => JSON.parse(JSON.stringify(value));
const operation = 'a'.repeat(48), sourceCommit = 'b'.repeat(40), wizardRevision = 'c'.repeat(40);
const environment = {version: 1, phase: 'ready', managementMode: 'source-primary', operation,
  helperImage: 'sha256:' + 'd'.repeat(64), controller: 'system_bootstrapper_1', settings: {review: {enabled: true}},
  deployments: {review: {lastPipelineId: 3}}, historicalDeployments: [{operation: 'old'}]};
const context = {receipt: {repository: {id: 5, namespaceId: 6, path: 'example/wizard', defaultBranch: 'master'},
  wizardWorkflow: {environments: environment}}, contentHash: 'configuration-hash', systemReviewBindingHash: sha('')};
const input = {operation, projectId: 4, projectPath: 'example/system', namespaceId: 6, defaultBranch: 'master', mrIid: 19,
  pipelineId: 140, sourceCommit, candidateJobId: 806, helperImage: 'sha256:' + 'e'.repeat(64),
  wizardImageId: 'sha256:' + 'f'.repeat(64), wizardImageRef: 'registry.example.test/example/system/successor-wizard@sha256:' + '1'.repeat(64), wizardRevision};
const binding = {version: 1, ...input, wizardProjectId: 5, wizardProjectPath: 'example/wizard', wizardDefaultBranch: 'master',
  environmentHash: environmentHash(environment)};
const env = {CI_PROJECT_ID: '4', CI_PIPELINE_ID: '140', CI_JOB_ID: '808', CI_MERGE_REQUEST_IID: '19', CI_COMMIT_SHA: sourceCommit,
  SYSTEM_REVIEW_OPERATION: operation};
(async () => {
  const selected = request('deploy', env);
  assert.equal(selected.delivery, 'system'); assert.equal(validate(binding, context, selected), binding);
  for (const [key, value] of Object.entries({projectId: 5, mrIid: 20, pipelineId: 141, sourceCommit: '0'.repeat(40), delivery: undefined, kind: 'beta'}))
    assert.throws(() => validate(binding, context, {...selected, [key]: value}));
  for (const [key, value] of Object.entries({helperImage: 'latest', wizardRevision: '../master', projectPath: '../system', namespaceId: 7, wizardProjectId: 4}))
    assert.throws(() => validate({...binding, [key]: value}, context));
  const changed = copy(environment); changed.deployments.review.active = {generation: 'new'}; changed.historicalDeployments.push({old: true});
  assert.equal(environmentHash(changed), binding.environmentHash, 'Mutable lease data cannot invalidate the retained Stop binding.');
  changed.settings.review.enabled = false; assert.notEqual(environmentHash(changed), binding.environmentHash);
  const args = ['--action', 'deploy', '--kind', 'review', '--project', '4', '--pipeline', '140', '--job', '808', '--sha', sourceCommit,
    '--mr', '19', '--operation', operation, '--controller', 'system_bootstrapper_1', '--delivery', 'system'];
  assert.deepEqual(parse(args), selected); assert.throws(() => parse(args.map(v => v === 'review' ? 'beta' : v)));
  assert.throws(() => parse([...args, '--extra', 'value']));
  const image = {Id: input.helperImage, Config: {Labels: {'org.opencontainers.image.revision': sourceCommit, 'org.system-bootstrapper.test-job': '806'}}};
  const fixture = {canonical: async action => {assert.equal(action, 'read'); return copy(context);},
    json: async args => {assert.deepEqual(args, ['image', 'inspect', input.helperImage]); return [copy(image)];}};
  const planned = await plan(fixture, input);
  assert.deepEqual(planned.binding, binding); assert.equal(planned.configurationHash, context.contentHash);
  assert.equal(planned.planHash, (await plan(fixture, input)).planHash);
  const prior = context.contentHash; context.contentHash = 'raced'; assert.notEqual(planned.planHash, (await plan(fixture, input)).planHash); context.contentHash = prior;
  environment.deployments.review.active = {projectId: 5}; await assert.rejects(() => plan(fixture, input), /Stop and reconcile/);
  delete environment.deployments.review.active;
  image.Config.Labels['org.system-bootstrapper.test-job'] = 'wrong'; await assert.rejects(() => plan(fixture, input), /selected System candidate/);
  const active = state.record(selected, 'review.example.test', binding.wizardImageRef);
  assert.throws(() => state.deployPlan({active}, {...active, projectId: 5, pipelineId: 141}), /another project/);
  assert.throws(() => state.stopPlan({active}, {...selected, projectId: 5, action: 'stop'}), /another generation/);
  assert.equal(state.stopPlan({active}, {...selected, action: 'stop'}).slot.tombstone.delivery, 'system');
  console.log('System Review binding: exact candidate/job ownership, stable Stop identity, reservation races and native/System lease separation passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
