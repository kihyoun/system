'use strict';
const {cleanupStopped} = require('../../operations/dist/project-lifecycle/environment-entry');
module.exports = {cleanupStopped};
if (require.main === module) cleanupStopped(process.argv[2]).then(value => console.log(JSON.stringify(value)))
 .catch(error => {console.error(JSON.stringify({state: 'failed', message: error.message})); process.exitCode = 1;});
