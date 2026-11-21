'use strict';
const fs=require('node:fs'),path=require('node:path');
const settingsContract=require('../../project-bootstrap/preview-setup/settings');
const environmentState=require('../../project-bootstrap/wizard-environments/state');
const evidenceContract=require('../../gitlab/guided-preview-evidence');
const platform=require('./guided-preview-platform');
const {execute}=require('./system-beta-fixture-helper');
const {syncSession,waitForRegistration}=require('./wizard-registration');
function requireValue(value,code){if(!value)throw Object.assign(Error(code),{noRetry:true});}
function settings(candidate){
  requireValue(candidate.spec.fullAcceptance===true&&candidate.spec.guidedPreviewAcceptance===true&&/^[a-f0-9]{24}$/.test(candidate.id),'system-beta-owned-disposable-platform-required');
  const value=settingsContract.settings(candidate.spec.guidedPreviewSettings);
  requireValue(value.version===2&&value.wizard.mode==='existing'&&!value.review.enabled&&value.beta.enabled,'system-beta-shared-source-settings-required');
  return value;
}
async function production(candidate){
  const value=await platform.node(candidate,function(){
    const fs=require('fs'),crypto=require('crypto');
    const {readReceipt}=require('/system/sync/dist/ProjectBootstrap');
    const main=fs.readFileSync('/state/.docker.env');
    const receipt=readReceipt(fs.readFileSync('/state/.projects.env/.wizard.env','utf8'));
    if(receipt?.defaultProject!==true||receipt.template!=='wizard'||receipt.state!=='complete'||receipt.repository?.systemProject!==true)throw Error();
    return {mainSha256:crypto.createHash('sha256').update(main).digest('hex'),repository:receipt.repository,environment:receipt.wizardWorkflow?.environments};
  },{});
  value.runningImage=(await candidate.inner(['inspect','--format','{{.Image}}','system_wizard_1'])).trim();
  requireValue(/^sha256:[a-f0-9]{64}$/.test(value.runningImage),'system-beta-production-image-required');return value;
}
function unchanged(before,after){requireValue(before.mainSha256===after.mainSha256&&before.runningImage===after.runningImage,'guided-preview-production-changed');}
async function verifierContract(){
  // A contract fixture deliberately runs outside GitLab; only native lifecycle
  // observations below establish deployment and TLS behavior.
  return require('../gitlab/system-beta')();
}

