'use strict';
const entry = require('../../operations/dist/project-lifecycle/system-beta-entry');
module.exports = {...require('../../operations/dist/project-lifecycle/system-beta-session'), run: entry.run};
if (require.main === module) {
 if (process.argv.length !== 3) {console.error('Use deploy or stop.'); process.exitCode = 2;}
 else entry.run(process.argv[2]).then(result => module.exports.writeEnvironment(result)).catch(error => {console.error(error.message); process.exitCode = 1;});
}
