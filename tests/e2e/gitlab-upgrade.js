'use strict';
// Runs only inside the owned private candidate, after cold recovery has proved
// existing database, repository, registry, TLS and encrypted-state identity.
const release=require('../../gitlab/security-release.json');
const recovery=require('./recovery');
function sanitizeEvidence(value){
  if(value?.fromImage!==release.fromImage||value.toImage!==release.toImage||
    !/^sha256:[a-f0-9]{64}$/.test(value.fromImageId||'')||!/^sha256:[a-f0-9]{64}$/.test(value.toImageId||''))return undefined;
  const result={fromImage:release.fromImage,toImage:release.toImage,fromImageId:value.fromImageId,toImageId:value.toImageId};
  for(const name of ['checkpointVerified','migrationVerified','registryVerified','rollbackVerified'])result[name]=value[name]===true;
  return result;
}
function prepared(candidate){
  if(candidate.spec.gitlabUpgradeAcceptance!==true||!candidate.spec.supportImages?.previousGitlab||!candidate.spec.restore?.base)throw Error('upgrade-restored-candidate-required');
  const imageIds={[release.fromImage]:candidate.spec.supportImages.previousGitlab.id,[release.toImage]:candidate.spec.images.gitlab.id};
  if(Object.values(imageIds).some(id=>!/^sha256:[a-f0-9]{64}$/.test(id))||new Set(Object.values(imageIds)).size!==2)throw Error('upgrade-distinct-images-required');
  return {imageIds,aliases:{[release.fromImage]:'candidate-gitlab:under-test',[release.toImage]:'candidate-gitlab:target'},options:{sourceRevision:candidate.spec.sourceRevision,
    stateDir:'/state',persistentDir:candidate.spec.restore.base,checkpointDir:'/state/gitlab-upgrades/candidate-'+candidate.id,evidence:'/state/candidate-migration-evidence.json',readyTimeoutSeconds:600}};
}
async function invoke(candidate,action,checkpointSha256){
  const input={...prepared(candidate),action,checkpointSha256};
  const script=`const fs=require('fs');let raw='';process.stdin.on('data',chunk=>raw+=chunk);process.stdin.on('end',async()=>{try{
    const input=JSON.parse(raw),{Upgrade,release,hash}=require('/system/gitlab/upgrade');
    // These image IDs were loaded from outer-driver archives whose public pins
    // were verified before the network-isolated daemon was created. Only this
    // test adapter supplies aliases; the production CLI requires RepoDigests.
    const engine=new Upgrade(input.options,{imageIds:input.imageIds,aliases:input.aliases});let result;
    if(input.action==='migrate'){
      engine.lock('a'.repeat(64));engine.syncIdle();
      const before=await engine.preflight(release.fromVersion);
      if(before.Image!==engine.image(release.fromImage))throw Error();
      const plan={fromImageId:engine.image(release.fromImage),toImageId:engine.image(release.toImage),sourceRevision:input.options.sourceRevision,configurationSha256:hash(engine.configuration())};
      result=await engine.migrate(plan);
    }else if(input.action==='rollback')result=await engine.rollback(input.checkpointSha256);else throw Error();
    process.stdout.write(JSON.stringify(result));
  }catch{process.exitCode=1;}});`;
  const raw=await candidate.inner(['exec','-i','system_bootstrapper_1','node','-e',script],{input:JSON.stringify(input),timeout:900000});
  return JSON.parse(raw.split('\n').at(-1));
}
async function run(candidate,dependencies={}){
  const checked=prepared(candidate),call=dependencies.invoke||invoke;
  let expected,checkpointSha256;
  await candidate.stage('gitlab-upgrade-record-existing-data',async()=>{expected=await (dependencies.recordIdentity||recovery.recordIdentity)(candidate);});
  await candidate.stage('gitlab-upgrade-migrated-data',async()=>{
    const result=await call(candidate,'migrate');checkpointSha256=result.checkpointSha256;
    if(result.status!=='promoted'||result.toImage!==release.toImage||!/^[a-f0-9]{64}$/.test(checkpointSha256||''))throw Error('upgrade-checkpoint-proof-invalid');
    await (dependencies.verifyServiceIdentity||recovery.verifyServiceIdentity)(candidate,expected);
    candidate.evidence.gitlabUpgrade={fromImage:release.fromImage,toImage:release.toImage,fromImageId:checked.imageIds[release.fromImage],toImageId:checked.imageIds[release.toImage],checkpointVerified:true,migrationVerified:true,registryVerified:false,rollbackVerified:false};
  });
  await candidate.stage('gitlab-upgrade-registry-ci',async()=>{
    await candidate.inner(['exec','runner_docker_1','gitlab-runner','verify']);
    await (dependencies.verifyRegistryBlob||recovery.verifyRegistryBlob)(candidate,{expected});
    candidate.evidence.gitlabUpgrade.registryVerified=true;
  });
  await candidate.stage('gitlab-upgrade-restored-checkpoint',async()=>{
    const result=await call(candidate,'rollback',checkpointSha256);
    if(result.status!=='restored-checkpoint'||result.checkpointSha256!==checkpointSha256)throw Error('upgrade-checkpoint-proof-invalid');
    await (dependencies.verifyServiceIdentity||recovery.verifyServiceIdentity)(candidate,expected);
    candidate.evidence.gitlabUpgrade.rollbackVerified=true;
  });
}
module.exports={run,prepared,invoke,sanitizeEvidence};
