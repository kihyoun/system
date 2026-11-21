'use strict';
const assert = require('assert');
const {request} = require('../../dist/modules/project-lifecycle/legacy-review-session');
const {retiredReviewPlan: plan} = require('../../dist/modules/project-lifecycle/legacy-review-session');
assert.throws(() => request('deploy', {}), /retired/);
assert.rejects(() => plan({}, {}), /retired/).catch(error => {console.error(error);process.exitCode=1;});
console.log('Retired System Review refuses new deployment and binding.');
