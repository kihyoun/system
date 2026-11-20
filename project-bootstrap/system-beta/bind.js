'use strict';
const {main} = require('../../operations/dist/project-lifecycle/system-beta-entry');
module.exports = {main, plan: require('../../operations/dist/project-lifecycle/system-beta-plan').plan};
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {console.error(error.message); process.exitCode = 1;});
