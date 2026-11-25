'use strict';
const assert = require('assert');
const {request} = require('../../dist/modules/project-lifecycle/legacyReviewSession');
const {retiredReviewPlan: plan} = require('../../dist/modules/project-lifecycle/legacyReviewSession');
assert.throws(() => request('deploy', {}), /retired/);
assert.rejects(() => plan({}, {}), /retired/).catch(error => {console.error(error);process.exitCode=1;});
console.log('Retired System Review refuses new deployment and binding.');
