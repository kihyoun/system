'use strict';
// Compatibility entry: acceptance and immutable publication live in shared operations.
const {NestFactory}=require('../operations/node_modules/@nestjs/core');
const runtime=require('../operations/dist/release');
const images=require('./publish-dockerhub');
const context=(env,root)=>runtime.githubContext(env,root,images.context);
async function publish(env=process.env,root=process.cwd(),request=fetch){
  const app=await NestFactory.createApplicationContext(runtime.ReleaseModule.registerGithub({request,
    execute:runtime.command,images,upgrade:{evidence:require('./publish-successor'),lifecycle:require('./guided-preview-evidence')}}),{logger:false,abortOnError:false});
  try{return await app.get(runtime.GithubPublicationService).publish(env,root);}
  finally{await app.close();}
}
module.exports={context,token:runtime.publicationToken,api:runtime.publicationApi,gates:runtime.githubGates,
  publicMetadata:runtime.githubPublicMetadata,present:runtime.presentGithubRelease,publish};
if(require.main===module)publish().then(value=>console.log('Public accepted release: '+value.tag)).catch(()=>{
  console.error('Public release refused: verify protected credentials, successful same-attempt gates, public sources and immutable assets.');process.exitCode=1;
});
