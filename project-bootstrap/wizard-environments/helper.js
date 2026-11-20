'use strict';
module.exports = require('../../operations/dist/project-lifecycle/environment-runtime');
if (require.main === module) {
 try {
  const request = module.exports.parse(process.argv.slice(2));
  require('../../operations/dist/project-lifecycle/environment-entry').environmentMain(request)
   .then(result => console.log(JSON.stringify(result)))
   .catch(error => { console.error(JSON.stringify({state: 'failed', message: error.message})); process.exitCode = 1; });
 } catch (_) {console.error('Invalid managed environment invocation.'); process.exitCode = 2;}
}
