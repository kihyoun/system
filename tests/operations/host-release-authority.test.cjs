const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {HostReleaseAuthorityService}=require('../../dist/modules/host/releaseAuthority.service');
const profile=require('../../config/gitlab/security-release.json'),lifecycle=require('../../dist/modules/release/guidedPreviewEvidence'),fixture=require('../../tests/shared/guided-preview-fixture');
const revision='a'.repeat(40),sourceTree='b'.repeat(40),wizardTree='c'.repeat(40),id=n=>'sha256:'+n.repeat(64);
const monorepo={sourceLayout:'system-monorepo-v1',sourceRevision:revision,sourceTree,wizardSourceTree:wizardTree};
function proof(){return {runId:'f'.repeat(24),sourceRevision:revision,fullAcceptance:true,images:{candidate:id('1'),wizard:id('2'),runner:id('3')},results:[
 'gitlab-upgrade-migrated-data','gitlab-upgrade-registry-ci','gitlab-upgrade-restored-checkpoint','gitlab-upgrade-security-trust','storage-global-live-lease','storage-refuse-nonempty-and-corrupt-restore','storage-detached-backup-normal-operation','cleanup',...fixture.stages
].map(name=>({name,status:'passed'})),evidence:{guidedPreview:fixture.proof(id('2')),gitlabUpgrade:{fromImage:profile.fromImage,toImage:profile.toImage,fromImageId:id('a'),toImageId:id('b'),migrationVerified:true,rollbackVerified:true,registryVerified:true,checkpointVerified:true,runnerImage:profile.runner.toImage,runnerImageId:id('3'),fromRunnerImageId:id('4'),runnerVersion:profile.runner.toVersion,helperImage:profile.runner.helperImage,helperImageId:id('5'),fromHelperImageId:id('6'),jobCaBundleSha256:profile.jobCaBundleSha256,securityTrustVerified:true,runnerUpgradeVerified:true,runnerManagerIdentityPreserved:true},storage:{localLiveVerified:true,externalSeedRestored:true,backupDetached:true,missingBackupGuardVerified:true,globalLeaseVerified:true,invalidRestoreGuardVerified:true}}};}
function sharedProof(){
 const value=proof(),beta=require('../../tests/shared/system-beta-evidence-fixture').proof();
 Object.assign(value,monorepo,{ciIdentity:{projectId:4,pipelineId:10,candidateJobId:20}});
 beta.productionImageId=id('2');beta.productionRetained.runningImage=id('2');
 Object.assign(beta.candidate,{sourceCommit:revision,sourceTree,wizardSourceTree:wizardTree,helperImage:id('1'),wizardImageId:id('2'),fixturePipelineId:10,fixtureCandidateJobId:20});
 beta.setup.sourceCommit=revision;
 for(const row of [beta.beta.deployment,beta.beta.stopped])Object.assign(row,{sourceCommit:revision,pipelineId:10,generation:'p10-j201'});
 beta.beta.stoppedThroughPipelineId=10;
 value.evidence.guidedPreview=beta;value.results=value.results.filter(row=>!fixture.stages.includes(row.name)).concat(lifecycle.stagesV2.map(name=>({name,status:'passed'})));
 return value;
}

test('host authority binds actual candidate CI and source to full System Beta proof',()=>{
 const service=new HostReleaseAuthorityService(lifecycle),value=sharedProof();value.images.gitlab=value.evidence.gitlabUpgrade.toImageId;
 const release={format:'system-successor-release-v1',...monorepo,projectId:4,pipelineId:10,candidateJobId:20,imageId:id('1'),wizardImageId:id('2'),registryRepository:'registry.example.test/system/successor',registryReference:'registry.example.test/system/successor@'+id('7'),candidateEvidencePath:'test-results/successor/candidate-results.json'};
 function verify(proof,changes={}){const bytes=Buffer.from(JSON.stringify(proof));return service.inputs(Buffer.from(JSON.stringify({...release,candidateEvidenceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),...changes})),bytes,profile);}
 assert.equal(verify(value).release.sourceLayout,'system-monorepo-v1');
 for(const mutate of [p=>delete p.evidence.guidedPreview,p=>p.evidence.guidedPreview=fixture.proof(id('2')),p=>p.ciIdentity.candidateJobId++,p=>p.wizardSourceTree='e'.repeat(40),p=>p.evidence.guidedPreview.candidate.fixtureCandidateJobId++]){const changed=structuredClone(value);mutate(changed);assert.throws(()=>verify(changed),/System-Beta-authority/);}
 assert.throws(()=>verify(value,{wizardRevision:wizardTree}),/invalid-successor-source/);
 assert.throws(()=>verify(value,{candidateEvidenceSha256:'f'.repeat(64)}),/evidence-hash/);
});

