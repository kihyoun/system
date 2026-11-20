'use strict';
// Historical releases retain their original evidence contract. Version two
// separates native lifecycle observations from fixture-based pipeline checks.
const legacy=require('./guided-preview-evidence-v1');
const stagesV2=['system-beta-native-source','system-beta-native-setup','system-beta-contract-verifier',
  'system-beta-native-binding','system-beta-native-deploy','system-beta-native-stop',
  'guided-preview-production-retained','guided-preview-temporary-credential-revoked'];
const positive=value=>Number.isSafeInteger(value)&&value>0;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const image=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
function sanitizeV2(value){
  const clean={version:2};
  if(value.fixtureNamespace==='system-beta-contract-fixture-v1')clean.fixtureNamespace=value.fixtureNamespace;
  if(value.sourceLayout==='system-monorepo-v1')clean.sourceLayout=value.sourceLayout;
  if(value.acceptanceScope==='native-lifecycle-with-contract-verifier')clean.acceptanceScope=value.acceptanceScope;
  for(const key of ['productionMainSha256'])if(hash(value[key]))clean[key]=value[key];
  if(image(value.productionImageId))clean.productionImageId=value.productionImageId;
  for(const key of ['credentialCleanupUncertain','temporaryCredentialRevoked'])if(typeof value[key]==='boolean')clean[key]=value[key];
  const candidate=value.candidate;
  if(candidate&&typeof candidate==='object'){
    const row={};for(const key of ['projectId','namespaceId','fixturePipelineId','fixtureCandidateJobId'])if(positive(candidate[key]))row[key]=candidate[key];
    for(const key of ['sourceCommit','sourceTree','wizardSourceTree'])if(sha(candidate[key]))row[key]=candidate[key];
    for(const key of ['helperImage','wizardImageId','helperRegistryDigest','wizardRegistryDigest'])if(image(candidate[key]))row[key]=candidate[key];
    if(candidate.pipelineEvidence==='contract-fixture')row.pipelineEvidence=candidate.pipelineEvidence;
    clean.candidate=row;
  }
  if(value.setup&&typeof value.setup==='object'){
    const row={};for(const key of ['projectId','namespaceId'])if(positive(value.setup[key]))row[key]=value.setup[key];
    if(sha(value.setup.sourceCommit))row.sourceCommit=value.setup.sourceCommit;
    if(/^[a-f0-9]{48}$/.test(value.setup.operation||''))row.operation=value.setup.operation;
    for(const key of ['native','productionChanged','reviewEnabled','betaEnabled','noBuildStarted'])if(typeof value.setup[key]==='boolean')row[key]=value.setup[key];
    clean.setup=row;
  }
  if(value.verifier&&typeof value.verifier==='object'){
    const row={};if(value.verifier.mode==='contract-fixture')row.mode=value.verifier.mode;
    for(const key of ['passed','negativeGatesPassed'])if(typeof value.verifier[key]==='boolean')row[key]=value.verifier[key];
    clean.verifier=row;
  }
  if(value.productionRetained){const row={};if(hash(value.productionRetained.mainSha256))row.mainSha256=value.productionRetained.mainSha256;
    if(image(value.productionRetained.runningImage))row.runningImage=value.productionRetained.runningImage;clean.productionRetained=row;}
  if(value.beta&&typeof value.beta==='object'){
    const row={};for(const key of ['bindingVerified','imageOwnershipVerified','tlsVerified','containerRemoved','networkRemoved','helperRemoved','leaseReleased'])if(typeof value.beta[key]==='boolean')row[key]=value.beta[key];
    for(const key of ['fixtureDeployJobId','fixtureStopJobId','stoppedThroughPipelineId'])if(positive(value.beta[key]))row[key]=value.beta[key];
    for(const key of ['deployment','stopped']){
      const source=value.beta[key];if(!source||typeof source!=='object')continue;
      const item={};for(const field of ['projectId','pipelineId','jobId'])if(positive(source[field]))item[field]=source[field];
      if(source.mrIid===0)item.mrIid=0;if(sha(source.sourceCommit))item.sourceCommit=source.sourceCommit;
      if(/^[a-f0-9]{48}$/.test(source.operation||''))item.operation=source.operation;
      if(/^p[1-9][0-9]*-j[1-9][0-9]*$/.test(source.generation||''))item.generation=source.generation;
      if(['active','stopped'].includes(source.state))item.state=source.state;
      if(image(source.imageDigest))item.imageDigest=source.imageDigest;
      row[key]=item;
    }
    clean.beta=row;
  }
  return clean;
}
function sanitize(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  if(value.version===2)return sanitizeV2(value);
  if(value.version!==undefined&&value.version!==1)return undefined;
  const clean=legacy.sanitize(value);return clean&&value.version===1?{version:1,...clean}:clean;
}
function validateV2(value,results){
  const p=sanitizeV2(value),c=p.candidate,s=p.setup,b=p.beta;
  const fail=()=>{throw Error('Complete native System Beta lifecycle and explicit contract-verifier evidence are required.');};
  if(p.fixtureNamespace!=='system-beta-contract-fixture-v1'||p.sourceLayout!=='system-monorepo-v1'||p.acceptanceScope!=='native-lifecycle-with-contract-verifier'||
    !hash(p.productionMainSha256)||!image(p.productionImageId)||p.credentialCleanupUncertain===true||p.temporaryCredentialRevoked!==true||
    p.productionRetained?.mainSha256!==p.productionMainSha256||p.productionRetained?.runningImage!==p.productionImageId||
    !Array.isArray(results)||!stagesV2.every(name=>results.some(row=>row.name===name&&row.status==='passed')))fail();
  if(!c||!['projectId','namespaceId','fixturePipelineId','fixtureCandidateJobId'].every(key=>positive(c[key]))||
    !['sourceCommit','sourceTree','wizardSourceTree'].every(key=>sha(c[key]))||
    !['helperImage','wizardImageId','helperRegistryDigest','wizardRegistryDigest'].every(key=>image(c[key]))||c.pipelineEvidence!=='contract-fixture'||
    !s||s.projectId!==c.projectId||s.namespaceId!==c.namespaceId||s.sourceCommit!==c.sourceCommit||s.native!==true||
    s.productionChanged!==false||s.reviewEnabled!==false||s.betaEnabled!==true||s.noBuildStarted!==true||
    p.verifier?.mode!=='contract-fixture'||p.verifier.passed!==true||p.verifier.negativeGatesPassed!==true)fail();
  if(!b||!['bindingVerified','imageOwnershipVerified','tlsVerified','containerRemoved','networkRemoved','helperRemoved','leaseReleased'].every(key=>b[key]===true)||
    !positive(b.fixtureDeployJobId)||!positive(b.fixtureStopJobId)||b.fixtureDeployJobId===b.fixtureStopJobId||!positive(b.stoppedThroughPipelineId)||b.stoppedThroughPipelineId<c.fixturePipelineId)fail();
  const a=b.deployment,z=b.stopped;
  if(!a||!z||a.state!=='active'||z.state!=='stopped'||a.projectId!==c.projectId||a.pipelineId!==c.fixturePipelineId||a.jobId!==b.fixtureDeployJobId||
    a.mrIid!==0||a.sourceCommit!==c.sourceCommit||a.operation!==s.operation||!/^[a-f0-9]{48}$/.test(a.operation||'')||
    a.generation!=='p'+c.fixturePipelineId+'-j'+b.fixtureDeployJobId||a.imageDigest!==c.wizardRegistryDigest||
    !['projectId','pipelineId','jobId','mrIid','sourceCommit','operation','generation','imageDigest'].every(key=>a[key]===z[key]))fail();
  return p;
}
function validate(value,results){
  if(value?.version===2)return validateV2(value,results);
  if(value?.version!==undefined&&value.version!==1)throw Error('Unsupported guided acceptance evidence version.');
  return legacy.validate(value,results);
}
module.exports={sanitize,validate,stages:legacy.stages,requiredJobs:legacy.requiredJobs,stagesV2};
