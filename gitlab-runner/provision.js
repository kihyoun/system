'use strict';
const {withRunnerToken}=require('../operations/dist/lifecycle/runner.service');
module.exports={withToken:withRunnerToken};
if(require.main===module)require('../operations/dist/lifecycle/entry').main(['runner-provision',require('node:path').resolve(__dirname,'..')]).catch(()=>{console.error('Runner provisioning failed; verify readiness and configuration ownership.');process.exitCode=1;});