test('candidate GitLab transport keeps credentials on fixed origin and bounds pagination',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {CandidateGitLabService}=require('../../dist/modules/host/candidateGitlab.service');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-api-')),token=path.join(directory,'token');
 fs.writeFileSync(token,'private-test-token',{mode:0o600});
 try {
  const calls=[];
  const api=new CandidateGitLabService(async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify([calls.length]),{status:200,headers:calls.length===1?{'x-next-page':'2'}:{}});}).connect('https://gitlab.example.test',token);
  assert.deepEqual(await api.pages('/projects/4/jobs'),[1,2]);
  assert.equal(calls[0].url,'https://gitlab.example.test/api/v4/projects/4/jobs?per_page=100&page=1');
  assert.equal(calls[1].options.headers['PRIVATE-TOKEN'],'private-test-token');
  assert.equal(calls[0].options.redirect,'manual');
  await assert.rejects(api.get('//attacker.test'),/invalid-GitLab-endpoint/);
  const redirect=new CandidateGitLabService(async()=>new Response(null,{status:302,headers:{location:'https://attacker.test'}})).connect('https://gitlab.example.test',token);
  await assert.rejects(redirect.get('/user'),/GitLab-API-request-failed/);
  fs.chmodSync(token,0o644);
  assert.throws(()=>new CandidateGitLabService().connect('https://gitlab.example.test',token),/private-GitLab-token/);
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
test('native candidate authority freezes pipeline jobs, historical receipts and paired source publication',async()=>{
 const {CandidateAuthorityService}=require('../../dist/modules/host/candidateAuthority.service'),{hostRequiredJobs,hostComponents}=require('../../dist/modules/host/releaseAuthority.service');
 const host={environment:{},runner:{run(_binary,args){return {stdout:args.at(-1)==='submodule.wizard.path'?'wizard':'https://github.com/example/wizard.git'};}}};
 const service=new CandidateAuthorityService(host,{});
 const release={format:'system-successor-release-v1',projectId:4,pipelineId:17,candidateJobId:29,sourceRevision:revision,sourceTree,wizardRevision:wizardTree,imageId:id('1'),wizardImageId:id('2'),registryRepository:'registry.example.test/system/successor',registryReference:'registry.example.test/system/successor@'+id('7'),wizardRegistryReference:'registry.example.test/system/successor-wizard@'+id('8'),candidateEvidenceSha256:'a'.repeat(64)};
 const evidence={images:{wizard:release.wizardImageId}},releaseBytes=Buffer.from(JSON.stringify(release)),evidenceBytes=Buffer.from(JSON.stringify(evidence));
 const fixture=()=>{
  const project={default_branch:'main',container_registry_image_prefix:'registry.example.test/system',only_allow_merge_if_pipeline_succeeds:true},branch={protected:true,commit:{id:revision}},pipeline={sha:revision,ref:'main',source:'push',status:'success'};
  const names=[...hostRequiredJobs,'test:codeql',...hostComponents.map(name=>'test:isolated: ['+name+']'),'test:wizard-browser','deploy:dockerhub','deploy:github'];
  const jobs=names.map((name,index)=>({id:name==='test:platform-candidate'?29:index+100,name,status:'success',allow_failure:false,pipeline:{id:17},commit:{id:revision}}));
  const job=name=>jobs.find(row=>row.name===name),controller='docker.io/example/system@'+id('7'),wizard='docker.io/example/wizard@'+id('8');
  const publication={format:'system-public-release-v1',publicationJobId:job('deploy:dockerhub').id,versionTag:null,platform:'linux/amd64',...Object.fromEntries(['projectId','pipelineId','sourceRevision','sourceTree','wizardRevision'].map(key=>[key,release[key]])),upstreamRelease:Object.fromEntries(['projectId','pipelineId','candidateJobId','registryReference','candidateEvidenceSha256'].map(key=>[key,release[key]]))};
  for(const [role,reference,imageId,sourceRevision] of [['controller',controller,release.imageId,revision],['wizard',wizard,release.wizardImageId,wizardTree]])publication[role]={reference,imageId,sourceRevision,configDigest:id('9')};
  const source={format:'system-wizard-source-publication-v1',projectId:4,pipelineId:17,publicationJobId:job('deploy:github').id,systemRevision:revision,wizardRevision:wizardTree,repository:'https://github.com/example/wizard.git',ref:'refs/heads/system-release/'+wizardTree};
  const api={get:async path=>path.includes('/branches/')?branch:path.includes('/pipelines/')?pipeline:project,pages:async()=>jobs,raw:async path=>path.endsWith('candidate-results.json')?evidenceBytes:path.endsWith('test-results/successor/release.json')?releaseBytes:path.endsWith('wizard-source.json')?Buffer.from(JSON.stringify(source)):path.includes('.gitmodules')?Buffer.from('mapping'):Buffer.from(JSON.stringify(publication))};
  return {project,branch,pipeline,jobs,job,api,publication,source,controller,wizard};
 };
 const verify=f=>service.pipeline(f.api,release,releaseBytes,evidenceBytes);
 const valid=fixture();assert.equal((await verify(valid)).candidateJobId,29);assert.equal((await service.publicPair(valid.api,release,evidence,valid.controller,valid.wizard)).sourceJobId,valid.job('deploy:github').id);
 for(const mutate of [f=>f.project.only_allow_merge_if_pipeline_succeeds=false,f=>f.branch.protected=false,f=>f.branch.commit.id='e'.repeat(40),f=>f.pipeline.source='merge_request_event',f=>f.pipeline.status='running',f=>f.job('build').allow_failure=true,f=>f.job('test:platform-candidate').id++,f=>f.jobs.push({...f.job('build')}),f=>f.jobs.push({name:'internal-extra',status:'failed'}),f=>f.api.raw=async()=>Buffer.from('different')]){
  const f=fixture();mutate(f);await assert.rejects(verify(f));
 }
 for(const name of [...hostRequiredJobs,'test:codeql',...hostComponents.map(name=>'test:isolated: ['+name+']')])for(const status of ['failed','skipped','canceled','running']){const f=fixture();f.job(name).status=status;await assert.rejects(verify(f),/required-job-not-successful/);}
 const historical=fixture();historical.branch.commit.id='e'.repeat(40);assert.equal((await service.pipeline(historical.api,release,releaseBytes,evidenceBytes,false)).candidateJobId,29);
 const optional=fixture();optional.job('deploy:github').status='failed';optional.pipeline.status='failed';assert.equal((await verify(optional)).GitHubMirrorFailed,true);await assert.rejects(service.publicPair(optional.api,release,evidence,optional.controller,optional.wizard),/source-publication-job-not-successful/);
 for(const mutate of [f=>f.job('test:wizard-browser').allow_failure=true,f=>f.job('deploy:dockerhub').commit.id='e'.repeat(40),f=>f.publication.upstreamRelease.candidateJobId++,f=>f.publication.wizard.imageId=id('3'),f=>f.source.ref='refs/heads/main',f=>f.source.repository='https://github.com/unrelated/wizard.git',f=>f.pipeline.source='web']){
  const f=fixture();mutate(f);await assert.rejects(service.publicPair(f.api,release,evidence,f.controller,f.wizard));
 }
});
