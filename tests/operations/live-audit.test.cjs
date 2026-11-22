require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LiveAuditAccessService}=require('../../dist/modules/testing/liveAuditAccess.service');
const {LiveProjectAuditService}=require('../../dist/modules/testing/liveProjectAudit.service');
const {LiveRunnerAuditService}=require('../../dist/modules/testing/liveRunnerAudit.service');
const authority={context:{checkout:'/system',containerId:'a'.repeat(64)},credential:{id:12,userId:3,token:'private-controller-token',expiresAt:'2099-01-01'},account:{id:3,username:'system-bootstrapper-controller',email:'controller@example.invalid'}};
function fixture(t,scenario='success'){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'live-audit-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const configuration=path.join(directory,'.docker.env'),raw=Buffer.concat([fs.readFileSync(path.resolve(__dirname,'../../config/system/.docker.env.example')).subarray(0,1184),Buffer.from("\nexport GITLAB_RUNNER_TOKEN='glrt-runner'\nexport SYNC_USER='operator'\nexport SYNC_PASS='private-password'\n")]);fs.writeFileSync(configuration,raw,{mode:0o600});
 const calls=[];let project,scoped,revoked=false,deleted=false,scopedName,cleanupFailed=scenario==='cleanup-failed';
 const api={async request(context,token,method,route,body){calls.push({context,token,method,route,body});
  if(route==='personal_access_tokens/self')return {status:200,value:{id:12,user_id:3,revoked:false,active:scenario!=='inactive'}};
  if(route.startsWith('personal_access_tokens?'))return {status:200,value:scenario==='active-setup'?[{name:'system-bootstrapper-runner-setup',revoked:false}]:[]};
  if(route.startsWith('runners/all?'))return {status:200,value:scenario==='duplicate-pool'?[{id:4,description:'System Bootstrapper Docker pool',runner_type:'instance_type'},{id:5,description:'System Bootstrapper Docker pool',runner_type:'instance_type'}]:[{id:4,description:'System Bootstrapper Docker pool',runner_type:'instance_type'}]};
  if(route==='runners/4')return {status:200,value:{id:4,runner_type:'instance_type',status:'online'}};
  if(method==='POST'&&route==='projects'){project={id:7,path_with_namespace:authority.account.username+'/'+body.path,visibility:'private',description:body.description,default_branch:'main'};if(scenario==='create-uncertain')throw Error('gitlab-native-request-incomplete');return {status:201,value:project};}
  if(method==='GET'&&route.startsWith('projects/'+encodeURIComponent(authority.account.username+'/')))return project&&!deleted?{status:200,value:scenario==='foreign-project'?{...project,description:'foreign'}:project}:{status:404,value:null};
  if(method==='POST'&&route==='projects/7/access_tokens'){scoped='private-project-token';scopedName=body.name;return {status:201,value:{id:9,name:body.name,expires_at:body.expires_at,access_level:40,active:true,revoked:false,scopes:['api'],token:scoped}};}
  if(method==='POST'&&route==='projects/7/repository/files/.gitlab-ci.yml'){assert.equal(token,scoped);assert(body.content.includes('image: "alpine@sha256:'));return {status:201,value:{}};}
  if(route.startsWith('projects/7/pipelines?'))return {status:200,value:[{id:8,status:'success'}]};
  if(route==='projects/7/pipelines/8')return {status:200,value:{id:8,status:scenario==='pipeline-failed'?'failed':'success'}};
  if(route.startsWith('projects/7/pipelines/8/jobs?'))return {status:200,value:[{id:10,name:'runner-smoke',status:'success',runner:{id:scenario==='wrong-runner'?5:4}}]};
  if(method==='GET'&&route.startsWith('projects/7/access_tokens?'))return {status:200,value:scoped?[{id:9,name:scopedName,revoked}]:[]};
  if(method==='DELETE'&&route==='projects/7/access_tokens/9'){if(cleanupFailed)return {status:500,value:null};revoked=true;return {status:204,value:null};}
  if(route==='user'&&token===scoped)return {status:revoked?401:200,value:null};
  if(method==='GET'&&route==='projects/7')return {status:200,value:project};
  if(method==='DELETE'&&route==='projects/7'){deleted=true;return {status:202,value:null};}
  throw Error('Unexpected API request: '+method+' '+route);
 },async readBytes(_context,token,route){assert.equal(token,scoped);assert.equal(route,'projects/7/jobs/10/artifacts/runner-result.txt');return {status:200,bytes:Buffer.from(scenario==='bad-artifact'?'wrong':'runner-automation-ok\n')};}};
 const access=new LiveAuditAccessService({existing:async()=>structuredClone(authority)},api),runtime={async http(url,_signal,body,headers){if(url.endsWith('/login')){assert.equal(body.password,'private-password');return {status:200,body:Buffer.from('{"accessToken":"sync-access"}')};}assert.equal(headers.Authorization,'Bearer sync-access');return {status:200,body:Buffer.from(JSON.stringify({data:scenario==='bad-fetch'?raw.toString()+'changed':raw.toString()}))};}};
 return {directory,configuration,calls,access,runtime,service:new LiveRunnerAuditService(access,runtime),input:{checkout:'/system',configDirectory:'/srv/gitlab/config',allowDisposableProject:true,configuration,jobImage:'alpine@sha256:'+'a'.repeat(64),timeout:1},deleted:()=>deleted,revoked:()=>revoked,allowCleanup:()=>{cleanupFailed=false;}};
}
test('live audit module shares existing native authority and opens without running commands',async()=>{
 const {NestFactory}=require('@nestjs/core'),{LiveAuditModule}=require('../../dist/modules/testing/liveAudit.module'),{GitlabCredentialService}=require('../../dist/modules/gitlab-provision/credential.service');
 const app=await NestFactory.createApplicationContext(LiveAuditModule,{logger:false});try{assert.equal(app.get(LiveAuditAccessService).credentials,app.get(GitlabCredentialService));assert.equal(app.get(LiveRunnerAuditService).access,app.get(LiveAuditAccessService));}finally{await app.close();}
 const state={phase:'ready',account:{userId:3,username:'controller',email:'controller@example.invalid'},replacement:authority.credential};let reads=0;
 const credentials=new GitlabCredentialService({resolve:async()=>authority.context},{initial(){assert.fail('bootstrap must not run');}},{current(){assert.fail('renewal must not run');}},{withJournal:async(_directory,read)=>{reads++;return read({read:()=>state,save(){assert.fail('credentials must not be written');}});}});
 assert.equal((await credentials.existing({checkout:'/system'})).credential.token,authority.credential.token);assert.equal(reads,1);state.renewal=authority.credential;await assert.rejects(credentials.existing({checkout:'/system'}),/existing-controller-credential/);
});
test('runner live acceptance uses a private scoped token, exact runner/artifact/Fetch and owned cleanup',async t=>{
 const f=fixture(t),result=await f.service.execute(f.input);assert(result.pipelineSucceeded&&result.artifactVerified&&result.scopedCredentialRevoked&&result.disposableProjectDeletionRequested);assert(f.deleted()&&f.revoked());
 const receipt=JSON.parse(fs.readFileSync(result.operationRecord));assert.equal(receipt.phase,'cleanup-complete');assert(!JSON.stringify(receipt).includes('private-'));assert.equal(fs.statSync(result.operationRecord).mode&0o777,0o600);
 assert(!f.calls.some(call=>call.route==='personal_access_tokens/self'&&call.method==='DELETE'));assert(f.calls.filter(call=>call.route.startsWith('projects/7/pipelines')).every(call=>call.token==='private-project-token'));
});
test('runner live acceptance refuses implicit mutation and retains precise cleanup behavior on failed proof or uncertain creation',async t=>{
 const noOpt=fixture(t);await assert.rejects(noOpt.service.execute({...noOpt.input,allowDisposableProject:false}),/opt-in/);assert.equal(noOpt.calls.length,0);
 for(const scenario of ['inactive','active-setup','duplicate-pool','bad-fetch','pipeline-failed','wrong-runner','bad-artifact','create-uncertain','foreign-project']){
  const f=fixture(t,scenario);await assert.rejects(f.service.execute(f.input));
  if(['inactive','active-setup','duplicate-pool','bad-fetch'].includes(scenario))assert(!f.calls.some(call=>call.method==='POST'));
  else if(scenario==='foreign-project'){assert(!f.deleted()&&!f.revoked());const records=fs.readdirSync(f.directory).filter(name=>name.startsWith('live-runner-audit-'));assert.equal(records.length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,records[0]))).phase,'cleanup-started');}
  else {assert(f.deleted());if(scenario!=='create-uncertain')assert(f.revoked());}
 }
});
test('private runner audit cleanup cannot remove a different namespace or marker',async t=>{
 const f=fixture(t),filename=path.join(f.directory,'cleanup.json'),operation='a'.repeat(32),receipt={format:'system-live-runner-audit-v1',operation,projectPath:'foreign/runner-automation-smoke-'+operation,marker:'system-bootstrapper-live-runner:'+operation,tokenName:'live-runner-'+operation};fs.writeFileSync(filename,JSON.stringify(receipt),{mode:0o600});
 await assert.rejects(f.service.cleanup({...f.input,recordFile:filename}),/binding-changed/);assert(!f.calls.some(call=>call.method==='DELETE'));
 receipt.projectPath=authority.account.username+'/runner-automation-smoke-'+operation;fs.writeFileSync(filename,JSON.stringify(receipt));await f.service.cleanup({...f.input,recordFile:filename});assert.equal(JSON.parse(fs.readFileSync(filename)).phase,'cleanup-complete');
});
test('project and template audits preserve CI lint, immutable identity, source files, unique initial pipeline and deployments without retry writes',async t=>{
 const f=fixture(t),content=fs.readFileSync(f.configuration),calls=[];let changed=false;
 const project={id:7,name:'bootstrapdemo',path:'bootstrapdemo',path_with_namespace:'root/bootstrapdemo',visibility:'private',default_branch:'main',ci_config_path:'.system-bootstrapper/ci.yml'};
 const session={async json(method,route,body){calls.push({method,route,body});if(route==='projects/root%2Fbootstrapdemo'||route==='projects/7')return project;if(route.includes('/ci/lint'))return {valid:true};if(route.includes('/repository/files/')){const file=decodeURIComponent(route.split('/files/')[1].split('?')[0]);return {file_path:file,encoding:'base64',content:content.toString('base64')};}if(route==='projects/7/pipelines/8')return {id:8,status:'success'};throw Error('unexpected request');},async pages(route){if(route.includes('/pipelines?'))return changed?[{id:8},{id:9}]:[{id:8}];return [{name:'production'},{name:'review/main'}];},async setupRevoked(purpose){assert.equal(purpose,'project');}};
 const service=new LiveProjectAuditService({open:async()=>session});assert((await service.project({project:'root/bootstrapdemo'})).ciValid);
 const metadata=[{id:7,path:'root/bootstrapdemo',template:'web',initialPipeline:{id:8}}];assert.equal((await service.templates({projects:metadata,timeout:1}))[0].productionAndReview,true);
 assert(calls.every(call=>call.method==='GET'||call.route.endsWith('/ci/lint')));changed=true;await assert.rejects(service.templates({projects:metadata,timeout:1}),/duplicate-or-different/);
 const before=calls.length;await assert.rejects(service.templates({projects:[...metadata,...metadata],timeout:1}),/metadata-invalid/);assert.equal(calls.length,before);
});

test('runner cleanup retry uses the retained exact binding after a revocation transport failure',async t=>{
 const f=fixture(t,'cleanup-failed');await assert.rejects(f.service.execute(f.input),/API-request-refused/);assert(!f.deleted()&&!f.revoked());
 const filename=path.join(f.directory,fs.readdirSync(f.directory).find(name=>name.startsWith('live-runner-audit-')));assert.equal(JSON.parse(fs.readFileSync(filename)).phase,'cleanup-started');f.allowCleanup();
 await f.service.cleanup({...f.input,recordFile:filename});assert(f.deleted()&&f.revoked());assert.equal(JSON.parse(fs.readFileSync(filename)).phase,'cleanup-complete');
});
