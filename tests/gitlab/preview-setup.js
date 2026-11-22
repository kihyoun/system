#!/usr/bin/env node
'use strict';
require('../../node_modules/reflect-metadata');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {PreviewSetupService} = require('../../dist/modules/gitlab-provision/previewSetup.service');
const {PreviewEvidence} = require('../../dist/modules/gitlab-provision/previewEvidence');
const binding = require('../../dist/modules/project-lifecycle/sourcePrimaryBinding');
const clone = value => structuredClone(value), hash = value => createHash('sha256').update(value).digest('hex');
async function main() {
  const operation = 'a'.repeat(48), calls = [], variables = {};
  let project = null, failTransport = false;
  const credentials = {ensure: async () => ({context:{},credential:{token:'fixture-private-admin'}})};
  const request = async (_context,token,method,route,body) => {
    assert.equal(token,'fixture-private-admin'); calls.push([method,route,body]);
    if (failTransport) throw Error('fixture-private-admin');
    let value;
    if (method === 'GET') {
      if (route === 'namespaces?per_page=100') value = [{id:9,full_path:'team'}];
      else if (['runners/all?per_page=100&status=online','projects/7/runners?per_page=100'].includes(route)) value = [{id:2,paused:false,status:'online'}];
      else if (route === 'runners/2') value = {id:2,paused:false,status:'online',tag_list:['docker','wizard-source-primary']};
      else if (['projects/team%2Fwizard-fork','projects/7'].includes(route)) value = project;
      else if (route.startsWith('projects/7/variables/')) value = variables[route.split('/')[3].split('?')[0]];
      else throw Error('Unexpected route: ' + route);
      return {status:value == null ? 404 : 200,value:clone(value)};
    }
    if (method === 'POST' && route === 'projects') {project = {...body,id:7,namespace:{id:9},path_with_namespace:'team/wizard-fork'}; return {status:201,value:clone(project)};}
    if (method === 'POST' && route === 'projects/7/variables') {variables[body.key] = clone(body); return {status:201,value:body};}
    if (method === 'POST' && route === 'projects/7/access_tokens') {
      const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
      assert.deepEqual(body,{name:'bootstrapper-preview-source-'+operation,scopes:['write_repository'],access_level:40,expires_at:tomorrow.toISOString().slice(0,10)});
      return {status:201,value:{id:12,token:'fixture-source-token'}};
    }
    assert.equal(method,'DELETE'); assert.equal(route,'projects/7/access_tokens/12'); return {status:204,value:null};
  };
  const service = new PreviewSetupService(credentials,{request});
  const input = {action:'preview-setup-preflight',namespace:'team',operation,sources:[{mode:'import',project:'wizard-fork',ciPath:'.gitlab/primary.yml'}]};
  assert.equal((await service.execute('/checkout',input)).namespaceId,9); assert(calls.every(row => row[0] === 'GET'));
  const setup = {...input,action:'preview-setup-project',source:input.sources[0]};
  assert.deepEqual((await service.execute('/checkout',setup)).credential,{id:12,token:'fixture-source-token'});
  assert.equal(project.auto_devops_enabled,false); assert.equal(project.ci_config_path,'.gitlab/primary.yml');
  assert(project.only_allow_merge_if_pipeline_succeeds && project.only_allow_merge_if_all_discussions_are_resolved);
  for (const key of ['GITHUB_BACKUP_ENABLED','DOCKERHUB_PUBLISH_ENABLED','GITHUB_RELEASE_PUBLISH_ENABLED','WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED']) assert.equal(variables[key].value,'false');
  assert.equal(variables.WIZARD_DELIVERY_ENABLED.value,'true');
  assert.deepEqual(await service.execute('/checkout',{...input,action:'preview-setup-revoke',projectId:7,tokenId:12}),{revoked:true});
  project.auto_devops_enabled = true;
  await service.execute('/checkout',setup); assert.equal(project.auto_devops_enabled,true);
  project.description = 'operator project'; let count = calls.length;
  assert(!('credential' in await service.execute('/checkout',{...setup,source:{...setup.source,mode:'existing'}})));
  assert(calls.slice(count).every(row => row[0] === 'GET'));
  count = calls.length; assert.equal((await service.execute('/checkout',setup)).state,'failed'); assert(calls.slice(count).every(row => row[0] === 'GET'));
  const batch = {action:'preview-setup-read-many',projectIds:[7],routes:Array(32).fill('projects/7')};
  assert.deepEqual((await service.execute('/checkout',batch)).values,Array(32).fill(project));
  for (const routes of [null,[],Array(33).fill('projects/7'),...['projects/8','projects/7/access_tokens','projects/7\r','projects/7\n','projects/7\0','projects/7/../8','projects/7/repository/files/'+'a'.repeat(2048),7].map(route => ['projects/7',route])]) {
    count = calls.length; assert.equal((await service.execute('/checkout',{...batch,routes})).state,'failed'); assert.equal(calls.length,count);
  }
  failTransport = true;
  const failed = await service.execute('/checkout',{...batch,routes:['projects/7']}); assert.equal(failed.state,'failed'); assert(!JSON.stringify(failed).includes('fixture-private-admin')); failTransport = false;
  project.description = 'System Bootstrapper preview setup '+operation;
  const interrupted = new PreviewSetupService(credentials,{request:async (...args) => {if (args[2] === 'POST') throw Error('fixture-private-admin'); return request(...args);}});
  await assert.rejects(interrupted.execute('/checkout',setup),error => error.uncertain && !error.message.includes('fixture-private-admin'));
  const interruptedCredential = new PreviewSetupService({ensure:async () => {throw Object.assign(Error('fixture-private-admin'),{uncertain:true});}},{request});
  await assert.rejects(interruptedCredential.execute('/checkout',setup),error => error.uncertain && !error.message.includes('fixture-private-admin'));
  const large = new PreviewSetupService(credentials,{request:async () => ({status:200,value:{content:'x'.repeat(800000)}})});
  assert.equal((await large.execute('/checkout',{...batch,routes:['projects/7','projects/7']})).state,'failed');
  await evidenceContracts();
  await sharedContracts(credentials);
  const {NestFactory} = require('../../node_modules/@nestjs/core');
  const {GitlabProvisionModule} = require('../../dist/modules/gitlab-provision/gitlabProvision.module');
  const app = await NestFactory.createApplicationContext(GitlabProvisionModule,{logger:false});
  try {assert(app.get(PreviewSetupService) instanceof PreviewSetupService);} finally {await app.close();}
  console.log('Preview setup: scoped ownership, read-only preflight, bounded fresh evidence, pipeline parity, interruption and shared System identity passed.');
}
async function evidenceContracts() {
  const sha = 'a'.repeat(40), pipeline = {id:31,sha,ref:'main/native',source:'push',status:'success'};
  const jobs = ['build:source','test:browser','build:wizard','test:wizard'].map((name,index) => ({id:40+index,name,status:'success',allow_failure:false,commit:{id:sha},pipeline:{id:31}}));
  const files = ['.gitlab/primary.yml',...Array.from({length:22},(_,i) => `.gitlab/proof-${i}.sh`)].map(path => ({path,sha256:hash('fixture bytes')}));
  const project = {id:7,namespace:{id:9},path_with_namespace:'team/wizard',default_branch:'main/native',visibility:'private',ci_config_path:'.gitlab/primary.yml',only_allow_merge_if_pipeline_succeeds:true,only_allow_merge_if_all_discussions_are_resolved:true};
  const receipt = {namespaceId:9,repository:{id:7,namespaceId:9,path:'team/wizard',defaultBranch:'main/native',managementMode:'source-primary',ciPath:'.gitlab/primary.yml'},sourcePrimary:{ciFiles:files}};
  const input = {projectIds:[1,7],previousProjectId:1,receipt,pipelineId:31,sourceCommit:sha}, source = {projectIds:[7],projectId:7};
  const branch = 'projects/7/repository/branches/main%2Fnative', pipelines = `projects/7/pipelines?sha=${sha}&ref=main%2Fnative&source=push&per_page=100`, jobRoute = 'projects/7/pipelines/31/jobs?per_page=100&include_retried=false';
  const trees = ['.gitlab','.system-bootstrapper/build-v1'].map(path => `projects/7/repository/tree?path=${encodeURIComponent(path)}&ref=${sha}&recursive=true&per_page=100`);
  const rows = {'projects/1':{id:1},'projects/7':project,[branch]:{commit:{id:sha}},'projects/7/pipelines/31':pipeline,[pipelines]:[pipeline],[jobRoute]:jobs,[trees[0]]:files.map(file => ({type:'blob',path:file.path})),[trees[1]]:[], 'projects/7/jobs/42/artifacts/build-evidence.json':{version:1},'projects/7/jobs/43/artifacts/wizard-evidence.json':{version:1}};
  const fileRoute = path => 'projects/7/repository/files/'+encodeURIComponent(path)+'?ref='+sha;
  for (const file of files) rows[fileRoute(file.path)] = {content:Buffer.from('fixture bytes').toString('base64')};
  const calls = [];
  const collector = selected => new PreviewEvidence(selected,async route => {calls.push(route); assert(Object.hasOwn(rows,route),route); return clone(rows[route]);});
  const read = async (selected=input,method='adoption') => {calls.length=0; return collector(selected)[method]();};
  let result = await read(); assert.deepEqual(result.reads.map(row => row.route),calls); assert.equal(calls.length,30);
  await read(); assert.equal(calls.length,30);
  result = await read(source,'source'); assert.equal(calls.length,30); assert.deepEqual(result.files.map(file => file.path),files.map(file => file.path));
  assert.equal((await read(source,'context')).pipeline.id,31); assert.equal(calls.length,6);
  for (const status of ['running','pending','canceled','skipped',null]) {
    rows[pipelines] = status ? [{...pipeline,status}] : [];
    result = await read(source,'source'); assert.equal(calls.length,3); assert(!result.jobs && !result.files);
  }
  rows[pipelines] = [{...pipeline,id:90,sha:'b'.repeat(40)},{...pipeline,id:91,source:'api'},pipeline];
  assert.equal((await read(source,'context')).pipeline.id,31); rows[pipelines] = [pipeline];
  const cases = [[pipeline,jobs],...['created','running','failed','canceled','skipped','unknown'].map(status => [{...pipeline,status},jobs])];
  jobs.forEach((job,index) => {
    for (const change of [{status:'failed'},{allow_failure:true},{commit:{id:'b'.repeat(40)}},{pipeline:{id:32}}]) {const changed = clone(jobs); Object.assign(changed[index],change); cases.push([pipeline,changed]);}
    cases.push([pipeline,jobs.filter((_,i) => i !== index)],[pipeline,[...jobs,job]]);
  });
  const mirror = {id:50,name:'deploy:github',status:'failed',allow_failure:false,commit:{id:sha},pipeline:{id:31}};
  cases.push([{...pipeline,status:'failed'},[...jobs,mirror]],[pipeline,[...jobs,{...mirror,allow_failure:true}]],[pipeline,[...jobs,mirror,mirror]],[pipeline,[...jobs,{...mirror,commit:{id:'b'.repeat(40)}}]],[pipeline,[...jobs,{...mirror,name:'another-required-job'}]]);
  for (const [candidate,selected] of cases) {
    let expected=true,actual=true;
    try {binding.pipelineChecks(candidate,selected);} catch {expected=false;}
    try {collector(input).checks(candidate,selected);} catch {actual=false;}
    assert.equal(actual,expected);
    if (actual) continue;
    rows['projects/7/pipelines/31']=candidate; rows[pipelines]=[candidate]; rows[jobRoute]=selected;
    await assert.rejects(read()); assert(!calls.some(route => /artifacts|repository\/files/.test(route)));
    if (['success','failed'].includes(candidate.status)) await assert.rejects(read(source,'source'));
    else {await read(source,'source'); assert.equal(calls.length,3);}
    assert(!calls.some(route => /artifacts|repository\/files/.test(route)));
  }
  rows['projects/7/pipelines/31']=pipeline; rows[pipelines]=[pipeline]; rows[jobRoute]=jobs;
  for (const yaml_errors of [null,false,'',0]) {rows['projects/7/pipelines/31']={...pipeline,yaml_errors}; await read();} rows['projects/7/pipelines/31']=pipeline;
  for (const [route,changed,method,bound] of [
    ['projects/7',{...project,visibility:'public'},'adoption',null], [branch,{commit:{id:'b'.repeat(40)}},'adoption',null],
    ...[{id:32},{ref:'other'},{source:'api'},{yaml_errors:'invalid'}].map(change => ['projects/7/pipelines/31',{...pipeline,...change},'adoption',null]),
    ['projects/7',{...project,id:8},'context',1], ['projects/7',{...project,default_branch:'a'.repeat(2049)},'context',1],
    [branch,{commit:{id:'not-a-sha'}},'context',2], [pipelines,[{...pipeline,id:0}],'context',3],
    ['projects/7',{...project,padding:'x'.repeat(1500000)},'context',1], [trees[0],Array(100).fill({type:'blob',path:'.gitlab/proof'}),'context',5],
    [fileRoute(files[0].path),{content:Buffer.from('changed').toString('base64')},'adoption',6],
    [fileRoute(files[0].path),{content:Buffer.from('x'.repeat(1500000)).toString('base64')},'adoption',6]
  ]) {
    const original=rows[route]; rows[route]=changed;
    await assert.rejects(read(method === 'context' ? source : input,method));
    assert(!calls.some(route => route.includes('/artifacts/'))); if (bound) assert.equal(calls.length,bound); rows[route]=original;
  }
  for (const selected of [{...input,projectIds:[1]},{...input,previousProjectId:8},{...input,receipt:{...receipt,sourcePrimary:{ciFiles:[...files,...files.slice(0,3)]}}}]) {await assert.rejects(read(selected)); assert.equal(calls.length,0);}
  for (const selected of [{...source,projectId:8},{...source,projectIds:null},{...source,projectIds:[]},...[0,-1,'7',7.5].map(projectId => ({...source,projectId}))]) {await assert.rejects(read(selected,'context')); assert.equal(calls.length,0);}
  const oldProject=rows['projects/7'], oldBranch=rows[branch]; rows['projects/7']={...oldProject,padding:'x'.repeat(800000)}; rows[branch]={...oldBranch,padding:'x'.repeat(800000)};
  await assert.rejects(read(source,'context')); assert.equal(calls.length,2); rows['projects/7']=oldProject; rows[branch]=oldBranch;
  const advanced='b'.repeat(40); rows[branch]={commit:{id:advanced}}; rows[pipelines.replace(sha,advanced)]=[{...pipeline,id:32,sha:advanced}]; rows[jobRoute.replace('/31/','/32/')]=[{id:41}];
  for (const route of trees) rows[route.replace(sha,advanced)]=rows[route];
  result=await read(source,'context'); assert.equal(result.branch.commit.id,advanced); assert.equal(result.pipeline.id,32); assert.equal(result.jobs[0].id,41); rows[branch]=oldBranch;
  const extra=Array.from({length:2},(_,i) => ({path:`.gitlab/larger-${i}.sh`,sha256:hash('fixture bytes')}));
  for (const file of extra) {rows[trees[0]].push({type:'blob',path:file.path}); rows[fileRoute(file.path)]={content:Buffer.from('fixture bytes').toString('base64')};}
  await read({...input,receipt:{...receipt,sourcePrimary:{ciFiles:[...files,...extra]}}}); assert.equal(calls.length,32);
  await read(source,'source'); assert.equal(calls.length,32);
  rows[trees[0]].push({type:'blob',path:'.gitlab/too-large.sh'}); result=await read(source,'source'); assert.equal(calls.length,6); assert(!result.files);
}
async function sharedContracts(credentials) {
  const sha='a'.repeat(40), input={action:'preview-setup-preflight',sourceLayout:'system-monorepo-v1',namespace:'team',sources:[{mode:'existing',project:'system',ciPath:'.gitlab-ci.yml'}]};
  const rows={'namespaces?per_page=100':[{id:9,full_path:'team'}],'runners/all?per_page=100&status=online':[{id:2,paused:false,status:'online'}],'projects/7/runners?per_page=100':[{id:2,paused:false,status:'online'}],'runners/2':{id:2,paused:false,status:'online',tag_list:['docker']},'projects/team%2Fsystem':{id:7,path_with_namespace:'team/system',namespace:{id:9},default_branch:'main',ci_config_path:null,visibility:'private',only_allow_merge_if_pipeline_succeeds:true,only_allow_merge_if_all_discussions_are_resolved:true},'projects/7/repository/branches/main':{protected:true,commit:{id:sha}},[`projects/7/repository/tree?ref=${sha}&per_page=100`]:[{path:'wizard',type:'tree',mode:'040000'}]};
  const service = new PreviewSetupService(credentials,{request:async (_context,_token,method,route) => {assert.equal(method,'GET'); assert(Object.hasOwn(rows,route)); return {status:200,value:clone(rows[route])};}});
  assert.deepEqual((await service.execute('/checkout',input)).projects,[{id:7,path:'team/system',namespaceId:9,defaultBranch:'main',sourceRevision:sha}]);
  rows[`projects/7/repository/tree?ref=${sha}&per_page=100`][0].type='commit'; assert.equal((await service.execute('/checkout',input)).state,'failed');
}
main().catch(error => {console.error(error); process.exitCode=1;});