async function helper(candidate,binding,action,jobId,verifier){
  const request={action,kind:'beta',delivery:'system',projectId:binding.projectId,pipelineId:binding.pipelineId,jobId,
    sourceCommit:binding.sourceCommit,mrIid:0,operation:binding.operation};
  const input={fixtureNamespace:'system-beta-contract-fixture-v1',verifierMode:verifier.mode,verifierPassed:verifier.passed,
    negativeGatesPassed:verifier.negativeGatesPassed,owner:candidate.id,request,helperImage:binding.helperImage,
    wizardImageId:binding.wizardImageId,wizardImageRef:binding.wizardImageRef,fixtureCandidateJobId:binding.candidateJobId};
  const name='wizard-environment-'+binding.projectId+'-'+jobId;let attempted=false;
  try{
    requireValue(!(await candidate.inner(['container','ls','--all','--filter','name=^/'+name+'$','--format','{{.Names}}'])).trim(),'system-beta-helper-name-conflict');
    attempted=true;
    const id=(await candidate.inner(['create','--name',name,'--network','none','--read-only','--memory','256m','--cpus','1','--pids-limit','128',
      '--tmpfs','/tmp:rw,nosuid,noexec,size=16m','--label','system.wizard.environments.helper='+binding.operation,
      '--label','org.system-bootstrapper.disposable-beta='+candidate.id,
      '--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
      '--mount','type=volume,source=system_templates,target=/templates','--mount','type=volume,source=system_ssl,target=/ssl,readonly',
      '--entrypoint','node',binding.helperImage,'-e','('+execute.toString()+')(JSON.parse(process.argv[1])).then(()=>console.log("completed")).catch(()=>{console.error("disposable-beta-failed");process.exitCode=1;})',JSON.stringify(input)])).trim();
    requireValue(/^[a-f0-9]{64}$/.test(id),'system-beta-helper-identity-invalid');
    await candidate.inner(['start','--attach',id],{timeout:480000});
  }finally{
    if(attempted){
      const names=(await candidate.inner(['container','ls','--all','--filter','name=^/'+name+'$','--format','{{.Names}}'])).trim();
      if(names){const own=JSON.parse(await candidate.inner(['inspect',name]));requireValue(own.length===1&&own[0].Image===binding.helperImage&&
        own[0].Config.Labels?.['system.wizard.environments.helper']===binding.operation&&own[0].Config.Labels?.['org.system-bootstrapper.disposable-beta']===candidate.id,'system-beta-helper-owner-changed');
        await candidate.inner(['stop','--time','120',own[0].Id],{timeout:130000});await candidate.inner(['rm',own[0].Id]);}
    }
  }
}
async function sharedSource(candidate,repository,token,desired){
  requireValue(repository.path===desired.namespace+'/'+desired.wizard.project,'system-beta-existing-shared-project-required');
  requireValue(typeof candidate.spec.sharedSourceBundle==='string'&&path.isAbsolute(candidate.spec.sharedSourceBundle),'system-beta-exact-source-bundle-required');
  const branch='system-candidate-'+candidate.id,temporary='/tmp/system-beta-source-'+candidate.id;
  await candidate.inner(['exec','-i','system_bootstrapper_1','sh','-ec','umask 077; cat > "$1"','sh',temporary+'.bundle'],{inputFile:candidate.spec.sharedSourceBundle});
  try{
    await platform.node(candidate,async function(input){
      const fs=require('fs'),{spawnSync}=require('child_process');
      const run=(args,env={})=>{const r=spawnSync('git',args,{env:{...process.env,...env},encoding:'utf8',timeout:180000,maxBuffer:1024*1024});if(r.error||r.status!==0)throw Error();return r.stdout.trim();};
      run(['clone','--bare',input.temporary+'.bundle',input.temporary]);
      if(run(['--git-dir',input.temporary,'rev-parse',input.source+'^{tree}'])!==input.tree||
        run(['--git-dir',input.temporary,'rev-parse',input.source+':wizard'])!==input.wizardTree)throw Error();
      run(['--git-dir',input.temporary,'push','-o','ci.skip',input.url,input.source+':refs/heads/'+input.branch],{
        GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+Buffer.from('oauth2:'+input.token).toString('base64'),GIT_TERMINAL_PROMPT:'0'});
    },{temporary,source:candidate.spec.sourceRevision,tree:candidate.spec.sourceTree,wizardTree:candidate.spec.wizardSourceTree,
      url:candidate.gitlabUrl+'/'+repository.path+'.git',branch,token},{timeout:240000});
    await candidate.api('/projects/'+repository.id,token,'PUT',{default_branch:branch,ci_config_path:'.gitlab-ci.yml',only_allow_merge_if_pipeline_succeeds:true,only_allow_merge_if_all_discussions_are_resolved:true});
    await candidate.api('/projects/'+repository.id+'/protected_branches',token,'POST',{name:branch,push_access_level:40,merge_access_level:40});
    const selected=await candidate.api('/projects/'+repository.id+'/repository/branches/'+branch,token);
    requireValue(selected.commit?.id===candidate.spec.sourceRevision&&selected.protected===true,'system-beta-shared-source-identity-changed');
    return {...repository,defaultBranch:branch};
  }finally{await candidate.inner(['exec','system_bootstrapper_1','rm','-rf','--',temporary,temporary+'.bundle']);}
}
async function publishImages(candidate,repository,token){
  return platform.node(candidate,async function(input){
    const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'beta-registry-'));
    const run=(args,stdin)=>{const r=spawnSync('docker',['--config',root,...args],{input:stdin,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});if(r.error||r.status!==0)throw Error();return r.stdout.trim();};
    try{
      run(['login','--username','oauth2','--password-stdin',input.registry],input.token);
      const result={};for(const [role,id]of Object.entries(input.images)){
        const repository=input.registry+'/'+input.path+'/'+(role==='helper'?'successor':'successor-wizard'),tag=repository+':fixture-'+input.owner;
        run(['tag',id,tag]);run(['push',tag]);
        const inspected=JSON.parse(run(['image','inspect',tag]))[0],reference=inspected.RepoDigests.find(ref=>ref.startsWith(repository+'@sha256:'));
        if(inspected.Id!==id||!reference)throw Error();result[role]={id,reference};
      }return result;
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  },{registry:'registry.candidate.test:5050',path:repository.path,owner:candidate.id,token,
    images:{helper:candidate.spec.images.candidate.id,wizard:candidate.spec.images.wizard.id}},{timeout:480000});
}
async function run(candidate){
  const desired=settings(candidate),sync=syncSession(candidate);
  const before=await candidate.stage('system-beta-production-baseline',async()=>{
    await waitForRegistration(candidate,sync);
    return production(candidate);
  });
  const evidence={version:2,sourceLayout:'system-monorepo-v1',fixtureNamespace:'system-beta-contract-fixture-v1',
    acceptanceScope:'native-lifecycle-with-contract-verifier',productionMainSha256:before.mainSha256,productionImageId:before.runningImage};
  candidate.evidence.guidedPreview=evidence;
  let token,mintAttempted=false,mintConfirmed=false,binding,deployAttempted=false,repository,images,pipelineCount;
  const fixturePipelineId=candidate.spec.ciIdentity?.pipelineId,fixtureCandidateJobId=candidate.spec.ciIdentity?.candidateJobId;
  const fixtureDeployJobId=1000000001,fixtureStopJobId=1000000002;
  requireValue([fixturePipelineId,fixtureCandidateJobId].every(value=>Number.isSafeInteger(value)&&value>0)&&
    candidate.spec.sourceLayout==='system-monorepo-v1','system-beta-candidate-identities-required');
  const inventory=async()=>{const rows=await candidate.api('/projects/'+before.repository.id+'/pipelines?per_page=100',token);requireValue(Array.isArray(rows)&&rows.length<100&&rows.every(row=>Number.isSafeInteger(row.id)&&row.id>0)&&new Set(rows.map(row=>row.id)).size===rows.length,'system-beta-pipeline-inventory-required');return rows;};
  const pipelineIds=rows=>rows.map(row=>row.id).sort((a,b)=>a-b);
  const identity=row=>({projectId:row.projectId,pipelineId:row.pipelineId,jobId:row.jobId,mrIid:row.mrIid,sourceCommit:row.sourceCommit,
    operation:row.operation,generation:row.generation,state:row.state,imageDigest:row.imageRef.split('@').at(-1)});
  try{
    await candidate.stage('system-beta-native-source',async()=>{
      mintAttempted=true;const auth=await candidate.rails("require 'json';t=User.find_by_username('root').personal_access_tokens.create!(name:'guided-preview-acceptance-"+candidate.id+"',scopes:['api','write_repository','read_registry','write_registry'],expires_at:Date.tomorrow);puts JSON.generate(token:t.token)");
      requireValue(typeof auth.token==='string'&&auth.token.length>10,'guided-preview-credential-required');token=auth.token;mintConfirmed=true;
      const previousPipelines=pipelineIds(await inventory());repository=await sharedSource(candidate,before.repository,token,desired);
      const project=await candidate.api('/projects/'+repository.id,token);
      requireValue(project.path_with_namespace===repository.path&&project.visibility==='private','system-beta-owned-source-changed');
      repository.namespaceId=project.namespace.id;images=await publishImages(candidate,repository,token);
      // ci.skip persists an empty skipped pipeline asynchronously. Settle that
      // exact fixture push before measuring whether native setup starts builds.
      await candidate.wait(async()=>{
        const rows=await inventory(),added=rows.filter(row=>!previousPipelines.includes(row.id));
        if(!added.length)return false;
        requireValue(added.length===1&&previousPipelines.every(id=>rows.some(row=>row.id===id))&&
          added[0].sha===candidate.spec.sourceRevision&&added[0].ref===repository.defaultBranch&&added[0].source==='push'&&added[0].status==='skipped','system-beta-source-pipeline-invalid');
        const jobs=await candidate.api('/projects/'+repository.id+'/pipelines/'+added[0].id+'/jobs?per_page=100',token);
        requireValue(Array.isArray(jobs)&&jobs.length===0,'system-beta-source-pipeline-jobs-present');
        pipelineCount=pipelineIds(rows);return true;
      },60000);
      evidence.candidate={projectId:repository.id,namespaceId:repository.namespaceId,fixturePipelineId,fixtureCandidateJobId,
        sourceCommit:candidate.spec.sourceRevision,sourceTree:candidate.spec.sourceTree,wizardSourceTree:candidate.spec.wizardSourceTree,
        helperImage:images.helper.id,wizardImageId:images.wizard.id,helperRegistryDigest:images.helper.reference.split('@').at(-1),
        wizardRegistryDigest:images.wizard.reference.split('@').at(-1),pipelineEvidence:'contract-fixture'};
    });
    await candidate.stage('system-beta-native-setup',async()=>{
      const plan=await sync('/projects/wizard/preview-setup/preflight',{settings:desired});
      requireValue(plan.version===2&&plan.productionChanged===false&&plan.manualDeployment===true&&plan.source?.id===repository.id&&
        plan.source.sourceRevision===candidate.spec.sourceRevision,'system-beta-native-preflight-mismatch');
      let job=await sync('/projects/wizard/preview-setup/apply',{settings:desired,previewHash:plan.previewHash});
      await candidate.wait(async()=>{if(job.state==='running')job=await sync('/projects/jobs/'+job.id);requireValue(job.state!=='failed','system-beta-native-setup-failed');return job.state!=='running';},180000);
      const status=await sync('/projects/wizard/preview-setup');
      requireValue(status.version===2&&status.phase==='ready'&&status.productionChanged===false&&status.manualDeployment===true,'system-beta-native-setup-not-ready');
      requireValue(JSON.stringify(pipelineIds(await inventory()))===JSON.stringify(pipelineCount),'system-beta-setup-started-build');
      const current=await production(candidate);unchanged(before,current);
      requireValue(current.environment?.managementMode==='system-monorepo'&&current.environment.settings.review.enabled===false,'system-beta-review-reservation-present');
      evidence.setup={projectId:repository.id,namespaceId:repository.namespaceId,sourceCommit:plan.source.sourceRevision,operation:status.operation,
        native:true,productionChanged:false,reviewEnabled:false,betaEnabled:true,noBuildStarted:true};
    });
    await candidate.stage('system-beta-contract-verifier',async()=>{evidence.verifier=await verifierContract(candidate);});
    await candidate.stage('system-beta-native-binding',async()=>{
      const input={operation:evidence.setup.operation,projectId:repository.id,projectPath:repository.path,namespaceId:repository.namespaceId,
        defaultBranch:repository.defaultBranch,pipelineId:fixturePipelineId,candidateJobId:fixtureCandidateJobId,sourceCommit:candidate.spec.sourceRevision,
        wizardSourceTree:candidate.spec.wizardSourceTree,helperImage:images.helper.id,wizardImageId:images.wizard.id,wizardImageRef:images.wizard.reference};
      binding=await platform.node(candidate,async function(input){
        const fs=require('fs'),path=require('path'),os=require('os');const {main}=require('/system/project-bootstrap/system-beta/bind');
        const root=fs.mkdtempSync(path.join(os.tmpdir(),'beta-binding-')),file=path.join(root,'input.json');
        try{fs.writeFileSync(file,JSON.stringify(input),{mode:0o600});const plan=await main(['plan',file]);await main(['apply',file,plan.planHash]);return plan.binding;}
        finally{fs.rmSync(root,{recursive:true,force:true});}
      },input);
      evidence.beta={bindingVerified:true,fixtureDeployJobId,fixtureStopJobId};
    });
    try{
      await candidate.stage('system-beta-native-deploy',async()=>{
        deployAttempted=true;await helper(candidate,binding,'deploy',fixtureDeployJobId,evidence.verifier);
        const current=await production(candidate);unchanged(before,current);
        const active=current.environment?.deployments?.beta?.active;
        requireValue(active?.state==='active'&&active.projectId===binding.projectId&&active.pipelineId===fixturePipelineId&&active.jobId===fixtureDeployJobId&&
          active.sourceCommit===binding.sourceCommit&&active.operation===binding.operation&&active.imageRef===binding.wizardImageRef,'system-beta-active-identity-mismatch');
        const inspected=JSON.parse(await candidate.inner(['inspect',active.containerName]));
        requireValue(inspected.length===1&&inspected[0].State.Running===true&&inspected[0].Image===binding.wizardImageId&&
          Object.entries(environmentState.labels(active)).every(([key,value])=>inspected[0].Config.Labels?.[key]===value),'system-beta-image-ownership-mismatch');
        evidence.beta.deployment=identity(active);evidence.beta.imageOwnershipVerified=true;
        const page=await candidate.request('https://'+desired.beta.host+'/',{});
        requireValue(page.status===200&&/<!doctype html|<html/i.test(page.body),'system-beta-https-page-unavailable');evidence.beta.tlsVerified=true;
      });
    }finally{
      if(deployAttempted)await candidate.stage('system-beta-native-stop',async()=>{
        await helper(candidate,binding,'stop',fixtureStopJobId,evidence.verifier);
        const current=await production(candidate);unchanged(before,current);const slot=current.environment?.deployments?.beta,tombstone=slot?.tombstone;
        requireValue(!slot?.active&&!slot?.pending&&!slot?.retired?.length&&tombstone?.state==='stopped'&&tombstone.jobId===fixtureDeployJobId&&
          tombstone.pipelineId===fixturePipelineId&&tombstone.operation===binding.operation&&tombstone.imageRef===binding.wizardImageRef,'system-beta-stop-identity-mismatch');
        evidence.beta.stopped=identity(tombstone);evidence.beta.stoppedThroughPipelineId=slot.stoppedThroughPipelineId;
        requireValue(!(await candidate.inner(['container','ls','--all','--filter','name=^/'+tombstone.containerName+'$','--format','{{.Names}}'])).trim(),'system-beta-container-remains');
        requireValue(!(await candidate.inner(['network','ls','--filter','name=^'+tombstone.networkName+'$','--format','{{.Name}}'])).trim(),'system-beta-network-remains');
        requireValue(!(await candidate.inner(['container','ls','--all','--filter','label=org.system-bootstrapper.disposable-beta='+candidate.id,'--format','{{.Names}}'])).trim(),'system-beta-helper-remains');
        const unlocked=await platform.node(candidate,function(){return !require('fs').existsSync('/state/.projects.env/.wizard.env.environments.lock');},{});
        requireValue(unlocked,'system-beta-lease-remains');Object.assign(evidence.beta,{containerRemoved:true,networkRemoved:true,helperRemoved:true,leaseReleased:true});
      });
    }
    return evidence;
  }finally{
    try{await candidate.stage('guided-preview-production-retained',async()=>{const after=await production(candidate);unchanged(before,after);evidence.productionRetained={mainSha256:after.mainSha256,runningImage:after.runningImage};});}
    finally{if(mintAttempted)await candidate.stage('guided-preview-temporary-credential-revoked',async()=>{
      if(!mintConfirmed)evidence.credentialCleanupUncertain=true;
      const query="User.find_by_username('root').personal_access_tokens.where(name:'guided-preview-acceptance-"+candidate.id+"',revoked:false)";
      const revoked=await candidate.rails("require 'json';"+query+".find_each(&:revoke!);puts JSON.generate(activeCount:"+query+".count)");
      requireValue(revoked.activeCount===0&&mintConfirmed,'guided-preview-credential-cleanup-uncertain');
      const response=await candidate.request(candidate.gitlabUrl+'/api/v4/user',{headers:{'PRIVATE-TOKEN':token}});
      requireValue(response.status===401,'guided-preview-credential-still-active');evidence.temporaryCredentialRevoked=true;
    });}
  }
}
module.exports={run,settings,unchanged,production,syncSession,verifierContract,helper,sharedSource,publishImages};
