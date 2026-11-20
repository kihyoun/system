'use strict';
module.exports = require('../../operations/dist/project-lifecycle/upgrade-session');
if (require.main === module) {
 require('../../operations/dist/project-lifecycle/upgrade-entry').upgradeMain(process.argv.slice(2))
  .then(result => console.log(JSON.stringify(result)))
  .catch(() => { console.error('Managed Wizard upgrade failed. Inspect the private checkpoint and reviewed preconditions; uncertain writes are never blindly repeated.'); process.exitCode = 1; });
}
