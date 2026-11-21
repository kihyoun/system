'use strict';
const assert = require('assert');
const {request} = require('../../dist/modules/project-lifecycle/legacy-review-session');
const env = {CI_PROJECT_ID:'1',CI_PIPELINE_ID:'2',CI_JOB_ID:'3',CI_MERGE_REQUEST_IID:'4',CI_COMMIT_SHA:'a'.repeat(40),SYSTEM_REVIEW_OPERATION:'b'.repeat(48)};
assert.equal(request('stop',env).kind,'review');
assert.throws(() => request('deploy',env),/retired/);
assert.throws(() => request('stop',{...env,CI_MERGE_REQUEST_IID:'0'}));
console.log('Legacy Review Stop retains exact MR/job identity.');
