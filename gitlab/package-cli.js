'use strict';
const {invoke}=require('./npm-publication-adapter');
const prepare=(root=process.cwd(),env=process.env)=>invoke('prepare',root,env);
module.exports={prepare};
if(require.main===module)prepare().then(value=>console.log('Prepared CLI '+value.name+'@'+value.version+' from '+value.sourceRevision)).catch(()=>{console.error('CLI package preparation refused; verify exact native source and package identity.');process.exitCode=1;});
