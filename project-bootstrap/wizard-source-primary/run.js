'use strict';
module.exports = require('../../operations/dist/project-lifecycle/adoption-session');
if (require.main === module) require('../../operations/dist/project-lifecycle/adoption-entry').main(process.argv.slice(2))
 .then(result => console.log(JSON.stringify(result))).catch(error => {console.error(error.message); process.exitCode = 1;});
