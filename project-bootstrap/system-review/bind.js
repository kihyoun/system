'use strict';
async function plan() {throw new Error('System Review was retired. Stop owned legacy resources and select System Beta.');}
module.exports = {plan, main: plan};
if (require.main === module) plan().catch(error => {console.error(error.message); process.exitCode = 1;});
