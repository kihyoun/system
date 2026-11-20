'use strict';
const {validateNpmPublication:validate}=require('../operations/dist/release');
const {invoke}=require('./npm-publication-adapter');
const publish=(env=process.env,root=process.cwd(),request=fetch)=>invoke('publish',root,env,request);
module.exports={validate,publish};
if(require.main===module)publish().then(value=>console.log('Published '+value.name+'@'+value.version)).catch(()=>{console.error('npm publication refused; verify accepted artifacts and protected publisher credentials.');process.exitCode=1;});
