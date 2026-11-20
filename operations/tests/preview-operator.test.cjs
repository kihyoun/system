'use strict';
require('reflect-metadata');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {NestFactory} = require('@nestjs/core');
const {PreviewOperatorModule} = require('../dist/project-lifecycle/preview-operator.module');
const {PreviewOperatorService} = require('../dist/project-lifecycle/preview-operator.service');
test('operator delegates to shared setup, rejects unsafe files and observes terminal job failure', async () => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-operator-'));
 const filename = path.join(directory, 'settings.json');
 fs.writeFileSync(filename, '{"version":2}', {mode: 0o600});
 const calls = [], job = {state: 'running'};
 const app = await NestFactory.createApplicationContext(PreviewOperatorModule.register({
  previewSetupStatus() {return {ready: true};},
  preflightPreviewSetup(input) {calls.push(input); return {hash: 'exact'};},
  applyPreviewSetup(input) {calls.push(input); setImmediate(() => {job.state = 'failed'; job.message = 'owned cleanup required';}); return job;},
 }), {logger: false});
 try {
  const service = app.get(PreviewOperatorService);
  assert.deepEqual(await service.run(['status']), {ready: true});
  assert.deepEqual(await service.run(['preflight', filename]), {hash: 'exact'});
  await assert.rejects(service.run(['apply', filename, 'exact']), /owned cleanup required/);
  assert.deepEqual(calls, [{settings: {version: 2}}, {settings: {version: 2}, previewHash: 'exact'}]);
  fs.chmodSync(filename, 0o644);
  await assert.rejects(service.run(['preflight', filename]), /private regular/);
  fs.chmodSync(filename, 0o600); fs.symlinkSync(filename, path.join(directory, 'link'));
  await assert.rejects(service.run(['preflight', path.join(directory, 'link')]), /private regular/);
  assert.equal(calls.length, 2);
 } finally {await app.close(); fs.rmSync(directory, {recursive: true, force: true});}
});
