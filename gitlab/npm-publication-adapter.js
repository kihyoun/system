'use strict';
const {NestFactory}=require('../operations/node_modules/@nestjs/core');
const {ReleaseModule,NpmPublicationService}=require('../operations/dist/release');
const {nativeProcess}=require('../operations/dist/runtime/process');
const github=require('./publish-github-release');
function ports(request=fetch){return {
  processes:nativeProcess,request,
  token:env=>github.token(env,'NPM_TOKEN'),
  async evidence(env,root,layout){
    const ci=github.context(env,root);
    const origin=new URL(env.CI_API_V4_URL);
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)throw Error('Trusted GitLab API required.');
    const gitlab=github.api(origin.href.replace(/\/$/,''),github.token(env,'SYSTEM_RELEASE_GITLAB_TOKEN'),'PRIVATE-TOKEN',request);
    const jobs=await github.gates(ci,env,root,gitlab,layout);
    return {...ci,jobs,artifact:(jobId,file)=>gitlab('/projects/'+ci.projectId+'/jobs/'+jobId+'/artifacts/'+file,{raw:true})};
  },
};}
async function invoke(action,root,env,request){
  const app=await NestFactory.createApplicationContext(ReleaseModule.registerNpm(ports(request)),{logger:false,abortOnError:false});
  try {const service=app.get(NpmPublicationService);return action==='prepare'?service.prepare(root,env):await service.publish(env,root);}
  finally {await app.close();}
}
module.exports={invoke};
