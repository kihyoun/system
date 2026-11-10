'use strict';
// Reuse the guided merge's real native image when available. The independent
// legacy fixture creates a marker image only for runs without guided setup.
const binding=require('../../project-bootstrap/wizard-source-primary/binding');
const markerPath='/opt/system-bootstrapper/private-recovery-proof';
const terminal=new Set(['failed','canceled','skipped','success']);
function pipelineContent(marker) {
  if(!/^[a-f0-9]{24}$/.test(marker))throw Error('private-wizard-marker-invalid');
  const scripts=[
    'context=$(mktemp -d)',
    "printf '%s\\n' 'FROM systembootstrapper/wizard' 'COPY proof /opt/system-bootstrapper/private-recovery-proof' > \"$context/Dockerfile\"",
    "printf '%s' '"+marker+"' > \"$context/proof\"",
    'docker image inspect systembootstrapper/wizard --format "{{.Id}}" > source-image.txt',
    'docker build --network none --pull=false --provenance=false --sbom=false -t "$CI_REGISTRY_IMAGE/recovery-wizard:$CI_COMMIT_SHA" "$context"',
    'docker image inspect "$CI_REGISTRY_IMAGE/recovery-wizard:$CI_COMMIT_SHA" --format "{{.Id}}" > private-image.txt',
    'printf \'%s\' "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" --username "$CI_REGISTRY_USER" --password-stdin',
    'docker push "$CI_REGISTRY_IMAGE/recovery-wizard:$CI_COMMIT_SHA"',
    'rm -rf "$context"'
  ];
  return 'stages: [verify]\nprivate-wizard-publish:\n  stage: verify\n  image: {name: system-candidate:under-test, pull_policy: never}\n  tags: [docker]\n  script:\n'+
    scripts.map(script=>'    - '+JSON.stringify(script)+'\n').join('')+
    '  artifacts:\n    paths: [source-image.txt, private-image.txt]\n';
}
async function readOwnedProject(candidate) {
  const script="const fs=require('fs');const {readReceipt}=require('/system/sync/dist/ProjectBootstrap');const r=readReceipt(fs.readFileSync('/state/.projects.env/.wizard.env','utf8'));if(!r||r.defaultProject!==true||r.template!=='wizard'||r.state!=='complete'||!Number.isInteger(r.repository?.id))throw Error();process.stdout.write(JSON.stringify({id:r.repository.id,path:r.repository.path,ciPath:r.repository.ciPath}));";
  let receipt;
  try {receipt=JSON.parse(await candidate.inner(['exec','system_bootstrapper_1','node','-e',script]));}
  catch {throw Error('private-wizard-owned-project-required');}
  if(!Number.isInteger(receipt.id)||receipt.id<=0||!/^[-A-Za-z0-9_/]+\/wizard$/.test(receipt.path||'')||
    !['.system-bootstrapper/ci.yml','.gitlab-ci.yml'].includes(receipt.ciPath))throw Error('private-wizard-owned-project-required');
  return receipt;
}
function immutableImage(repository,tag) {
  if(!Number.isInteger(repository.id)||!repository.path?.endsWith('/wizard/recovery-wizard')||
    !/^(?:[A-Za-z0-9.-]+)(?::[0-9]+)?\/[A-Za-z0-9_./-]+$/.test(repository.location||'')||
    !/^sha256:[a-f0-9]{64}$/.test(tag.digest||''))throw Error('private-wizard-registry-identity-invalid');
  return repository.location+'@'+tag.digest;
}
async function readNativeProject(candidate) {
  const script="const fs=require('fs');const binding=require('/system/project-bootstrap/wizard-source-primary/binding');const {setting}=require('/system/project-bootstrap/wizard-source-primary/run');const receipt=binding.validate(binding.read('/state/.projects.env/.wizard.env').receipt);const main=fs.readFileSync('/state/.docker.env','utf8');const registry=new URL(setting(main,'GITLAB_REGISTRY_URL'));if(Number(setting(main,'GITLAB_REGISTRY_DOMAIN_MODE'))<2)registry.port='5050';process.stdout.write(JSON.stringify({receipt,registryHost:registry.host}));";
  let owned;
  try {owned=JSON.parse(await candidate.inner(['exec','system_bootstrapper_1','node','-e',script]));binding.validate(owned.receipt);}
  catch {throw Error('private-wizard-owned-project-required');}
  if(!/^registry\.candidate\.test(?::5050)?$/.test(owned.registryHost||''))throw Error('private-wizard-registry-identity-invalid');
  return owned;
}
async function nativeImage(candidate,owned,merge,token) {
  const receipt=owned.receipt,projectId=receipt.repository.id;
  if(!merge||merge.projectId!==projectId||merge.merged!==true||merge.normalGate!==true||merge.source!=='push'||merge.artifactsVerified!==true||
    !binding.sha(merge.sourceCommit)||!Number.isSafeInteger(merge.pipelineId)||merge.pipelineId<1||!Array.isArray(merge.jobs))throw Error('private-wizard-publish-job-required');
  const expectedJobs=['build:source','test:browser','build:wizard','test:wizard'];
  if(merge.jobs.length!==4||!expectedJobs.every(name=>merge.jobs.filter(job=>job.name===name&&job.status==='success'&&
    Number.isSafeInteger(job.id)&&job.id>0&&Number.isSafeInteger(job.runnerId)&&job.runnerId>0).length===1))throw Error('private-wizard-publish-job-required');
  const build=merge.jobs.find(job=>job.name==='build:wizard');
  const get=route=>candidate.api('/'+route,token);
  const artifact=await get('projects/'+projectId+'/jobs/'+build.id+'/artifacts/build-evidence.json');
  const imageRef=owned.registryHost+'/'+receipt.repository.path+'@'+merge.imageDigest;
  if(!/^sha256:[a-f0-9]{64}$/.test(merge.imageDigest||'')||artifact.imageRef!==imageRef)throw Error('private-wizard-registry-identity-invalid');
  // Independently verify current ownership, approved producers, all required
  // checks and both real artifacts; the guided summary alone is not proof.
  const proof=await binding.evidence(get,receipt,merge.pipelineId,merge.sourceCommit,imageRef);
  const branch=await get('projects/'+projectId+'/repository/branches/'+encodeURIComponent(receipt.repository.defaultBranch));
  const jobs=await get('projects/'+projectId+'/pipelines/'+merge.pipelineId+'/jobs?per_page=100&include_retried=false');
  binding.pipelineChecks(proof.pipeline,jobs);
  if(branch.commit?.id!==merge.sourceCommit||!merge.jobs.every(expected=>{
    const actual=jobs.filter(job=>job.name===expected.name);
    return actual.length===1&&actual[0].id===expected.id&&actual[0].runner?.id===expected.runnerId;
  }))throw Error('private-wizard-publish-job-required');
  let image;
  try {image=JSON.parse(await candidate.inner(['image','inspect',imageRef]))[0];}
  catch {throw Error('private-wizard-uncached-layer-required');}
  const archives=Object.values({...candidate.spec.images,...candidate.spec.supportImages,...candidate.spec.acmeImages});
  if(!/^sha256:[a-f0-9]{64}$/.test(image?.Id||'')||archives.some(item=>item.id===image.Id)||
    image.Config?.Labels?.['org.opencontainers.image.revision']!==merge.sourceCommit||!image.RepoDigests?.includes(imageRef))throw Error('private-wizard-uncached-layer-required');
  return {kind:'source-primary-native-v1',projectId,projectPath:receipt.repository.path,registryHost:owned.registryHost,
    sourceCommit:merge.sourceCommit,pipelineId:merge.pipelineId,jobId:build.id,runnerId:build.runnerId,imageRef,imageDigest:merge.imageDigest,imageId:image.Id};
}
async function publish(candidate) {
  if(!/^[a-f0-9]{24}$/.test(candidate.id))throw Error('private-wizard-owner-invalid');
  const native=candidate.spec.guidedPreviewAcceptance===true||candidate.evidence?.guidedPreview!==undefined;
  const owned=native?await readNativeProject(candidate):await readOwnedProject(candidate);
  let token;
  try {
    const auth=await candidate.rails("require 'json';t=User.find_by_username('root').personal_access_tokens.create!(name:'disposable-private-wizard-fixture',scopes:['api'],expires_at:Date.tomorrow);puts JSON.generate(token:t.token)");
    if(typeof auth?.token!=='string'||auth.token.length<10)throw Error('private-wizard-credential-failed');
    token=auth.token;
    if(native)return await nativeImage(candidate,owned,candidate.evidence?.guidedPreview?.merge,token);
    const project=await candidate.api('/projects/'+owned.id,token);
    if(project.id!==owned.id||project.path!=='wizard'||project.path_with_namespace!==owned.path||project.visibility!=='private'||
      (project.ci_config_path||'.gitlab-ci.yml')!==owned.ciPath||!project.default_branch)throw Error('private-wizard-owned-project-mismatch');
    const branch='candidate-private-pin-'+candidate.id;
    await candidate.api('/projects/'+project.id+'/repository/branches',token,'POST',{branch,ref:project.default_branch});
    const file='/projects/'+project.id+'/repository/files/'+encodeURIComponent(owned.ciPath);
    await candidate.api(file,token,'PUT',{branch,content:pipelineContent(candidate.id),commit_message:'Exercise uncached private Wizard recovery'});
    const metadata=await candidate.api(file+'?ref='+encodeURIComponent(branch),token);
    const commit=metadata.last_commit_id;
    if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('private-wizard-commit-invalid');
    let pipeline;
    await candidate.wait(async()=>{
      const runs=await candidate.api('/projects/'+project.id+'/pipelines?ref='+encodeURIComponent(branch),token);
      pipeline=runs.find(run=>run.sha===commit);
      return !!pipeline&&terminal.has(pipeline.status);
    },180000);
    if(pipeline.status!=='success')throw Error('private-wizard-pipeline-failed');
    const jobs=await candidate.api('/projects/'+project.id+'/pipelines/'+pipeline.id+'/jobs',token);
    if(jobs.length!==1||jobs[0].name!=='private-wizard-publish'||jobs[0].status!=='success'||!jobs[0].runner?.id)throw Error('private-wizard-publish-job-required');
    const job=jobs[0];
    const artifact=async file=>String(await candidate.api('/projects/'+project.id+'/jobs/'+job.id+'/artifacts/'+file,token)).trim();
    const imageId=await artifact('private-image.txt'),sourceImageId=await artifact('source-image.txt');
    if(!/^sha256:[a-f0-9]{64}$/.test(imageId)||sourceImageId!==candidate.spec.images.wizard.id||
      Object.values(candidate.spec.images).some(image=>image.id===imageId))throw Error('private-wizard-uncached-layer-required');
    const repositories=await candidate.api('/projects/'+project.id+'/registry/repositories',token);
    const repository=repositories.find(item=>item.path===project.path_with_namespace+'/recovery-wizard');
    if(!repository)throw Error('private-wizard-registry-required');
    const tag=await candidate.api('/projects/'+project.id+'/registry/repositories/'+repository.id+'/tags/'+commit,token);
    if(tag.name!==commit)throw Error('private-wizard-registry-tag-mismatch');
    const imageRef=immutableImage(repository,tag);
    return {projectId:project.id,projectPath:project.path_with_namespace,imageRef,imageDigest:tag.digest,imageId,sourceImageId,marker:candidate.id,markerPath,
      pipelineId:pipeline.id,jobId:job.id,runnerId:job.runner.id,queuedSeconds:job.queued_duration,duration:job.duration};
  } finally {
    let revoked=false;
    if(token)try {await candidate.api('/personal_access_tokens/self',token,'DELETE');revoked=true;}
    catch { /* Reserved-name cleanup also covers a malformed mint response. */ }
    if(!revoked) {
      await candidate.rails("User.find_by_username('root').personal_access_tokens.where(name:'disposable-private-wizard-fixture',revoked:false).find_each(&:revoke!);puts '{}'");
    }
    if(token) {
      const response=await candidate.request(candidate.url+'/api/v4/user',{headers:{Host:'gitlab.candidate.test','PRIVATE-TOKEN':token}});
      if(response.status!==401)throw Error('private-wizard-credential-not-revoked');
    }
  }
}
module.exports={publish,pipelineContent,immutableImage,markerPath};
