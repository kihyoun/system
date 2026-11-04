'use strict';
// Runs only inside the owned private candidate, after cold recovery has proved
// existing database, repository, registry, TLS and encrypted-state identity.
const release=require('../../gitlab/security-release.json');
const recovery=require('./recovery');
const trust=require('../../bootstrapper/ca/check');
function sanitizeEvidence(value){
  if(value?.fromImage!==release.fromImage||value.toImage!==release.toImage||
    !/^sha256:[a-f0-9]{64}$/.test(value.fromImageId||'')||!/^sha256:[a-f0-9]{64}$/.test(value.toImageId||''))return undefined;
  const result={fromImage:release.fromImage,toImage:release.toImage,fromImageId:value.fromImageId,toImageId:value.toImageId};
  if(value.runnerImage===release.runner.toImage&&value.runnerVersion===release.runner.toVersion&&value.helperImage===release.runner.helperImage&&value.jobCaBundleSha256===release.jobCaBundleSha256&&[value.runnerImageId,value.fromRunnerImageId,value.helperImageId,value.fromHelperImageId].every(id=>/^sha256:[a-f0-9]{64}$/.test(id||''))){
    result.runnerImage=value.runnerImage;result.runnerImageId=value.runnerImageId;result.fromRunnerImageId=value.fromRunnerImageId;result.helperImageId=value.helperImageId;result.fromHelperImageId=value.fromHelperImageId;
    result.runnerVersion=release.runner.toVersion;result.helperImage=release.runner.helperImage;result.jobCaBundleSha256=release.jobCaBundleSha256;
  }
  for(const name of ['checkpointVerified','migrationVerified','registryVerified','rollbackVerified','securityTrustVerified','runnerUpgradeVerified','runnerManagerIdentityPreserved'])result[name]=value[name]===true;
  return result;
}
function prepared(candidate){
  if(candidate.spec.gitlabUpgradeAcceptance!==true||!candidate.spec.supportImages?.previousGitlab||!candidate.spec.supportImages?.previousRunner||!candidate.spec.supportImages?.previousHelper||!candidate.spec.supportImages?.helper||!candidate.spec.restore?.base)throw Error('upgrade-restored-candidate-required');
  const imageIds={[release.fromImage]:candidate.spec.supportImages.previousGitlab.id,[release.toImage]:candidate.spec.images.gitlab.id,[release.runner.toImage]:candidate.spec.images.runner?.id,[release.runner.fromImage]:candidate.spec.supportImages.previousRunner.id,[release.runner.helperImage]:candidate.spec.supportImages.helper.id,[release.runner.fromHelperImage]:candidate.spec.supportImages.previousHelper.id};
  if(Object.values(imageIds).some(id=>!/^sha256:[a-f0-9]{64}$/.test(id))||imageIds[release.fromImage]===imageIds[release.toImage]||imageIds[release.runner.fromImage]===imageIds[release.runner.toImage])throw Error('upgrade-distinct-images-required');
  return {imageIds,runnerAliases:{[release.runner.fromImage]:'candidate-runner:under-test',[release.runner.toImage]:'candidate-runner:target'},helperAliases:{[release.runner.fromHelperImage]:'candidate-helper:under-test',[release.runner.helperImage]:'candidate-helper:target'},aliases:{[release.fromImage]:'candidate-gitlab:under-test',[release.toImage]:'candidate-gitlab:target'},options:{sourceRevision:candidate.spec.sourceRevision,
    stateDir:'/state',persistentDir:candidate.spec.restore.base,checkpointDir:'/state/gitlab-upgrades/candidate-'+candidate.id,evidence:'/state/candidate-migration-evidence.json',readyTimeoutSeconds:600}};
}
async function invoke(candidate,action,checkpointSha256){
  const input={...prepared(candidate),action,checkpointSha256};
  const script=`const fs=require('fs');let raw='';process.stdin.on('data',chunk=>raw+=chunk);process.stdin.on('end',async()=>{try{
    const input=JSON.parse(raw),{Upgrade,release,hash}=require('/system/gitlab/upgrade');
    // These image IDs were loaded from outer-driver archives whose public pins
    // were verified before the network-isolated daemon was created. Only this
    // test adapter supplies aliases; the production CLI requires RepoDigests.
    const engine=new Upgrade(input.options,{imageIds:input.imageIds,aliases:input.aliases,runnerAliases:input.runnerAliases,helperAliases:input.helperAliases});let result;
    if(input.action==='migrate'){
      engine.lock('a'.repeat(64));engine.syncIdle();
      const before=await engine.preflight(release.fromVersion);
      if(before.Image!==engine.image(release.fromImage))throw Error();
      const plan={fromImageId:engine.image(release.fromImage),toImageId:engine.image(release.toImage),sourceRevision:input.options.sourceRevision,configurationSha256:hash(engine.configuration()),runner:engine.runnerPlan()};
      result=await engine.migrate(plan);
    }else if(input.action==='rollback')result=await engine.rollback(input.checkpointSha256);else throw Error();
    process.stdout.write(JSON.stringify(result));
  }catch{process.exitCode=1;}});`;
  const raw=await candidate.inner(['exec','-i','system_bootstrapper_1','node','-e',script],{input:JSON.stringify(input),timeout:900000});
  return JSON.parse(raw.split('\n').at(-1));
}
async function run(candidate,dependencies={}){
  const checked=prepared(candidate),call=dependencies.invoke||invoke;
  let expected,checkpointSha256,runnerBefore,runnerPromoted;
  await candidate.stage('gitlab-upgrade-record-existing-data',async()=>{expected=await (dependencies.recordIdentity||recovery.recordIdentity)(candidate);runnerBefore=await (dependencies.runnerState||runnerState)(candidate,false);});
  await candidate.stage('gitlab-upgrade-migrated-data',async()=>{
    const result=await call(candidate,'migrate');checkpointSha256=result.checkpointSha256;
    if(result.status!=='promoted'||result.toImage!==release.toImage||!/^[a-f0-9]{64}$/.test(checkpointSha256||''))throw Error('upgrade-checkpoint-proof-invalid');
    await (dependencies.verifyServiceIdentity||recovery.verifyServiceIdentity)(candidate,expected);
    runnerPromoted=await (dependencies.runnerState||runnerState)(candidate,true,runnerBefore);
    candidate.evidence.gitlabUpgrade={fromImage:release.fromImage,toImage:release.toImage,fromImageId:checked.imageIds[release.fromImage],toImageId:checked.imageIds[release.toImage],runnerImage:release.runner.toImage,runnerImageId:runnerPromoted.imageId,runnerVersion:runnerPromoted.version,fromRunnerImageId:runnerBefore.imageId,helperImageId:runnerPromoted.helperImageId,fromHelperImageId:runnerBefore.helperImageId,helperImage:release.runner.helperImage,jobCaBundleSha256:release.jobCaBundleSha256,checkpointVerified:true,migrationVerified:true,registryVerified:false,rollbackVerified:false,securityTrustVerified:false,runnerUpgradeVerified:true,runnerManagerIdentityPreserved:false};
  });
  await candidate.stage('gitlab-upgrade-security-trust',async()=>{
    await (dependencies.verifyTrust||verifyTrust)(candidate);
    candidate.evidence.gitlabUpgrade.securityTrustVerified=true;
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
    await (dependencies.runnerState||runnerState)(candidate,false,runnerBefore);
    await (dependencies.verifyRegistryBlob||recovery.verifyRegistryBlob)(candidate,{expected});
    candidate.evidence.gitlabUpgrade.runnerManagerIdentityPreserved=true;
    candidate.evidence.gitlabUpgrade.rollbackVerified=true;
  });
}
async function runnerState(candidate,promoted,previous){
  const version=promoted?release.runner.toVersion:release.runner.fromVersion;
  const image=promoted?candidate.spec.images.runner:candidate.spec.supportImages.previousRunner;
  const helper=promoted?candidate.spec.supportImages.helper:candidate.spec.supportImages.previousHelper;
  const alias=promoted?'candidate-helper:target':'candidate-helper:under-test';
  const container=JSON.parse(await candidate.inner(['inspect','runner_docker_1']))[0];
  const actual=await candidate.inner(['exec','runner_docker_1','gitlab-runner','--version']);
  const actualVersion=/^Version:\s+(\d+\.\d+\.\d+)\s*$/m.exec(actual)?.[1];
  const toml=await candidate.inner(['exec','runner_docker_1','cat','/etc/gitlab-runner/config.toml']);
  const helperImage=JSON.parse(await candidate.inner(['image','inspect',alias]))[0];
  if(!container.State?.Running||container.Image!==image.id||actualVersion!==version||!toml.includes('helper_image = "'+alias+'"')||helperImage.Id!==helper.id)throw Error('upgrade-runner-transition-not-proven');
  const script="const fs=require('fs'),c=require('crypto'),path=require('path');const base=process.argv[1],result={};for(const name of fs.readdirSync(base).sort()){if(!/^[0-9]+$/.test(name))continue;const file=path.join(base,name,'config/.runner_system_id');result[name]=c.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}process.stdout.write(JSON.stringify(result));";
  const identity=JSON.parse(await candidate.inner(['exec','system_bootstrapper_1','node','-e',script,candidate.spec.restore.base+'/runners/runner']));
  if(!Object.keys(identity).length||Object.values(identity).some(value=>!/^[a-f0-9]{64}$/.test(value))||(previous&&JSON.stringify(identity)!==JSON.stringify(previous.identity)))throw Error('upgrade-runner-manager-identity-changed');
  return {version:actualVersion,imageId:container.Image,helperImageId:helperImage.Id,identity};
}
async function verifyTrust(candidate){
  const proof=JSON.parse(await candidate.inner(['exec','system_bootstrapper_1','node','/system/bootstrapper/ca/check.js']));
  if(proof.bundleSha256!==release.jobCaBundleSha256||proof.systemCertificates<50||proof.nodeCertificates<50)throw Error('upgrade-controller-CA-trust-invalid');
  for(const args of [
    ['exec','runner_docker_1','cat','/etc/ssl/certs/ca-certificates.crt'],
    ['run','--rm','--network','none','--entrypoint','cat','candidate-helper:target','/etc/ssl/certs/ca-certificates.crt'],
    ['exec','system_gitlab_1','cat','/opt/gitlab/embedded/ssl/certs/cacert.pem']
  ])trust.check(trust.certificates(await candidate.inner(args)));
}
module.exports={run,prepared,invoke,sanitizeEvidence,verifyTrust,runnerState};
