'use strict';
const assert = require('assert');
const {request} = require('../../project-bootstrap/system-review/run');
const {plan} = require('../../project-bootstrap/system-review/bind');
assert.throws(() => request('deploy', {}), /retired/);
assert.rejects(() => plan({}, {}), /retired/).catch(error => {console.error(error);process.exitCode=1;});
console.log('Retired System Review refuses new deployment and binding.');
