'use strict';
const {main} = require('../../operations/dist/project-lifecycle/preview-operator-entry');
module.exports = {main};
if (require.main === module) main(process.argv.slice(2)).then(value => console.log(JSON.stringify(value))).catch(error => {console.error(error.message); process.exitCode = 1;});
