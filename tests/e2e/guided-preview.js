'use strict';
// Shared real-platform acceptance adapter. The reviewed native driver selects
// the operator instance explicitly; isolated transports test its contracts only.
const binding=require('../../project-bootstrap/wizard-source-primary/binding');
const environmentState=require('../../project-bootstrap/wizard-environments/state');
const settingsContract=require('../../project-bootstrap/preview-setup/settings');
const required=['build:source','test:browser','build:wizard','test:wizard'];
const terminal=new Set(['success','failed','canceled','skipped']);
function requireValue(value,code){if(!value)throw Object.assign(Error(code),{noRetry:true});}
function settings(candidate) {
  requireValue((candidate.spec.fullAcceptance===true||candidate.spec.operatorAcceptance===true)&&candidate.spec.guidedPreviewAcceptance===true,'guided-preview-explicit-owned-platform-required');
  requireValue(/^[a-f0-9]{24}$/.test(candidate.id),'guided-preview-owner-required');
  const value=settingsContract.settings(candidate.spec.guidedPreviewSettings);
  requireValue(value.wizard.mode==='import'&&(!value.system||value.system.mode==='import'),'guided-preview-fresh-source-import-required');
  return value;
}
async function controller(candidate,action) {
  const script="try{const fs=require('fs'),path=require('path'),crypto=require('crypto');const state='/state';const binding=require('/system/project-bootstrap/wizard-source-primary/binding');const main=fs.readFileSync(path.join(state,'.docker.env'),'utf8');const result=binding.read(path.join(state,'.projects.env/.wizard.env'));const receipt=result.receipt;"+action+"}catch{process.exitCode=1;}";
  try{return JSON.parse(await candidate.inner(['exec','system_bootstrapper_1','node','-e',script]));}
  catch{throw Error('guided-preview-native-controller-proof-failed');}
}
async function production(candidate,initial=false) {
  const result=await controller(candidate,
    (initial?"if(binding.primary(receipt)||receipt.wizardWorkflow)throw Error();const {Adoption}=require('/system/project-bootstrap/wizard-source-primary/run');const publicImage=new Adoption({mainConfig:path.join(state,'.docker.env'),request:async()=>undefined}).retainedInstallation(main);": "const publicImage=null;")+
    "process.stdout.write(JSON.stringify({mainSha256:crypto.createHash('sha256').update(main).digest('hex'),publicImage,projectId:receipt.repository.id,projectPath:receipt.repository.path,managementMode:receipt.repository.managementMode,sourcePrimary:receipt.sourcePrimary,build:receipt.wizardWorkflow?.build,environment:receipt.wizardWorkflow?.environments}));");
  result.runningImage=(await candidate.inner(['inspect','--format','{{.Image}}','system_wizard_1'])).trim();
  requireValue(/^sha256:[a-f0-9]{64}$/.test(result.runningImage),'guided-preview-production-image-required');
  if(initial) {
    const accepted=(await candidate.inner(['image','inspect','--format','{{.Id}}',result.publicImage])).trim();
    requireValue(accepted===result.runningImage,'guided-preview-running-public-image-mismatch');
  }
  return result;
}
function unchanged(before,after) {
  requireValue(before.mainSha256===after.mainSha256&&before.runningImage===after.runningImage,'guided-preview-production-changed');
}
function nativeJobs(pipeline,jobs) {
  binding.pipelineChecks(pipeline,jobs);
  requireValue(required.every(name=>jobs.find(job=>job.name===name)?.runner?.id),'guided-preview-real-runner-jobs-required');
  return jobs.filter(job=>required.includes(job.name)).map(job=>({id:job.id,name:job.name,status:job.status,runnerId:job.runner.id}));
}
function syncSession(candidate) {
  let accessToken,issuedAt=0;
  const now=()=>candidate.now?candidate.now():Date.now();
  const login=async()=>{
    const response=await candidate.request(candidate.url+'/login',{method:'POST',headers:{Host:new URL(candidate.url).host,'Content-Type':'application/json'},
      body:JSON.stringify({username:candidate.secrets.user,password:candidate.secrets.password})});
    requireValue(response.status===200,'guided-preview-sync-login-failed');
    let value;try{value=JSON.parse(response.body);}catch{throw Error('guided-preview-sync-login-failed');}
    requireValue(typeof value.accessToken==='string'&&value.accessToken.length>0,'guided-preview-sync-login-failed');
    accessToken=value.accessToken;issuedAt=now();
  };
  return async(route,payload)=>{
    // Sync JWTs expire after 20 minutes. Long native setup may spend most of
    // that time in Rails or CI; renew before requests without replaying writes.
    if(!accessToken||now()-issuedAt>=15*60000)await login();
    const send=()=>candidate.request(candidate.url+route,{method:payload===undefined?'GET':'POST',headers:{Host:new URL(candidate.url).host,
      Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    let response=await send();
    // The native JWT guard returns 403 for an expired token, 401 if absent.
    if(payload===undefined&&[401,403].includes(response.status)){await login();response=await send();}
    requireValue(response.status>=200&&response.status<300,'guided-preview-sync-request-failed');
    try{return JSON.parse(response.body);}catch{throw Error('guided-preview-sync-result-invalid');}
  };
}
async function run(candidate) {
  const desired=settings(candidate),before=await production(candidate,true);
  let token,mintAttempted=false,mintConfirmed=false;
  const evidence={productionMainSha256:before.mainSha256,productionImageId:before.runningImage,initialRegistrationId:before.projectId,betaEnabled:desired.beta.enabled};
  candidate.evidence.guidedPreview=evidence;
  // This adapter requires real HTTPS/DNS/trust/public-source and native CI
  // dependencies prepared by the existing platform harness. It creates no CA,
  // accepted-release receipt, alternate CI producer, or privileged test bypass.
  const sync=syncSession(candidate);
  const apply=async()=>{
    const preview=await sync('/projects/wizard/preview-setup/preflight',{settings:desired});
    requireValue(preview.productionChanged===false&&preview.runnerReady===true,'guided-preview-preflight-proof-failed');
    let job=await sync('/projects/wizard/preview-setup/apply',{settings:desired,previewHash:preview.previewHash});
    await candidate.wait(async()=>{
      if(job.state==='running')job=await sync('/projects/jobs/'+job.id);
      requireValue(job.state!=='failed','guided-preview-setup-job-failed');return job.state!=='running';
    },1800000);
    return sync('/projects/wizard/preview-setup');
  };
  try {
    await candidate.stage('guided-preview-fresh-public-registration',async()=>{
      const existing=await sync('/projects/wizard/preview-setup');requireValue(existing.phase==='not-started','guided-preview-fresh-setup-required');
      mintAttempted=true;
      const auth=await candidate.rails("require 'json';t=User.find_by_username('root').personal_access_tokens.create!(name:'guided-preview-acceptance-"+candidate.id+"',scopes:['api'],expires_at:Date.tomorrow);puts JSON.generate(token:t.token)");
      requireValue(typeof auth.token==='string'&&auth.token.length>10,'guided-preview-credential-required');token=auth.token;mintConfirmed=true;
      // Both destinations must be absent before setup. A fresh database alone
      // does not prove that old source-project IDs were not reused.
      const projects=await candidate.api('/projects?per_page=100',token);
      requireValue(Array.isArray(projects)&&projects.length<100,'guided-preview-project-inventory-required');
      for(const name of [desired.wizard.project,desired.system?.project].filter(Boolean))
        requireValue(!projects.some(project=>project.path_with_namespace===desired.namespace+'/'+name),'guided-preview-source-destination-already-exists');
      evidence.previousProjectIds=projects.map(project=>project.id);
    });
    let setup,project,pipeline,reviewPipeline,mergedPipeline,reviewJobs,mergedJobs,mr,reviewCommit,environmentOperation;
    await candidate.stage('guided-preview-native-source-push-and-build',async()=>{
      setup=await apply();requireValue(['waiting-build','ready'].includes(setup.phase),'guided-preview-source-import-failed');
      requireValue(Number.isSafeInteger(setup.projects?.wizard?.id)&&!evidence.previousProjectIds.includes(setup.projects.wizard.id)&&setup.projects.wizard.id!==before.projectId,'guided-preview-fresh-wizard-id-required');
      if(desired.system)requireValue(Number.isSafeInteger(setup.projects.system?.id)&&setup.projects.system.id!==setup.projects.wizard.id&&!evidence.previousProjectIds.includes(setup.projects.system.id),'guided-preview-fresh-system-id-required');
      project=await candidate.api('/projects/'+setup.projects.wizard.id,token);
      requireValue(project.visibility==='private'&&project.path_with_namespace===desired.namespace+'/'+desired.wizard.project&&project.ci_config_path==='.gitlab/primary.yml','guided-preview-created-source-project-mismatch');
      requireValue(project.only_allow_merge_if_pipeline_succeeds===true&&project.only_allow_merge_if_all_discussions_are_resolved===true,'guided-preview-native-merge-gates-required');
      const branch=await candidate.api('/projects/'+project.id+'/repository/branches/'+encodeURIComponent(project.default_branch),token);
      await candidate.wait(async()=>{
        const runs=await candidate.api('/projects/'+project.id+'/pipelines?ref='+encodeURIComponent(project.default_branch)+'&sha='+branch.commit.id+'&source=push',token);
        pipeline=runs.find(row=>row.sha===branch.commit.id&&row.source==='push');return !!pipeline&&terminal.has(pipeline.status);
      },900000);
      const jobs=await candidate.api('/projects/'+project.id+'/pipelines/'+pipeline.id+'/jobs?per_page=100&include_retried=false',token);
      evidence.source={projectId:project.id,systemProjectId:setup.projects.system?.id,sourceCommit:pipeline.sha,pipelineId:pipeline.id,source:pipeline.source,jobs:nativeJobs(pipeline,jobs)};
      unchanged(before,await production(candidate));
    });
    await candidate.stage('guided-preview-native-evidence-adoption',async()=>{
      setup=await apply();requireValue(setup.phase==='ready','guided-preview-adoption-not-ready');
      const current=await production(candidate);unchanged(before,current);
      requireValue(current.managementMode==='source-primary'&&current.projectId===project.id&&current.sourcePrimary?.adoptionCommit===pipeline.sha&&current.build?.phase==='candidate-verified'&&current.environment?.phase==='ready','guided-preview-canonical-adoption-proof-failed');
      environmentOperation=current.environment.operation;
      requireValue(/^[a-f0-9]{48}$/.test(environmentOperation||''),'guided-preview-environment-operation-required');
      const actual=await controller(candidate,"binding.validate(receipt);process.stdout.write(JSON.stringify({receipt}));");
      const artifact=await candidate.api('/projects/'+project.id+'/jobs/'+evidence.source.jobs.find(job=>job.name==='build:wizard').id+'/artifacts/build-evidence.json',token);
      const native=await binding.evidence(route=>candidate.api('/'+route,token),actual.receipt,pipeline.id,pipeline.sha,artifact.imageRef);
      requireValue(native.build.unitTests&&native.smoke.renderedUI&&/^.+@sha256:[a-f0-9]{64}$/.test(artifact.imageRef),'guided-preview-native-artifact-proof-failed');
      Object.assign(evidence.source,{artifactsVerified:true,imageDigest:artifact.imageRef.split('@').at(-1)});
      const retained=await controller(candidate,"const {Adoption}=require('/system/project-bootstrap/wizard-source-primary/run');process.stdout.write(JSON.stringify({publicImage:new Adoption({mainConfig:path.join(state,'.docker.env'),request:async()=>undefined}).retainedInstallation(main)}));");
      requireValue(retained.publicImage===before.publicImage,'guided-preview-retained-public-selection-changed');
      evidence.adoptedProjectId=current.projectId;
    });
    const artifacts=async(pipeline,jobs)=>{
      const [build,smoke]=await Promise.all([['build:wizard','build-evidence.json'],['test:wizard','wizard-evidence.json']].map(async([name,file])=>
        candidate.api('/projects/'+project.id+'/jobs/'+jobs.find(job=>job.name===name).id+'/artifacts/'+file,token)));
      requireValue([build,smoke].every(row=>row?.version===1&&row.pipelineId===pipeline.id&&row.sourceCommit===pipeline.sha&&row.imageRef===build.imageRef)&&
        /^.+@sha256:[a-f0-9]{64}$/.test(build.imageRef)&&['unitTests','lint','typecheck','productionBuild'].every(key=>build[key]===true)&&build.testRunner==='vitest'&&
        ['http','renderedUI','projects','spa','configurationBackup','cubeSignature'].every(key=>smoke[key]===true),'guided-preview-native-artifact-proof-failed');
      return {artifactsVerified:true,imageDigest:build.imageRef.split('@').at(-1)};
    };
    const awaitChecks=async(select)=>{
      let selected,jobs;
      await candidate.wait(async()=>{
        selected=await select();if(!selected)return false;
        selected=await candidate.api('/projects/'+project.id+'/pipelines/'+selected.id,token);
        jobs=await candidate.api('/projects/'+project.id+'/pipelines/'+selected.id+'/jobs?per_page=100&include_retried=false',token);
        if(['failed','canceled','skipped'].includes(selected.status)||jobs.some(job=>required.includes(job.name)&&['failed','canceled','skipped'].includes(job.status)))throw Object.assign(Error('guided-preview-native-check-failed'),{noRetry:true});
        return selected.status==='success';
      },900000);
      return {pipeline:selected,jobs,proof:nativeJobs(selected,jobs)};
    };
    const lifecycle=async(kind,pipeline,row)=>{
      const play=async action=>{
        const name=action+':'+kind;
        // Refresh before Stop: GitLab can update its availability after Deploy.
        const available=await candidate.api('/projects/'+project.id+'/pipelines/'+pipeline.id+'/jobs?per_page=100&include_retried=false',token);
        const job=available.find(item=>item.name===name);
        requireValue(job?.status==='manual','guided-preview-native-manual-job-required');
        row[action]={id:job.id,name,status:job.status};
        await candidate.api('/projects/'+project.id+'/jobs/'+job.id+'/play',token,'POST',{});
        let current;await candidate.wait(async()=>{current=await candidate.api('/projects/'+project.id+'/jobs/'+job.id,token);return terminal.has(current.status);},600000);
        row[action]={id:current.id,name,status:current.status,runnerId:current.runner?.id};
        requireValue(current.status==='success'&&current.runner?.id&&current.commit?.id===pipeline.sha&&current.pipeline?.id===pipeline.id,'guided-preview-native-manual-job-failed');
      };
      const identity=deployment=>({projectId:deployment.projectId,pipelineId:deployment.pipelineId,jobId:deployment.jobId,mrIid:deployment.mrIid,
        sourceCommit:deployment.sourceCommit,operation:deployment.operation,generation:deployment.generation,state:deployment.state,imageDigest:deployment.imageRef.split('@').at(-1)});
      let attempted=false,deployment;
      try {
        // Even a timed-out/failed play may have started a real deployment.
        attempted=true;await play('deploy');
        const active=await production(candidate);unchanged(before,active);
        deployment=active.environment?.deployments?.[kind]?.active;
        requireValue(deployment?.state==='active'&&deployment.kind===kind&&deployment.projectId===project.id&&deployment.pipelineId===pipeline.id&&
          deployment.sourceCommit===pipeline.sha&&deployment.jobId===row.deploy.id&&deployment.mrIid===(kind==='review'?row.mergeRequestIid:0)&&
          deployment.operation===environmentOperation&&deployment.generation==='p'+pipeline.id+'-j'+row.deploy.id&&deployment.imageRef.endsWith('@'+row.imageDigest),'guided-preview-active-environment-proof-failed');
        row.deployment=identity(deployment);
        const inspected=JSON.parse(await candidate.inner(['inspect',deployment.containerName]));
        const selectedImage=(await candidate.inner(['image','inspect','--format','{{.Id}}',deployment.imageRef])).trim();
        requireValue(inspected.length===1&&inspected[0].State.Running===true&&inspected[0].Image===selectedImage&&
          Object.entries(environmentState.labels(deployment)).every(([key,value])=>inspected[0].Config.Labels?.[key]===value),'guided-preview-owned-running-environment-image-required');
        const page=await candidate.request('https://'+desired[kind].host+'/',{});
        requireValue(page.status===200&&/<!doctype html|<html/i.test(page.body),'guided-preview-routed-environment-page-required');
      } finally {
        if(attempted)await candidate.stage('guided-preview-native-'+kind+'-stop',async()=>{
          await play('stop');
          const stopped=await production(candidate);unchanged(before,stopped);
          const slot=stopped.environment?.deployments?.[kind];
          requireValue(!slot?.active&&!slot?.pending&&slot?.tombstone?.state==='stopped'&&slot.tombstone.projectId===project.id&&
            slot.tombstone.pipelineId===pipeline.id&&slot.tombstone.jobId===row.deploy.id&&slot.tombstone.kind===kind&&slot.tombstone.operation===environmentOperation&&
            slot.tombstone.generation==='p'+pipeline.id+'-j'+row.deploy.id&&slot.tombstone.imageRef.endsWith('@'+row.imageDigest)&&
            slot.tombstone.sourceCommit===pipeline.sha&&slot.tombstone.mrIid===(kind==='review'?row.mergeRequestIid:0)&&
            slot.stoppedThroughPipelineId>=pipeline.id,'guided-preview-environment-stop-proof-failed');
          if(deployment)requireValue(environmentState.sameGeneration(deployment,slot.tombstone)&&deployment.generation===slot.tombstone.generation&&deployment.imageRef===slot.tombstone.imageRef,'guided-preview-stopped-generation-mismatch');
          row.stopped=identity(slot.tombstone);row.stoppedThroughPipelineId=slot.stoppedThroughPipelineId;
          const remaining=(await candidate.inner(['container','ls','--all','--filter','name=^/'+slot.tombstone.containerName+'$','--format','{{.Names}}'])).trim();
          requireValue(!remaining,'guided-preview-environment-container-not-removed');row.containerRemoved=true;
        });
      }
    };
    await candidate.stage('guided-preview-native-review-deploy-stop',async()=>{
      const branch='guided-review-'+candidate.id;
      reviewCommit=await candidate.api('/projects/'+project.id+'/repository/commits',token,'POST',{branch,start_branch:project.default_branch,
        commit_message:'Exercise owned native preview lifecycle',actions:[{action:'create',file_path:'.guided-preview-proof-'+candidate.id,content:'Owned disposable native preview proof\n'}]});
      mr=await candidate.api('/projects/'+project.id+'/merge_requests',token,'POST',{source_branch:branch,target_branch:project.default_branch,title:'Exercise owned native preview lifecycle'});
      const checked=await awaitChecks(async()=>{
        const rows=await candidate.api('/projects/'+project.id+'/merge_requests/'+mr.iid+'/pipelines',token);
        return rows.find(row=>row.sha===reviewCommit.id&&row.source==='merge_request_event');
      });
      reviewPipeline=checked.pipeline;reviewJobs=checked.jobs;
      requireValue(reviewPipeline.sha===reviewCommit.id&&reviewPipeline.source==='merge_request_event','guided-preview-review-pipeline-mismatch');
      evidence.review={projectId:project.id,mergeRequestIid:mr.iid,pipelineId:reviewPipeline.id,sourceCommit:reviewCommit.id,source:reviewPipeline.source,jobs:checked.proof,
        ...await artifacts(reviewPipeline,reviewJobs)};
      await lifecycle('review',reviewPipeline,evidence.review);
    });
    await candidate.stage('guided-preview-native-merge-and-build',async()=>{
      const currentProject=await candidate.api('/projects/'+project.id,token);
      requireValue(currentProject.only_allow_merge_if_pipeline_succeeds===true&&currentProject.only_allow_merge_if_all_discussions_are_resolved===true,'guided-preview-native-merge-gates-required');
      let ready;
      await candidate.wait(async()=>{
        ready=await candidate.api('/projects/'+project.id+'/merge_requests/'+mr.iid+'?with_merge_status_recheck=true',token);
        requireValue(ready.state==='opened'&&ready.sha===reviewCommit.id&&ready.draft===false&&ready.head_pipeline?.id===reviewPipeline.id&&ready.head_pipeline?.status==='success','guided-preview-normal-merge-gate-failed');
        return ready.detailed_merge_status==='mergeable';
      },120000);
      const merged=await candidate.api('/projects/'+project.id+'/merge_requests/'+mr.iid+'/merge',token,'PUT',
        {sha:reviewCommit.id,should_remove_source_branch:true});
      requireValue(merged.state==='merged'&&/^[a-f0-9]{40}$/.test(merged.merge_commit_sha),'guided-preview-normal-merge-failed');
      const branch=await candidate.api('/projects/'+project.id+'/repository/branches/'+encodeURIComponent(project.default_branch),token);
      requireValue(branch.commit.id===merged.merge_commit_sha,'guided-preview-merged-default-identity-mismatch');
      const checked=await awaitChecks(async()=>{
        const rows=await candidate.api('/projects/'+project.id+'/pipelines?ref='+encodeURIComponent(project.default_branch)+'&sha='+branch.commit.id+'&source=push',token);
        return rows.find(row=>row.sha===branch.commit.id&&row.source==='push');
      });
      mergedPipeline=checked.pipeline;mergedJobs=checked.jobs;
      requireValue(mergedPipeline.sha===branch.commit.id&&mergedPipeline.ref===project.default_branch&&mergedPipeline.source==='push','guided-preview-merged-push-required');
      evidence.merge={projectId:project.id,mergeRequestIid:mr.iid,merged:true,normalGate:true,mergeCommit:merged.merge_commit_sha,
        sourceCommit:mergedPipeline.sha,pipelineId:mergedPipeline.id,source:mergedPipeline.source,jobs:checked.proof,...await artifacts(mergedPipeline,mergedJobs)};
      unchanged(before,await production(candidate));
    });
    if(desired.beta.enabled)await candidate.stage('guided-preview-native-beta-deploy-stop',async()=>{
      evidence.beta={projectId:project.id,pipelineId:mergedPipeline.id,sourceCommit:mergedPipeline.sha,source:mergedPipeline.source,
        jobs:nativeJobs(mergedPipeline,mergedJobs),...await artifacts(mergedPipeline,mergedJobs)};
      await lifecycle('beta',mergedPipeline,evidence.beta);
    });
    candidate.evidence.guidedPreview=evidence;return evidence;
  } finally {
    try { await candidate.stage('guided-preview-production-retained',async()=>{const after=await production(candidate);unchanged(before,after);evidence.productionRetained={mainSha256:after.mainSha256,runningImage:after.runningImage};}); }
    finally { if(mintAttempted) {
      await candidate.stage('guided-preview-temporary-credential-revoked',async()=>{
        if(!mintConfirmed)evidence.credentialCleanupUncertain=true;
        try {
          let revoked=false;
          if(token)try{await candidate.api('/personal_access_tokens/self',token,'DELETE');revoked=true;}catch{}
          const query="User.find_by_username('root').personal_access_tokens.where(name:'guided-preview-acceptance-"+candidate.id+"',revoked:false)";
          // A lost/malformed Rails result can conceal a successfully minted PAT.
          // A currently inactive name cannot prove that the original request
          // finished; it may still commit after this best-effort cleanup.
          const check=await candidate.rails("require 'json';"+(!revoked?query+".find_each(&:revoke!);":"")+"puts JSON.generate(activeCount:"+query+".count)");
          requireValue(check.activeCount===0,'guided-preview-credential-still-active');
          if(token){
            const response=await candidate.request((candidate.gitlabUrl||candidate.url)+'/api/v4/user',{headers:{Host:new URL(candidate.gitlabUrl||candidate.url).host,'PRIVATE-TOKEN':token}});
            requireValue(response.status===401,'guided-preview-credential-still-active');
          }
        } finally {
          if(!mintConfirmed)throw Error('guided-preview-credential-mint-completion-uncertain');
        }
      });
    } }
  }
}
module.exports={run,settings,nativeJobs,unchanged,production,syncSession};
