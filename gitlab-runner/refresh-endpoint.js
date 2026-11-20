'use strict';
const {stableEndpoint}=require('../operations/dist/lifecycle/runner.service');
module.exports={stableEndpoint};
if(require.main===module)require('../operations/dist/lifecycle/entry').main(['runner-refresh',require('node:path').resolve(__dirname,'..'),process.argv[2]]).catch(()=>{console.error('Managed runner endpoint refresh failed.');process.exitCode=1;});
