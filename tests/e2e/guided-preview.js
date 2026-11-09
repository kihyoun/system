'use strict';
// Shared real-platform acceptance adapter. The reviewed native driver selects
// the operator instance explicitly; isolated transports test its contracts only.
const binding=require('../../project-bootstrap/wizard-source-primary/binding');
const environmentState=require('../../project-bootstrap/wizard-environments/state');
const settingsContract=require('../../project-bootstrap/preview-setup/settings');
const required=['build:source','test:browser','build:wizard','test:wizard'];
const terminal=new Set(['success','failed','canceled','skipped']);
function requireValue(value,code){if(!value)throw Error(code);}
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
    (initial?"if(binding.primary(receipt)||receipt.wizardWorkflow)throw Error();const {Adoption}=require('/system/project-bootstrap/wizard-source-primary/run');const publicImage=new Adoption({mainConfig:path.join(state,'.docker.env'),request:async()=>undefined}).publicRelease(main);": "const publicImage=null;")+
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
async function run(candidate) {
  const desired=settings(candidate),before=await production(candidate,true);
  let token,accessToken;
  const evidence={productionMainSha256:before.mainSha256,productionImageId:before.runningImage,initialRegistrationId:before.projectId};
  candidate.evidence.guidedPreview=evidence;
  // This adapter requires real HTTPS/DNS/trust/public-source and native CI
  // dependencies prepared by the existing platform harness. It creates no CA,
  // accepted-release receipt, alternate CI producer, or privileged test bypass.
  const sync=async(route,payload)=>{
    const response=await candidate.request(candidate.url+route,{method:payload===undefined?'GET':'POST',headers:{Host:new URL(candidate.url).host,
      Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    requireValue(response.status>=200&&response.status<300,'guided-preview-sync-request-failed');
    try{return JSON.parse(response.body);}catch{throw Error('guided-preview-sync-result-invalid');}
  };
  const apply=async()=>{
    const preview=await sync('/projects/wizard/preview-setup/preflight',{settings:desired});
    requireValue(preview.productionChanged===false&&preview.runnerReady===true,'guided-preview-preflight-proof-failed');
    let job=await sync('/projects/wizard/preview-setup/apply',{settings:desired,previewHash:preview.previewHash});
    await candidate.wait(async()=>{
      if(job.state==='running')job=await sync('/projects/jobs/'+job.id);
      requireValue(job.state!=='failed','guided-preview-setup-job-failed');return job.state!=='running';
    },600000);
    return sync('/projects/wizard/preview-setup');
  };
  try {
    await candidate.stage('guided-preview-fresh-public-registration',async()=>{
      const login=await candidate.request(candidate.url+'/login',{method:'POST',headers:{Host:new URL(candidate.url).host,'Content-Type':'application/json'},
        body:JSON.stringify({username:candidate.secrets.user,password:candidate.secrets.password})});
      requireValue(login.status===200,'guided-preview-sync-login-failed');accessToken=JSON.parse(login.body).accessToken;
      const existing=await sync('/projects/wizard/preview-setup');requireValue(existing.phase==='not-started','guided-preview-fresh-setup-required');
      const auth=await candidate.rails("require 'json';t=User.find_by_username('root').personal_access_tokens.create!(name:'guided-preview-acceptance-"+candidate.id+"',scopes:['api'],expires_at:Date.tomorrow);puts JSON.generate(token:t.token)");
      requireValue(typeof auth.token==='string'&&auth.token.length>10,'guided-preview-credential-required');token=auth.token;
      // Both destinations must be absent before setup. A fresh database alone
      // does not prove that old source-project IDs were not reused.
      const projects=await candidate.api('/projects?per_page=100',token);
      requireValue(Array.isArray(projects)&&projects.length<100,'guided-preview-project-inventory-required');
      for(const name of [desired.wizard.project,desired.system?.project].filter(Boolean))
        requireValue(!projects.some(project=>project.path_with_namespace===desired.namespace+'/'+name),'guided-preview-source-destination-already-exists');
      evidence.previousProjectIds=projects.map(project=>project.id);
    });
    let setup,project,pipeline;
    await candidate.stage('guided-preview-native-source-push-and-build',async()=>{
      setup=await apply();requireValue(['waiting-build','ready'].includes(setup.phase),'guided-preview-source-import-failed');
      requireValue(Number.isSafeInteger(setup.projects?.wizard?.id)&&!evidence.previousProjectIds.includes(setup.projects.wizard.id)&&setup.projects.wizard.id!==before.projectId,'guided-preview-fresh-wizard-id-required');
      if(desired.system)requireValue(Number.isSafeInteger(setup.projects.system?.id)&&setup.projects.system.id!==setup.projects.wizard.id&&!evidence.previousProjectIds.includes(setup.projects.system.id),'guided-preview-fresh-system-id-required');
      project=await candidate.api('/projects/'+setup.projects.wizard.id,token);
      requireValue(project.visibility==='private'&&project.path_with_namespace===desired.namespace+'/'+desired.wizard.project&&project.ci_config_path==='.gitlab/primary.yml','guided-preview-created-source-project-mismatch');
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
      const actual=await controller(candidate,"binding.validate(receipt);process.stdout.write(JSON.stringify({receipt}));");
      const artifact=await candidate.api('/projects/'+project.id+'/jobs/'+evidence.source.jobs.find(job=>job.name==='build:wizard').id+'/artifacts/build-evidence.json',token);
      const native=await binding.evidence(route=>candidate.api('/'+route,token),actual.receipt,pipeline.id,pipeline.sha,artifact.imageRef);
      requireValue(native.build.unitTests&&native.smoke.renderedUI,'guided-preview-native-artifact-proof-failed');
      const retained=await controller(candidate,"const {Adoption}=require('/system/project-bootstrap/wizard-source-primary/run');process.stdout.write(JSON.stringify({publicImage:new Adoption({mainConfig:path.join(state,'.docker.env'),request:async()=>undefined}).publicRelease(main)}));");
      requireValue(retained.publicImage===before.publicImage,'guided-preview-retained-public-selection-changed');
      evidence.adoptedProjectId=current.projectId;
    });
    await candidate.stage('guided-preview-native-review-deploy-stop',async()=>{
      const branch='guided-review-'+candidate.id;
      const commit=await candidate.api('/projects/'+project.id+'/repository/commits',token,'POST',{branch,start_branch:project.default_branch,
        commit_message:'Exercise owned native Review lifecycle',actions:[{action:'create',file_path:'.guided-preview-proof-'+candidate.id,content:'Owned disposable native Review proof\n'}]});
      const mr=await candidate.api('/projects/'+project.id+'/merge_requests',token,'POST',{source_branch:branch,target_branch:project.default_branch,title:'Draft: Disposable guided Review lifecycle'});
      evidence.review={mergeRequestIid:mr.iid,sourceCommit:commit.id};
      let reviewPipeline,jobs;
      await candidate.wait(async()=>{
        const rows=await candidate.api('/projects/'+project.id+'/merge_requests/'+mr.iid+'/pipelines',token);
        reviewPipeline=rows.find(row=>row.sha===commit.id&&row.source==='merge_request_event');
        if(!reviewPipeline)return false;
        reviewPipeline=await candidate.api('/projects/'+project.id+'/pipelines/'+reviewPipeline.id,token);
        jobs=await candidate.api('/projects/'+project.id+'/pipelines/'+reviewPipeline.id+'/jobs?per_page=100&include_retried=false',token);
        const checks=jobs.filter(job=>required.includes(job.name));
        if(checks.some(job=>['failed','canceled'].includes(job.status)))throw Error('guided-preview-native-review-check-failed');
        return terminal.has(reviewPipeline.status)&&required.every(name=>checks.find(job=>job.name===name)?.status==='success');
      },900000);
      const proof=nativeJobs(reviewPipeline,jobs);
      Object.assign(evidence.review,{pipelineId:reviewPipeline.id,jobs:proof});
      const play=async name=>{
        const job=jobs.find(item=>item.name===name);requireValue(job?.status==='manual','guided-preview-native-manual-job-required');
        evidence.review[name==='deploy:review'?'deployJobId':'stopJobId']=job.id;
        await candidate.api('/projects/'+project.id+'/jobs/'+job.id+'/play',token,'POST',{});
        let current;await candidate.wait(async()=>{current=await candidate.api('/projects/'+project.id+'/jobs/'+job.id,token);return terminal.has(current.status);},600000);
        requireValue(current.status==='success'&&current.runner?.id,'guided-preview-native-manual-job-failed');return current.id;
      };
      let deployJobId,stopJobId,deployment;
      try {
      deployJobId=await play('deploy:review');
      const active=await production(candidate);unchanged(before,active);
      deployment=active.environment?.deployments?.review?.active;
      requireValue(deployment?.state==='active'&&deployment.projectId===project.id&&deployment.pipelineId===reviewPipeline.id&&deployment.sourceCommit===commit.id,'guided-preview-active-review-proof-failed');
      evidence.review.containerName=deployment.containerName;
      const inspected=JSON.parse(await candidate.inner(['inspect',deployment.containerName]));
      const selectedImage=(await candidate.inner(['image','inspect','--format','{{.Id}}',deployment.imageRef])).trim();
      requireValue(inspected.length===1&&inspected[0].State.Running===true&&inspected[0].Image===selectedImage&&
        Object.entries(environmentState.labels(deployment)).every(([key,value])=>inspected[0].Config.Labels?.[key]===value),
        'guided-preview-owned-running-review-image-required');
      const page=await candidate.request('https://'+desired.review.host+'/',{});
      requireValue(page.status===200&&/<!doctype html|<html/i.test(page.body),'guided-preview-routed-review-page-required');
      } finally {
        if(deployJobId)stopJobId=await play('stop:review');
      }
      const stopped=await production(candidate);unchanged(before,stopped);
      const slot=stopped.environment?.deployments?.review;
      requireValue(!slot?.active&&!slot?.pending&&slot?.tombstone?.state==='stopped'&&slot.tombstone.pipelineId===reviewPipeline.id&&
        slot.tombstone.mrIid===mr.iid&&slot.stoppedThroughPipelineId>=reviewPipeline.id,'guided-preview-review-stop-proof-failed');
      const remaining=(await candidate.inner(['container','ls','--all','--filter','name=^/'+deployment.containerName+'$','--format','{{.Names}}'])).trim();
      requireValue(!remaining,'guided-preview-review-container-not-removed');
      evidence.review={mergeRequestIid:mr.iid,pipelineId:reviewPipeline.id,sourceCommit:commit.id,jobs:proof,deployJobId,stopJobId};
    });
    candidate.evidence.guidedPreview=evidence;return evidence;
  } finally {
    try { await candidate.stage('guided-preview-production-retained',async()=>unchanged(before,await production(candidate))); }
    finally { if(token) {
      await candidate.stage('guided-preview-temporary-credential-revoked',async()=>{
        try{await candidate.api('/personal_access_tokens/self',token,'DELETE');}
        catch{await candidate.rails("User.find_by_username('root').personal_access_tokens.where(name:'guided-preview-acceptance-"+candidate.id+"',revoked:false).find_each(&:revoke!);puts '{}'");}
        const response=await candidate.request((candidate.gitlabUrl||candidate.url)+'/api/v4/user',{headers:{Host:new URL(candidate.gitlabUrl||candidate.url).host,'PRIVATE-TOKEN':token}});
        requireValue(response.status===401,'guided-preview-credential-still-active');
      });
    } }
  }
}
module.exports={run,settings,nativeJobs,unchanged,production};
