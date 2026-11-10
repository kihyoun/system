'use strict';
// Allowlisted native acceptance identities survive cleanup without retaining
// platform URLs, credentials, configuration bytes or raw API diagnostics.
const requiredJobs=['build:source','test:browser','build:wizard','test:wizard'];
const stages=['guided-preview-fresh-public-registration','guided-preview-native-source-push-and-build',
  'guided-preview-native-evidence-adoption','guided-preview-native-review-deploy-stop','guided-preview-native-review-stop',
  'guided-preview-native-merge-and-build','guided-preview-native-beta-deploy-stop','guided-preview-native-beta-stop',
  'guided-preview-production-retained','guided-preview-temporary-credential-revoked'];
const positive=value=>Number.isSafeInteger(value)&&value>0;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const image=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
function sanitize(value) {
  if(!value||typeof value!=='object')return undefined;
  const clean={};
  for(const key of ['initialRegistrationId','adoptedProjectId'])if(positive(value[key]))clean[key]=value[key];
  if(hash(value.productionMainSha256))clean.productionMainSha256=value.productionMainSha256;
  if(image(value.productionImageId))clean.productionImageId=value.productionImageId;
  if(typeof value.betaEnabled==='boolean')clean.betaEnabled=value.betaEnabled;
  if(typeof value.credentialCleanupUncertain==='boolean')clean.credentialCleanupUncertain=value.credentialCleanupUncertain;
  if(Array.isArray(value.previousProjectIds))clean.previousProjectIds=value.previousProjectIds.filter(positive).slice(0,100);
  if(value.productionRetained){const retained={};if(hash(value.productionRetained.mainSha256))retained.mainSha256=value.productionRetained.mainSha256;
    if(image(value.productionRetained.runningImage))retained.runningImage=value.productionRetained.runningImage;clean.productionRetained=retained;}
  for(const context of ['source','review','merge','beta']) {
    const row=value[context];if(!row||typeof row!=='object')continue;
    const item={};
    for(const key of ['projectId','systemProjectId','pipelineId','mergeRequestIid'])if(positive(row[key]))item[key]=row[key];
    for(const key of ['sourceCommit','mergeCommit'])if(sha(row[key]))item[key]=row[key];
    if(['push','merge_request_event'].includes(row.source))item.source=row.source;
    for(const key of ['merged','normalGate','artifactsVerified'])if(typeof row[key]==='boolean')item[key]=row[key];
    if(image(row.imageDigest))item.imageDigest=row.imageDigest;
    if(Array.isArray(row.jobs))item.jobs=row.jobs.filter(job=>job&&positive(job.id)&&requiredJobs.includes(job.name)&&['success','failed','canceled','skipped','running','pending'].includes(job.status))
      .map(job=>({id:job.id,name:job.name,status:job.status,...(positive(job.runnerId)?{runnerId:job.runnerId}:{})}));
    for(const action of ['deploy','stop']) {
      const job=row[action];if(job&&positive(job.id)&&job.name===action+':'+context&&['manual','success','failed','canceled','running','pending'].includes(job.status))
        item[action]={id:job.id,name:job.name,status:job.status,...(positive(job.runnerId)?{runnerId:job.runnerId}:{})};
    }
    for(const key of ['deployment','stopped']) {
      const identity=row[key];if(!identity||typeof identity!=='object')continue;
      const owned={};for(const field of ['projectId','pipelineId','jobId'])if(positive(identity[field]))owned[field]=identity[field];
      if(Number.isSafeInteger(identity.mrIid)&&identity.mrIid>=0)owned.mrIid=identity.mrIid;
      if(sha(identity.sourceCommit))owned.sourceCommit=identity.sourceCommit;
      if(/^[a-f0-9]{48}$/.test(identity.operation||''))owned.operation=identity.operation;
      if(/^p[1-9][0-9]*-j[1-9][0-9]*$/.test(identity.generation||''))owned.generation=identity.generation;
      if(['active','stopped'].includes(identity.state))owned.state=identity.state;
      if(image(identity.imageDigest))owned.imageDigest=identity.imageDigest;
      item[key]=owned;
    }
    if(positive(row.stoppedThroughPipelineId))item.stoppedThroughPipelineId=row.stoppedThroughPipelineId;
    if(typeof row.containerRemoved==='boolean')item.containerRemoved=row.containerRemoved;
    clean[context]=item;
  }
  return Object.keys(clean).length?clean:undefined;
}
function validate(value,results) {
  const proof=sanitize(value),fail=()=>{throw Error('Complete native guided preview lifecycle evidence is required.');};
  if(!proof||proof.credentialCleanupUncertain===true||proof.betaEnabled!==true||!positive(proof.initialRegistrationId)||!positive(proof.adoptedProjectId)||
    proof.initialRegistrationId===proof.adoptedProjectId||!Array.isArray(proof.previousProjectIds)||proof.previousProjectIds.includes(proof.adoptedProjectId)||!hash(proof.productionMainSha256)||!image(proof.productionImageId)||
    proof.productionRetained?.mainSha256!==proof.productionMainSha256||proof.productionRetained?.runningImage!==proof.productionImageId)fail();
  if(!Array.isArray(results)||!stages.every(name=>results.some(row=>row.name===name&&row.status==='passed')))fail();
  for(const context of ['source','review','merge','beta']) {
    const row=proof[context];if(!row||row.projectId!==proof.adoptedProjectId||!positive(row.pipelineId)||!sha(row.sourceCommit)||
      row.source!==(context==='review'?'merge_request_event':'push')||row.artifactsVerified!==true||!image(row.imageDigest)||
      new Set(row.jobs?.map(job=>job.id)).size!==4||!requiredJobs.every(name=>row.jobs?.filter(job=>job.name===name).length===1&&row.jobs.find(job=>job.name===name).status==='success'&&positive(row.jobs.find(job=>job.name===name).runnerId)))fail();
  }
  const {source,review,merge,beta}=proof;
  if(new Set([source.pipelineId,review.pipelineId,merge.pipelineId]).size!==3||merge.normalGate!==true||merge.merged!==true||
    !positive(review.mergeRequestIid)||merge.mergeRequestIid!==review.mergeRequestIid||merge.mergeCommit!==merge.sourceCommit||merge.sourceCommit===source.sourceCommit||
    review.deployment?.operation!==beta.deployment?.operation||beta.pipelineId!==merge.pipelineId||beta.sourceCommit!==merge.sourceCommit||beta.imageDigest!==merge.imageDigest)fail();
  for(const context of ['review','beta']) {
    const row=proof[context],active=row.deployment,stopped=row.stopped;
    if(row.deploy?.id===row.stop?.id||!['deploy','stop'].every(action=>row[action]?.status==='success'&&positive(row[action].runnerId))||
      !active||!stopped||active.state!=='active'||stopped.state!=='stopped'||active.projectId!==proof.adoptedProjectId||
      active.pipelineId!==row.pipelineId||active.jobId!==row.deploy.id||active.sourceCommit!==row.sourceCommit||
      active.mrIid!==(context==='review'?row.mergeRequestIid:0)||!/^[a-f0-9]{48}$/.test(active.operation||'')||
      active.generation!=='p'+row.pipelineId+'-j'+row.deploy.id||active.imageDigest!==row.imageDigest||
      !['projectId','pipelineId','jobId','sourceCommit','mrIid','operation','generation','imageDigest'].every(key=>active[key]===stopped[key])||
      !positive(row.stoppedThroughPipelineId)||row.stoppedThroughPipelineId<row.pipelineId||row.containerRemoved!==true)fail();
  }
  return proof;
}
module.exports={sanitize,validate,stages,requiredJobs};
