'use strict';
const evidence=require('../../dist/modules/release/guidedPreviewEvidence');
function proof(){
  const image='sha256:'+'a'.repeat(64),source='b'.repeat(40),operation='c'.repeat(48);
  const deployment={projectId:7,pipelineId:100,jobId:201,mrIid:0,sourceCommit:source,operation,generation:'p100-j201',state:'active',imageDigest:image};
  return {version:2,sourceLayout:'system-monorepo-v1',fixtureNamespace:'system-beta-contract-fixture-v1',acceptanceScope:'native-lifecycle-with-contract-verifier',
    productionMainSha256:'d'.repeat(64),productionImageId:image,productionRetained:{mainSha256:'d'.repeat(64),runningImage:image},temporaryCredentialRevoked:true,
    candidate:{projectId:7,namespaceId:3,fixturePipelineId:100,fixtureCandidateJobId:200,sourceCommit:source,sourceTree:'e'.repeat(40),wizardSourceTree:'f'.repeat(40),
      helperImage:image,wizardImageId:image,helperRegistryDigest:image,wizardRegistryDigest:image,pipelineEvidence:'contract-fixture'},
    setup:{projectId:7,namespaceId:3,sourceCommit:source,operation,native:true,productionChanged:false,reviewEnabled:false,betaEnabled:true,noBuildStarted:true},
    verifier:{mode:'contract-fixture',passed:true,negativeGatesPassed:true},
    beta:{bindingVerified:true,imageOwnershipVerified:true,tlsVerified:true,containerRemoved:true,networkRemoved:true,helperRemoved:true,leaseReleased:true,
      fixtureDeployJobId:201,fixtureStopJobId:202,stoppedThroughPipelineId:100,deployment,stopped:{...deployment,state:'stopped'}}};
}
const results=evidence.stagesV2.map(name=>({name,status:'passed'}));
module.exports={proof,results};
