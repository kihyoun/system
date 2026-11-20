'use strict';
const adapter = require('../../operations/dist/project-lifecycle/canonical-entry');
module.exports = {run: adapter.run};
if (require.main === module) adapter.canonicalStdin();
