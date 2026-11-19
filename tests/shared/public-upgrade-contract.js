'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {download, prepare, run, preserved} = require('../e2e/public-upgrade');
const edge = require('../../bootstrapper/upgrade-paths.json').transitions[0];
const id = char => 'sha256:' + char.repeat(64);
function fixture() {
  const metadata = {format: 'system-accepted-release-v1', version: edge.from, tag: 'v' + edge.from, platform: 'linux/amd64',
    source: {repository: 'https://github.com/example/system.git', revision: 'a'.repeat(40), tree: 'b'.repeat(40), wizardRevision: 'c'.repeat(40)},
    acceptance: {requiredChecksPassed: true, controllerWizardSameAttempt: true, candidateJobId: 31},
    images: {controller: {reference: 'example/system@' + id('1'), imageId: id('3'), configDigest: id('3')},
      wizard: {reference: 'example/wizard@' + id('2'), imageId: id('4'), configDigest: id('4')}}};
  return metadata;
}
test('previous public fixture is selected explicitly and redirects stay anonymous on approved TLS origins', async () => {
  const metadata = fixture();
  assert.deepEqual(await download('example/system', edge.from, async () => Response.json(metadata)), metadata);
  await assert.rejects(download('example/system', edge.from, async () => new Response(null, {status: 302, headers: {location: 'http://attacker.invalid/file'}})), /redirect/);
  await assert.rejects(download('example/system', edge.from, async () => new Response(null, {status: 404})), /unavailable/);
});
test('image preparation verifies official labels, source/job and exact digests before saving archives', async () => {
  const metadata = fixture(), calls = [];
  let bad = false;
  const execute = (_command, args) => {
    calls.push(args);
    if (args[0] === 'image' && args[1] === 'inspect') {
      const role = args.at(-1).includes('wizard') ? 'wizard' : 'controller';
      const row = metadata.images[role];
      return JSON.stringify([{Id: bad ? id('f') : row.imageId, RepoDigests: [row.reference],
        Config: {Labels: {'org.opencontainers.image.revision': metadata.source[role === 'controller' ? 'revision' : 'wizardRevision'],
          'org.system-bootstrapper.test-job': '31'}}}]);
    }
    return '';
  };
  const result = await prepare('/tmp/public-upgrade-fixture', {SYSTEM_TEST_PUBLIC_RELEASE_REPOSITORY: 'example/system'}, execute, async () => Response.json(metadata));
  assert.equal(result.images.previousController.id, metadata.images.controller.imageId);
  assert.equal(calls.filter(args => args[0] === 'image' && args[1] === 'save').length, 2);
  bad = true;
  await assert.rejects(prepare('/tmp/public-upgrade-fixture', {SYSTEM_TEST_PUBLIC_RELEASE_REPOSITORY: 'example/system'}, execute, async () => Response.json(metadata)), /identity-mismatch/);
});
test('same candidate verifies previous-to-target, rollback and target again, never claims success after a failure', async () => {
  const metadata = fixture(), events = [];
  const files = {'.docker.env': "# fixture\nexport BOOTSTRAPPER_IMAGE='old'\nexport WIZARD_IMAGE='custom'\nKEEP='yes'\n", '.projects.env/.demo.env': 'project-source-preserved\n'};
  let selected = [id('5'), id('6')];
  const candidate = {spec: {restore: {base: '/recovered-data/platform'}, publicUpgrade: {metadata, edge}, images: {candidate: {id: id('5')}, wizard: {id: id('6')}}},
    evidence: {}, stage: async (_name, action) => action(), call: async () => {}, inner: async () => ''};
  const dependencies = {configuration: async () => files, writeConfiguration: async (_candidate, _files, controller, wizard) => { selected = [controller, wizard]; },
    replaceController: async (_candidate, _baseline, controller) => events.push(controller), baseline: {Image: id('5')},
    verify: async () => {}, dataSample: async () => ({sha256: 'a'.repeat(64), sampledProjects: 1}), imageIds: async () => selected};
  await run(candidate, {}, dependencies);
  assert.deepEqual(events, [id('3'), id('5'), id('3'), id('5'), id('5')]);
  assert.equal(candidate.evidence.publicUpgrade.rollbackVerified, true);
  assert.equal(candidate.evidence.publicUpgrade.fromSourceRevision, metadata.source.revision);
  delete candidate.evidence.publicUpgrade;
  dependencies.verify = async () => { throw Error('registry-or-data-failed'); };
  await assert.rejects(run(candidate, {}, dependencies), /registry-or-data-failed/);
  assert.equal(candidate.evidence.publicUpgrade, undefined);
  assert.equal(preserved(files), preserved({...files, '.docker.env': files['.docker.env'].replace("'old'", "'target'")}));
});
