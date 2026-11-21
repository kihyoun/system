'use strict';
require('../../operations/node_modules/reflect-metadata');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { WizardSourceImportService, WizardSourcePrimaryStatusService, WizardSourceOperationService } = require('../../operations/dist/gitlab-provision/wizard-source.service');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const encoded = (value) => Buffer.from(value).toString('base64');
const file = (content, commit = 'initial', executable = false) => ({ content: encoded(content), last_commit_id: commit, execute_filemode: executable });
class Repository {
  constructor() { this.files = { '.system-bootstrapper/ci.yml': file('disabled CI', 'scaffold'), 'README.md': file('Keep scaffold README') }; this.commits = 0; }
  async request(method, route, body) {
    if (method === 'GET') {
      const name = decodeURIComponent(route.split('/files/')[1].split('?')[0]);
      return { status: this.files[name] ? 200 : 404, value: this.files[name] || {} };
    }
    assert.equal(method, 'POST'); assert.ok(route.endsWith('/commits')); assert.match(body.commit_message, /\[skip ci\]/);
    if (this.concurrent) this.files['.system-bootstrapper/ci.yml'] = file('edited concurrently', 'concurrent');
    const next = structuredClone(this.files);
    for (const action of body.actions) {
      const name = action.file_path;
      if (action.action === 'create') {
        if (next[name]) return { status: 400, value: {} };
        next[name] = file(action.encoding === 'base64' ? Buffer.from(action.content, 'base64') : action.content, 'imported');
      } else if (action.action === 'chmod') next[name].execute_filemode = action.execute_filemode;
      else {
        assert.equal(action.action, 'update');
        if (next[name].last_commit_id !== action.last_commit_id) return { status: 400, value: {} };
        next[name] = file(action.content, 'imported');
      }
    }
    this.files = next; this.commits++;
    if (this.lost) throw Error('Interrupted after commit');
    return { status: 201, value: { id: 'imported' } };
  }
}
async function main() {
  const importer = new WizardSourceImportService();
  const source = [['source.ts', 'source', '100644'], ['binary.png', Buffer.from([0, 255]), '100644'], ['run.sh', '#!/bin/sh', '100755'], ['.gitlab-ci.yml', 'upstream untouched', '100644']].map(([path, bytes, mode]) => ({ path, content: encoded(bytes), sha256: hash(bytes), mode }));
  const project = { id: 1, description: 'System Bootstrapper operation registration', visibility: 'private', path_with_namespace: 'root/wizard', default_branch: 'main', ci_config_path: '.system-bootstrapper/ci.yml' };
  const input = { operation: 'registration', repository: { id: 1, path: 'root/wizard', defaultBranch: 'main' }, expectedCi: 'disabled CI', snapshot: { sourceRevision: 'a'.repeat(40), manifestHash: 'b'.repeat(64), files: source } };
  let repo = new Repository();
  const run = () => importer.execute(repo, input, project);
  assert.equal((await run()).importCommit, 'imported'); assert.equal(repo.commits, 1);
  assert.equal(Buffer.from(repo.files['README.md'].content, 'base64').toString(), 'Keep scaffold README');
  assert.deepEqual(Buffer.from(repo.files['binary.png'].content, 'base64'), Buffer.from([0,255]));
  assert.equal(repo.files['run.sh'].execute_filemode, true);
  assert.equal(Buffer.from(repo.files['.system-bootstrapper/ci.yml'].content, 'base64').toString(), 'disabled CI');
  await run(); assert.equal(repo.commits, 1);
  repo.files['source.ts'] = file('edited', 'maintainer'); await assert.rejects(run, /source changed/);
  repo = new Repository(); repo.lost = true; await assert.rejects(run, /Interrupted/); repo.lost = false; await run(); assert.equal(repo.commits, 1);
  repo = new Repository(); repo.files['source.ts'] = file('occupied'); await assert.rejects(run, /occupied/); assert.equal(repo.commits, 0);
  repo = new Repository(); repo.files['.system-bootstrapper/ci.yml'] = file('changed'); await assert.rejects(run, /Managed CI changed/);
  repo = new Repository(); repo.concurrent = true; await assert.rejects(run, /conflicted or failed/); assert.equal(repo.commits, 0); assert.equal(repo.files['source.ts'], undefined);
  for (const key of ['id','description','visibility','path_with_namespace','default_branch','ci_config_path']) await assert.rejects(() => importer.execute(repo, input, {...project, [key]: 'foreign'}), /ownership changed/);
  for (const layout of [{sourceLayout:'system-monorepo-v1', wizardSourceTree:'c'.repeat(40)}, {sourceLayout:'foreign'}]) {
    const value = structuredClone(input); Object.assign(value.snapshot, layout);
    if (layout.sourceLayout === 'foreign') await assert.rejects(() => importer.execute(new Repository(), value, project), /layout/);
    else await importer.execute(new Repository(), value, project);
  }
  for (const path of ['../escape', '/absolute', '.git/config', 'a//b']) {
    const value = structuredClone(input); value.snapshot.files[0].path = path;
    await assert.rejects(() => importer.execute(new Repository(), value, project), /content is invalid/);
  }
  const sha = 'a'.repeat(40), image = 'registry.example.test/team/system-wizard@sha256:' + 'b'.repeat(64), ci = '# native source CI\n';
  const repository = { id:7, namespaceId:9, path:'team/system-wizard', defaultBranch:'master', managementMode:'source-primary', ciPath:'.gitlab/primary.yml' };
  const statusInput = { repository, namespaceId:9, projectKey:'wizard', action:'wizard-source-primary-status', sourcePrimary:{version:1,ciFiles:[{path:repository.ciPath,sha256:hash(ci)}]}, build:{recipeHash:'c'.repeat(64)}, registryPrefix:'registry.example.test/team/system-wizard' };
  const statusProject = {id:7,path_with_namespace:repository.path,namespace:{id:9},default_branch:'master',visibility:'private',ci_config_path:repository.ciPath,only_allow_merge_if_pipeline_succeeds:true,only_allow_merge_if_all_discussions_are_resolved:true};
  const pipelineKey = `projects/7/pipelines?ref=master&sha=${sha}&source=push&per_page=100`, jobsKey = 'projects/7/pipelines/31/jobs?per_page=100&include_retried=false', ciKey = `projects/7/repository/files/.gitlab%2Fprimary.yml?ref=${sha}`;
  const artifact = {version:1,sourceCommit:sha,pipelineId:31,imageRef:image};
  const rows = {
    'projects/7':statusProject,'projects/7/repository/branches/master':{commit:{id:sha}},
    [pipelineKey]:[{id:31,sha,source:'push',status:'success',ref:'master'}], [ciKey]:file(ci),
    [jobsKey]:['build:wizard','test:wizard','build:source','test:browser'].map((name,i)=>({id:40+i,name,status:'success',allow_failure:false,commit:{id:sha},pipeline:{id:31}})),
    'projects/7/jobs/40/artifacts/build-evidence.json':{...artifact,testRunner:'vitest',unitTests:true,lint:true,typecheck:true,productionBuild:true},
    'projects/7/jobs/41/artifacts/wizard-evidence.json':{...artifact,...Object.fromEntries(['http','renderedUI','projects','spa','configurationBackup','cubeSignature'].map(key=>[key,true]))}
  };
  const status = new WizardSourcePrimaryStatusService();
  const api = (data) => ({request: async(method, route) => {assert.equal(method,'GET'); assert.ok(route in data,route); return {status:200,value:data[route]};}});
  const check = async(change=()=>{}) => {const data=structuredClone(rows);change(data);return status.execute(api(data),statusInput,data['projects/7']);};
  assert.equal((await check()).build.phase,'candidate-verified');
  const pending = await check(data=>data[pipelineKey][0].status='running'); assert.equal(pending.build.phase,'pending'); assert.equal(pending.build.artifact,undefined);
  for (const change of [data=>data['projects/7'].namespace.id=8,data=>data['projects/7'].only_allow_merge_if_pipeline_succeeds=false,data=>data[ciKey].content=encoded('edited'),data=>data[jobsKey][0].allow_failure=true,data=>data['projects/7/jobs/40/artifacts/build-evidence.json'].imageRef=image.replace('registry.example.test','foreign.example.test'),data=>data['projects/7/jobs/41/artifacts/wizard-evidence.json'].cubeSignature=false,data=>data[jobsKey][2].status='failed']) await assert.rejects(()=>check(change));
  for (const state of ['failed','pending','running','canceled']) {
    const result = await check(data=>{data[pipelineKey][0].status=state;data[jobsKey].push({id:44,name:'deploy:github',status:state,allow_failure:false,commit:{id:sha},pipeline:{id:31}});});
    assert.equal(result.build.phase,'candidate-verified');assert.equal(result.build.publishing.status,state);assert.equal(result.build.publishing.mirrorFailed,state==='failed');
  }
  let minted=0; const routes=[];
  const coordinator = new WizardSourceOperationService({ensure:async()=>({context:{},configDirectory:'/private',credential:{token:'admin'}})}, {current:async()=>{minted++;return {token:'scoped'};}}, {request:async(_context,token,method,route)=>{routes.push(route);assert.equal(token,route==='projects/7'?'admin':'scoped');return api(rows).request(method,route);}}, importer,status);
  assert.equal((await coordinator.execute('/checkout',statusInput)).build.phase,'candidate-verified'); assert.equal(minted,1);assert.ok(routes.includes('projects/7'));assert.ok(!routes.some(route=>route.includes('team%2Fwizard')));
  rows['projects/7'].only_allow_merge_if_pipeline_succeeds=false; await assert.rejects(()=>coordinator.execute('/checkout',statusInput),/binding changed/);assert.equal(minted,1,'conflicting ownership must not mint credentials');
  console.log('Wizard source import/status: atomic CAS, binary modes, lost responses, ownership, native evidence and mirror isolation passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
