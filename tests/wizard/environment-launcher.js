'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const logo = require('../../sync/dist/Helper').default.textLogo;
const options = {settings: {review: {enabled: false}, beta: {enabled: false}}, settingsHash: 'a'.repeat(64),
  helperImage: 'sha256:' + 'b'.repeat(64), operation: 'c'.repeat(48), controller: 'system_bootstrapper_1'};
const run = require('../../project-bootstrap/wizard-environments/recipe').generate(logo, options).files[0].content;
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-environment-launcher-'));
try {
  const script = path.join(fixture, 'run.sh'), trace = path.join(fixture, 'trace');
  fs.writeFileSync(script, run);
  fs.writeFileSync(path.join(fixture, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$TRACE"
case "$1 $2" in
  'image inspect') exit 0;;
  'create --name') [ "$MODE" != occupied ] || exit 1; printf '%s\\n' '${'d'.repeat(64)}';;
  'container inspect') printf '%s\\n' '${'d'.repeat(64)} ${options.helperImage} ${options.operation}';;
  'start --attach'|'stop --time'|'rm -f') exit 0;;
  *) exit 2;;
esac
`, {mode: 0o755});
  const environment = {...process.env, PATH: fixture + ':' + process.env.PATH, TRACE: trace,
    CI_PROJECT_ID: '1', CI_JOB_ID: '2', CI_PIPELINE_ID: '3', CI_COMMIT_SHA: 'e'.repeat(40), CI_MERGE_REQUEST_IID: '1'};
  let result = spawnSync('/bin/sh', [script, 'stop', 'review'], {env: {...environment, MODE: 'occupied'}, encoding: 'utf8'});
  assert.notStrictEqual(result.status, 0);
  let calls = fs.readFileSync(trace, 'utf8');
  assert(!calls.includes('stop --time') && !calls.includes('rm -f'), 'failed creation deleted an occupied foreign name');
  fs.writeFileSync(trace, '');
  result = spawnSync('/bin/sh', [script, 'stop', 'review'], {env: {...environment, MODE: 'owned'}, encoding: 'utf8'});
  assert.strictEqual(result.status, 0, result.stderr);
  calls = fs.readFileSync(trace, 'utf8');
  assert(calls.includes('start --attach ' + 'd'.repeat(64)));
  assert(calls.includes('stop --time 120 ' + 'd'.repeat(64)));
  assert(calls.includes('rm -f ' + 'd'.repeat(64)));
  assert(!calls.includes('rm -f wizard-environment-'));
  fs.writeFileSync(script, fs.readFileSync(require.resolve('../../project-bootstrap/wizard-environments/source-primary.sh'), 'utf8'));
  fs.writeFileSync(trace, '');
  const nativeEnvironment = {...environment, MODE: 'owned', SYSTEM_WIZARD_ENVIRONMENT_IMAGE: options.helperImage,
    SYSTEM_WIZARD_ENVIRONMENT_OPERATION: options.operation};
  result = spawnSync('/bin/sh', [script, 'stop', 'review'], {env: nativeEnvironment, encoding: 'utf8'});
  assert.strictEqual(result.status, 0, result.stderr);
  calls = fs.readFileSync(trace, 'utf8');
  assert(calls.includes('--operation ' + options.operation));
  assert(calls.includes('rm -f ' + 'd'.repeat(64)));
  fs.writeFileSync(trace, '');
  result = spawnSync('/bin/sh', [script, 'stop', 'review'], {env: {...nativeEnvironment,
    SYSTEM_WIZARD_ENVIRONMENT_IMAGE: 'latest'}, encoding: 'utf8'});
  assert.notStrictEqual(result.status, 0);
  assert.strictEqual(fs.readFileSync(trace, 'utf8'), '', 'Invalid native helper identity reached Docker');
  console.log('Environment launcher: occupied names remain untouched; cleanup verifies immutable image/task ownership and uses only the created full container ID.');
} finally { fs.rmSync(fixture, {recursive: true, force: true}); }
