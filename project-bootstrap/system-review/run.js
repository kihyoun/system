'use strict';
const {stopReview} = require('../../operations/dist/project-lifecycle/system-beta-entry');
module.exports = {...require('../../operations/dist/project-lifecycle/legacy-review-session'), run: stopReview};
if (require.main === module) {
 if (process.argv.length !== 3) {console.error('System Review was retired. Only owned legacy stop is supported.'); process.exitCode = 2;}
 else stopReview(process.argv[2]).catch(error => {console.error(error.message); process.exitCode = 1;});
}
