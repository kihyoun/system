'use strict';
const {requiredJobs,stages}=require('../../gitlab/guided-preview-evidence');
const sha='b'.repeat(40),reviewSha='c'.repeat(40),mergedSha='d'.repeat(40);
const image='sha256:'+'a'.repeat(64),imageDigest='sha256:'+'e'.repeat(64);
function proof(productionImageId=image) {
  const jobs=base=>requiredJobs.map((name,index)=>({id:base+index,name,status:'success',runnerId:9}));
  const source={projectId:2,pipelineId:31,sourceCommit:sha,source:'push',jobs:jobs(310),artifactsVerified:true,imageDigest};
  const review={projectId:2,mergeRequestIid:7,pipelineId:32,sourceCommit:reviewSha,source:'merge_request_event',jobs:jobs(320),artifactsVerified:true,imageDigest};
  const merge={projectId:2,mergeRequestIid:7,pipelineId:33,sourceCommit:mergedSha,source:'push',jobs:jobs(330),merged:true,normalGate:true,mergeCommit:mergedSha,artifactsVerified:true,imageDigest};
  const beta={projectId:2,pipelineId:33,sourceCommit:mergedSha,source:'push',jobs:jobs(330),artifactsVerified:true,imageDigest};
  for(const [kind,row] of Object.entries({review,beta})) {
    row.deploy={id:row.pipelineId*10+4,name:'deploy:'+kind,status:'success',runnerId:9};
    row.stop={id:row.pipelineId*10+5,name:'stop:'+kind,status:'success',runnerId:9};
    row.deployment={projectId:2,pipelineId:row.pipelineId,sourceCommit:row.sourceCommit,jobId:row.deploy.id,mrIid:kind==='review'?7:0,
      operation:'f'.repeat(48),generation:'p'+row.pipelineId+'-j'+row.deploy.id,state:'active',imageDigest};
    row.stopped={...row.deployment,state:'stopped'};row.stoppedThroughPipelineId=row.pipelineId;row.containerRemoved=true;
  }
  return {initialRegistrationId:1,adoptedProjectId:2,productionMainSha256:'a'.repeat(64),productionImageId,betaEnabled:true,previousProjectIds:[1],
    productionRetained:{mainSha256:'a'.repeat(64),runningImage:productionImageId},source,review,merge,beta};
}
module.exports={proof,stages,sha,reviewSha,mergedSha,image,imageDigest};
