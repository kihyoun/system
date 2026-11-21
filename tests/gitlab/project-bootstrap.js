// Isolated contract tests: real Sync operations, disposable files and a Docker
// entry double. The separate live test exercises the real native API bridge.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const vm = require('vm');
const {spawn} = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-'));
const builtRuntime = path.resolve(__dirname, '../../dist');
const api = path.join(root, 'dist/api');
fs.cpSync(builtRuntime,path.join(root,'dist'),{recursive:true});
fs.mkdirSync(path.join(root,'bin'));
fs.mkdirSync(path.join(root,'state'));
fs.symlinkSync(path.resolve(__dirname,'../../node_modules'),path.join(root,'node_modules'),'dir');
const sourceRoot=path.resolve(__dirname,'../..');
const {PUBLIC_PACKAGE_PAYLOAD,verifyPublicPayload}=require('../../dist/common/public-payload');
for(const name of [...PUBLIC_PACKAGE_PAYLOAD,'assets/public-runtime.json','assets/wizard-source/snapshot.json']){
 const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(sourceRoot,name),target);
}
assert.equal(verifyPublicPayload(root).length,PUBLIC_PACKAGE_PAYLOAD.length,'Relocated application runs with the complete regular-file public payload.');
fs.symlinkSync(path.join(sourceRoot,'tools'),path.join(root,'tools'),'dir');
fs.renameSync(path.join(root,'dist/cli/main.js'),path.join(root,'dist/cli/native-main.js'));
const routingStatus=path.join(root,'routing-status');fs.writeFileSync(routingStatus,'0');
process.env.SYSTEM_CONFIG_DIR=path.join(root,'state');
const mock = `#!${process.execPath}
if(process.argv[2]==='api'){require('./native-main').main(['api']).catch(()=>{process.exitCode=1;});}
else if(process.argv[2]==='projects-routing'){process.exit(Number(require('fs').readFileSync(${JSON.stringify(routingStatus)},'utf8')));}
else {
let text = ''; process.stdin.on('data', chunk => text += chunk);
process.stdin.on('end', () => {
 const input = JSON.parse(text);
 require('fs').appendFileSync(${JSON.stringify(path.join(root, 'native-requests.jsonl'))}, JSON.stringify(input) + '\\n');
 if(input.projectKey==='uncertain')return process.exit(1);
 if(input.projectKey==='diagnostic')return console.log(JSON.stringify({state:'failed',message:'CI installation failed; retry Save',...input.fixtureResult}));
 const result = input.action === 'pipeline' ? {pipeline: {id: 123, webUrl: 'http://gitlab.localhost/pipeline', status: 'pending'}} :
 input.action === 'namespaces' ? {namespaces: [{id: 1, path: 'root'}]} :
 input.action === 'availability' ? {availability: input.projectKey === 'occupied' ? 'occupied' : 'available'} :
 input.projectKey === 'race' ? {state: 'failed', conflict: true, message: 'Repository already exists'} :
 {repository: {id: 42, namespaceId: Number(input.namespaceId), path: 'root/' + input.projectKey, defaultBranch: 'main', webUrl: 'http://gitlab.localhost/root/' + input.projectKey}};
 setTimeout(() => console.log(JSON.stringify(result)), 100);
});
}
`;
fs.writeFileSync(path.join(root, 'dist/cli/main.js'), mock, {mode: 0o755});
process.env.PATH = path.join(root, 'bin') + ':' + process.env.PATH;
process.chdir(root);
const bootstrap = require(path.join(api, 'projects/project-workflow'));
const logo = require(path.join(root,'dist/common/configuration-signature')).default.textLogo;
// Use the exact pinned Wizard Fetch parser and ProjectConfig serializer. Only
// browser/storage dependencies and MobX observation are inert in this fixture.
const snapshot = require('../../dist/modules/source-preparation/wizard-source.service').validate(JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../assets/wizard-source/snapshot.json'), 'utf8')));
const ts = require('../../node_modules/typescript');
const wizardModules = new Map();
const wizardStubs = {
  'file-saver': {}, jszip: {}, mobx: {makeAutoObservable: () => {}, observable: value => value, runInAction: operation => operation()},
  uuid: {v4: () => 'fixture-wizard'}, md5: {__esModule: true, default: require('../../node_modules/md5')},
  './MainConfig': {__esModule: true, default: class {}}, './SyncServer': {__esModule: true, default: class {}}, './Recovery': {}, './PreviewSetupIntent': {}
};
function wizardModule(name) {
  if (wizardModules.has(name)) return wizardModules.get(name);
  const entry = snapshot.files.find(file => file.path === 'src/api/' + name + '.tsx' || file.path === 'src/api/' + name + '.ts');
  assert(entry, 'Pinned Wizard model source is required: ' + name);
  const exports = {}; wizardModules.set(name, exports);
  const compiled = ts.transpileModule(Buffer.from(entry.content, 'base64').toString('utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  vm.runInNewContext(compiled, {exports, require: dependency => {
    if (Object.hasOwn(wizardStubs, dependency)) return wizardStubs[dependency];
    assert(/^\.\/(Main|ProjectConfig|Environment|Helper)$/.test(dependency), 'Unexpected Wizard dependency: ' + dependency);
    return wizardModule(dependency.slice(2));
  }});
  return exports;
}
const WizardMain = wizardModule('Main').default;
const WizardProject = wizardModule('ProjectConfig').default;
const wizardInput = project => ({projectKey: project.projectKey, namespaceId: project.namespaceId,
  template: project.template, data: project.content, ci: project.gitlabCi});
const fetchedWizardProject = (data, receipt) => {
  const main = new WizardMain(); main.importProjectEnvData(data);
  const project = main.projects.get('resume');
  project.repository = receipt.repository;
  project.namespaceId = project.repository.namespaceId;
  project.bootstrapPending = receipt.state !== 'complete'; project.template = receipt.template;
  return project;
};
const input = key => ({projectKey: key, namespaceId: '1', data: logo + '\nPROJECT_NAME="' + key + '"\nUSE_PROD_HOST="false"\nUSE_BETA_HOST="false"\nUSE_REVIEW_HOST="false"\n# created on first\n', ci: '# CI_DEFAULT_BRANCH\n'});
const wait = async job => {
  while (job.state === 'running') { await new Promise(resolve => setTimeout(resolve, 20)); }
  return job;
};
function request(route, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port: 8071, path: route,
      method: body ? 'POST' : 'GET', headers: {'Content-Type': 'application/json',
        ...(token ? {Authorization: 'Bearer ' + token} : {})}}, res => {
      let text = ''; res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({status: res.statusCode, data: text && /^[{[]/.test(text) ? JSON.parse(text) : text}));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
async function nativeProvisionContracts() {
  const {ProjectProvisionService}=require('../../dist/modules/gitlab-provision/project-provision.service');
  const payload={action:'create',projectKey:'application',namespaceId:'7',operation:'owned-operation',template:'angular',templateVersion:1,ci:'original generated CI',files:[{action:'create',file_path:'starter.ts',content:'initial starter'}]};
  const binding={id:42,namespaceId:7,path:'team/application',webUrl:'https://gitlab.example.test/team/application',defaultBranch:'main',pipelineUrl:'https://gitlab.example.test/team/application/-/pipelines',ciPath:'.system-bootstrapper/ci.yml',template:'angular',templateVersion:1,generatedCi:payload.ci,deploymentState:'awaiting-pipeline'};
  function fixture(){
    const state={exists:true,project:{id:42,path_with_namespace:'team/application',namespace:{id:7},visibility:'private',description:'System Bootstrapper operation owned-operation',default_branch:'main',ci_config_path:'.system-bootstrapper/ci.yml',web_url:binding.webUrl},files:{'.system-bootstrapper/ci.yml':'user-edited CI with product checks','src/app.ts':'user application source'},requests:[],pipelines:[],lose:null,loseMethod:null,createStatus:201,commitStatus:201,namespacePath:'team',projectKey:'application',controllerId:9,member:null,memberWriteStatus:null,memberWriteApplied:true,branchProtection:{name:'main',push_access_levels:[{access_level:40}],merge_access_levels:[{access_level:40}]}};
    const credentials={async ensure(){return {context:{checkout:'/checkout',containerId:'a'.repeat(64)},credential:{token:'private-api-token'},account:{id:state.controllerId}};}};
    const api={async request(context,token,method,route,body){
      assert.equal(token,'private-api-token');assert.equal(context.checkout,'/checkout');
      state.requests.push({method,route,body});
      let status=200,value={};
      if(route.startsWith('namespaces?')){const page=Number(new URL('http://local/'+route).searchParams.get('page'));value=page===1?Array.from({length:100},(_,i)=>({id:i+1,full_path:'group'+i})):[{id:101,full_path:'last'}];}
      else if(route==='namespaces/7')value={id:7,full_path:state.namespacePath};
      else if(route==='projects/'+encodeURIComponent(state.namespacePath+'/'+state.projectKey)){status=state.exists?200:404;value=state.project;}
      else if(method==='POST'&&route==='projects'){status=state.createStatus;if(status===201){state.exists=true;value=state.project;}}
      else if(method==='PUT'&&route==='projects/42'){state.project.ci_config_path=body.ci_config_path;value=state.project;}
      else if(method==='GET'&&route==='projects/42/members/'+state.controllerId){status=state.member?200:404;value=state.member||{};}
      else if((method==='POST'&&route==='projects/42/members')||(method==='PUT'&&route==='projects/42/members/'+state.controllerId)){
        assert.equal(body.access_level,40);if(method==='POST')assert.equal(body.user_id,state.controllerId);
        status=state.memberWriteStatus??(method==='POST'?201:200);
        if(state.memberWriteApplied)state.member={id:state.controllerId,access_level:40,state:'active',expires_at:null};
        value=state.member||{};
      }
      else if(method==='POST'&&route==='projects/42/repository/commits'){
        assert(state.member?.access_level>=state.branchProtection.push_access_levels[0].access_level,'protected default branch requires explicit controller membership');
        if(state.commitStatus!==201)return {status:state.commitStatus,value:{message:'private-upstream-refusal',token:'private-upstream-token'}};
        for(const action of body.actions){assert.equal(action.action,'create');assert(!Object.hasOwn(state.files,action.file_path),'never overwrite user files');state.files[action.file_path]=action.content;}
        status=201;
      }else if(method==='GET'&&route.startsWith('projects/42/repository/files/')){
        const url=new URL('http://local/'+route),name=decodeURIComponent(url.pathname.split('/files/')[1]);assert.equal(url.searchParams.get('ref'),'main');
        status=Object.hasOwn(state.files,name)?200:404;value={content:Buffer.from(state.files[name]||'').toString('base64'),last_commit_id:'b'.repeat(40)};
      }else if(method==='GET'&&route.startsWith('projects/42/pipelines?'))value=state.pipelines;
      else if(method==='POST'&&route==='projects/42/pipeline'){value={id:91,source:'api',web_url:'https://gitlab.example.test/pipelines/91',status:'pending'};state.pipelines.push(value);status=201;}
      else throw Error('unexpected native request');
      if(state.lose===route&&(!state.loseMethod||state.loseMethod===method)){state.lose=null;throw Error('private lost response');}
      return {status,value};
    }};
    return {state,service:new ProjectProvisionService(credentials,api),invoke(input=payload){return this.service.execute('/checkout',input);}};
  }
  let f=fixture(),before=structuredClone(f.state.files);
  assert.deepEqual((await f.invoke({...payload,resumeRepository:binding})).repository,binding);
  assert(f.state.requests.every(row=>row.method==='GET'));assert.deepEqual(f.state.files,before);
  const mutations=[s=>s.exists=false,s=>s.project.id=43,s=>s.project.path_with_namespace='other/application',s=>s.project.namespace.id=8,s=>s.project.visibility='public',s=>s.project.description='foreign',s=>s.project.default_branch='other',s=>s.project.ci_config_path='.gitlab-ci.yml',s=>delete s.files['.system-bootstrapper/ci.yml']];
  for(const mutate of [...mutations.map(change=>(s,b)=>change(s)),...['id','namespaceId','defaultBranch','ciPath','path'].flatMap(key=>(key==='id'||key==='namespaceId'?[0,42.5]:['','other']).map(value=>(s,b)=>b[key]=value))]){
    f=fixture();const bound=structuredClone(binding);mutate(f.state,bound);before=structuredClone(f.state.files);
    assert.equal((await f.invoke({...payload,resumeRepository:bound})).state,'failed');assert(f.state.requests.every(row=>row.method==='GET'));assert.deepEqual(f.state.files,before);
  }
  f=fixture();assert.match((await f.invoke()).message,/Managed CI changed/);assert(f.state.requests.every(row=>row.method==='GET'));
  f=fixture();f.state.project.description='foreign';assert.equal((await f.invoke()).conflict,true);assert(f.state.requests.every(row=>row.method==='GET'));
  f=fixture();f.state.exists=false;delete f.state.files['.system-bootstrapper/ci.yml'];assert.equal((await f.invoke()).repository.id,42);
  assert.deepEqual(f.state.requests.filter(row=>row.method!=='GET').map(row=>row.method),['POST','POST','POST','PUT']);assert.equal(f.state.files['starter.ts'],'initial starter');
  for(const route of ['projects','projects/42/repository/commits','projects/42']){
    f=fixture();f.state.exists=false;delete f.state.files['.system-bootstrapper/ci.yml'];f.state.lose=route;
    await assert.rejects(()=>f.invoke(),error=>error.uncertain===true&&!error.message.includes('private'));
    assert.equal((await f.invoke()).repository.id,42);assert.equal(f.state.requests.filter(row=>row.method==='POST'&&row.route==='projects/42/repository/commits').length,1);
  }
  for(const status of [200,400,401,403,404,409,422,500,502,503,504,599,0,600,400.5,'private-status']){
    f=fixture();delete f.state.files['.system-bootstrapper/ci.yml'];f.state.commitStatus=status;
    before=structuredClone(f.state.files);const protection=structuredClone(f.state.branchProtection);
    const result=await f.invoke();
    assert.deepEqual(result,{state:'failed',message:'CI installation failed; retry Save',
      ...(Number.isInteger(status)&&status>=100&&status<=599?{diagnostic:{phase:'managed-ci-commit',httpStatus:status}}:{})});
    assert.deepEqual(f.state.files,before);assert.deepEqual(f.state.branchProtection,protection);
    assert.equal(f.state.requests.filter(row=>row.route==='projects/42/repository/commits').length,1);
    assert(!JSON.stringify(result).includes('private-'));assert(!f.state.requests.some(row=>row.method==='PUT'&&row.route==='projects/42'));
  }
  // The permanent controller administrator is distinct from the personal
  // namespace owner and needs direct membership to push protected main.
  f=fixture();delete f.state.files['.system-bootstrapper/ci.yml'];f.state.namespacePath='root';f.state.projectKey='wizard';f.state.project.path_with_namespace='root/wizard';
  const protection=structuredClone(f.state.branchProtection);
  assert.equal((await f.invoke({...payload,projectKey:'wizard',template:'wizard',files:undefined,controllerId:1})).repository.path,'root/wizard');
  assert.deepEqual(f.state.member,{id:9,access_level:40,state:'active',expires_at:null});assert.deepEqual(f.state.branchProtection,protection);
  const memberWrite=f.state.requests.findIndex(row=>row.method==='POST'&&row.route==='projects/42/members');
  const memberProof=f.state.requests.findIndex((row,index)=>index>memberWrite&&row.method==='GET'&&row.route==='projects/42/members/9');
  const commit=f.state.requests.findIndex(row=>row.route==='projects/42/repository/commits');
  assert(memberWrite>0&&memberProof>memberWrite&&commit>memberProof,'membership is read back before installing owned CI');
  assert(!f.state.requests.some(row=>/protected_branches/.test(row.route)));
  for(const level of [30,40,50]){
    f=fixture();delete f.state.files['.system-bootstrapper/ci.yml'];f.state.member={id:9,access_level:level,state:'active',expires_at:null};
    assert.equal((await f.invoke()).repository.id,42);
    const writes=f.state.requests.filter(row=>row.route.includes('/members')&&row.method!=='GET');
    assert.deepEqual(writes.map(row=>row.method),level<40?['PUT']:[]);assert.equal(f.state.member.access_level,Math.max(level,40));
    assert.deepEqual(f.state.branchProtection,protection);
  }
  for(const change of [s=>s.member.id=10,s=>s.member.access_level=40.5,s=>s.member.access_level=51,s=>s.member.state='blocked',s=>s.member.membership_state='awaiting',s=>s.member.expires_at='2099-01-01',s=>s.controllerId=0]){
    f=fixture();delete f.state.files['.system-bootstrapper/ci.yml'];f.state.member={id:9,access_level:40,state:'active',expires_at:null};change(f.state);
    assert.equal((await f.invoke()).state,'failed');assert(f.state.requests.every(row=>row.method==='GET'));assert(!Object.hasOwn(f.state.files,'.system-bootstrapper/ci.yml'));
  }
  for(const change of [s=>s.project.path_with_namespace='other/application',s=>s.project.namespace.id=8,s=>s.project.visibility='public',s=>s.project.description='foreign',s=>s.project.id=0]){
    f=fixture();delete f.state.files['.system-bootstrapper/ci.yml'];change(f.state);
    assert.equal((await f.invoke()).state,'failed');assert(f.state.requests.every(row=>row.method==='GET'));assert(!f.state.requests.some(row=>row.route.includes('/members')));
  }
  for(const status of [403,409]){
    f=fixture();delete f.state.files['.system-bootstrapper/ci.yml'];f.state.memberWriteStatus=status;f.state.memberWriteApplied=false;
    assert.equal((await f.invoke()).state,'failed');assert(!Object.hasOwn(f.state.files,'.system-bootstrapper/ci.yml'));
  }
  f=fixture();delete f.state.files['.system-bootstrapper/ci.yml'];f.state.memberWriteStatus=409;
  assert.equal((await f.invoke()).repository.id,42,'a competing membership creation needs exact adequate readback');
  for(const method of ['POST','PUT']){
    f=fixture();delete f.state.files['.system-bootstrapper/ci.yml'];if(method==='PUT')f.state.member={id:9,access_level:30,state:'active',expires_at:null};
    f.state.lose=method==='POST'?'projects/42/members':'projects/42/members/9';f.state.loseMethod=method;
    await assert.rejects(()=>f.invoke(),error=>error.uncertain===true&&!error.message.includes('private'));
    assert.equal((await f.invoke()).repository.id,42);
    assert.equal(f.state.requests.filter(row=>row.route.includes('/members')&&row.method!=='GET').length,1,'lost membership responses reconcile without replaying the mutation');
    assert.equal(f.state.requests.filter(row=>row.route==='projects/42/repository/commits').length,1);
  }
  f=fixture();f.state.lose='projects/42/pipeline';await assert.rejects(()=>f.invoke({...payload,action:'pipeline'}),error=>error.uncertain===true);
  assert.equal((await f.invoke({...payload,action:'pipeline'})).pipeline.id,91);assert.equal(f.state.requests.filter(row=>row.method==='POST').length,1);
  f=fixture();assert.equal((await f.invoke({action:'namespaces'})).namespaces.length,101);assert.equal(f.state.requests.length,2);
  for(const exists of [false,true]){f=fixture();f.state.exists=exists;assert.equal((await f.invoke({...payload,action:'availability'})).availability,exists?'occupied':'available');assert(f.state.requests.every(row=>row.method==='GET'));}
  for(const status of [400,409,403]){f=fixture();f.state.exists=false;f.state.createStatus=status;const result=await f.invoke();assert.equal(result.state,'failed');assert.equal(result.conflict,status!==403);assert.equal(f.state.requests.filter(row=>row.method!=='GET').length,1);}
  f=fixture();assert.equal((await f.invoke({...payload,projectKey:'application\n'})).state,'failed');assert.equal(f.state.requests.length,0);
  const {NestFactory}=require('../../node_modules/@nestjs/core');
  const {GitlabProvisionModule}=require('../../dist/modules/gitlab-provision/gitlab-provision.module');
  const app=await NestFactory.createApplicationContext(GitlabProvisionModule,{logger:false,abortOnError:false});
  try{assert(app.get(ProjectProvisionService) instanceof ProjectProvisionService);}finally{await app.close();}
  console.log('Native project provisioning: paginated read-only discovery, exact resume identity, unchanged edited source, protected-branch controller membership, creation races, interrupted writes and pipeline retry reconciliation passed.');
}

let child;
(async () => {
  await nativeProvisionContracts();
  const output=[],originalLog=console.log;
  console.log=(...values)=>output.push(values.join(' '));
  try{
    for(const httpStatus of [100,200,400,403,409,422,500,599]){
      output.length=0;
      const result=await bootstrap.rails({action:'create',projectKey:'diagnostic',fixtureResult:{diagnostic:{phase:'managed-ci-commit',httpStatus}}});
      assert.deepEqual(result,{state:'failed',message:'CI installation failed; retry Save'});
      assert.deepEqual(output,['BOOTSTRAPPER_PROJECT_CI_COMMIT_HTTP:'+httpStatus]);
    }
    for(const fixtureResult of [
      {diagnostic:null},{diagnostic:'private-diagnostic'},
      ...[99,600,201,400.5,'400','400\nprivate-secret'].map(httpStatus=>({diagnostic:{phase:'managed-ci-commit',httpStatus}})),
      {diagnostic:{phase:'private-phase',httpStatus:400}},
      {diagnostic:{phase:'managed-ci-commit',httpStatus:400,body:'private-upstream-body'}},
      {state:'complete',diagnostic:{phase:'managed-ci-commit',httpStatus:400}},
      {message:'private-upstream-message',diagnostic:{phase:'managed-ci-commit',httpStatus:400}},
    ]){
      output.length=0;
      await assert.rejects(()=>bootstrap.rails({action:'create',projectKey:'diagnostic',fixtureResult}),error=>error.uncertain===true&&!error.message.includes('private-'));
      assert.deepEqual(output,[],'Invalid internal diagnostics must never become a log line.');
    }
    output.length=0;
    const failed=await wait(bootstrap.createProject({...input('diagnostic'),fixtureResult:{diagnostic:{phase:'managed-ci-commit',httpStatus:400}}}));
    assert.equal(failed.state,'failed');assert.equal(failed.message,'CI installation failed; retry Save');
    assert(!Object.hasOwn(failed,'diagnostic'));assert.deepEqual(output,['BOOTSTRAPPER_PROJECT_CI_COMMIT_HTTP:400']);
    const retained=bootstrap.readReceipt(fs.readFileSync(path.join(root,'state/.projects.env/.diagnostic.env'),'utf8'));
    assert.equal(retained.state,'pending');assert(!Object.hasOwn(retained,'diagnostic'));assert.equal(retained.repository,undefined);
  }finally{console.log=originalLog;}
  for (const key of ['', 'A', 'a-b', 'ä', 'a b', '../x', null]) {
    assert(!bootstrap.validProjectKey(key));
    assert.throws(() => bootstrap.createProject(input(key)));
  }
  const hostile = input('hostile'); hostile.data += 'PROD_HOST="$(touch /tmp/unsafe)"\n';
  assert.throws(() => bootstrap.createProject(hostile));
  const signature = input('signature'); signature.data = 'not a configuration';
  assert.throws(() => bootstrap.createProject(signature));
  const data = input('example');
  const first = bootstrap.createProject(data);
  assert.equal(bootstrap.createProject(data).id, first.id, 'concurrent Saves share one operation');
  assert(bootstrap.projectBusy());
  assert.throws(() => bootstrap.createProject({...data, namespaceId: '2'}));
  assert.equal((await wait(first)).state, 'complete');
  assert(!bootstrap.projectBusy());
  assert.equal(bootstrap.createProject({...data, data: data.data.replace('created on first', 'created on later')}).id, first.id);
  assert.throws(() => bootstrap.createProject({...data, ci: '# changed CI_DEFAULT_BRANCH\n'}), /already exists locally/);
  const receipt = bootstrap.readReceipt(fs.readFileSync(path.join(root, 'state/.projects.env/.example.env'), 'utf8'));
  assert.equal(receipt.repository.id, 42);
  assert.equal(receipt.repository.defaultBranch, 'main');
  assert.equal((await wait(bootstrap.createProject(input('race')))).state, 'failed');
  assert(!fs.existsSync(path.join(root, 'state/.projects.env/.race.env')), 'collision does not claim foreign repository locally');
  assert.equal((await wait(bootstrap.queryGitlab({action: 'availability', projectKey: 'occupied', namespaceId: 1}))).availability, 'occupied');
  fs.writeFileSync(routingStatus,'1');
  const model = new WizardProject(new WizardMain(), {projectKey: 'resume', namespaceId: '1', template: 'angular',
    useProdHost: 'false', useBetaHost: 'false', useReviewHost: 'false', prodDomainMode: 0, betaDomainMode: 0,
    reviewDomainMode: 1, prodDeployMode: 1, betaDeployMode: 1, reviewDeployMode: 1, gitlabRunnerToken: 'fixture', gitlabRunnerScale: 1});
  const original = wizardInput(model);
  const interrupted = bootstrap.createProject(original);
  assert.equal((await wait(interrupted)).state, 'failed');
  const resumeFile = path.join(root, 'state/.projects.env/.resume.env');
  const pending = bootstrap.readReceipt(fs.readFileSync(resumeFile, 'utf8'));
  assert.equal(pending.state, 'pending'); assert.equal(pending.repository.id, 42);
  const fetchedModel = fetchedWizardProject(fs.readFileSync(resumeFile, 'utf8'), pending);
  const saved = wizardInput(fetchedModel);
  assert(saved.data.indexOf('# BOOTSTRAPPER_PROJECT=') < saved.data.indexOf('# created on '));
  assert.equal(saved.data.slice(0, 1184), logo.slice(0, 1184));
  assert.throws(() => bootstrap.createProject({...saved, namespaceId: '2'}), /already exists locally/);
  assert.throws(() => bootstrap.createProject({...saved, data: saved.data.replace('GITLAB_RUNNER_SCALE="1"', 'GITLAB_RUNNER_SCALE="2"')}), /already exists locally/);
  assert.throws(() => bootstrap.createProject({...saved, template: 'react', data: saved.data.replace('PROJECT_TEMPLATE="angular"', 'PROJECT_TEMPLATE="react"')}), /already exists locally/);
  fs.writeFileSync(routingStatus,'0');
  delete require.cache[require.resolve(path.join(api, 'projects/project-workflow'))];
  const restarted = require(path.join(api, 'projects/project-workflow'));
  const resumed = restarted.createProject({...saved, resumeRepository: {id: 999}});
  assert.equal(resumed.id, interrupted.id, 'restart resumes the durable operation');
  assert.equal((await wait(resumed)).state, 'complete');
  const completedData = fs.readFileSync(resumeFile, 'utf8');
  const completed = restarted.readReceipt(completedData);
  assert.equal(completed.fingerprint, pending.fingerprint, 'unchanged Wizard serialization preserves the original fingerprint');
  assert.equal(completed.operation, pending.operation); assert.equal(completed.repository.id, pending.repository.id);
  assert.equal(completed.state, 'complete');
  assert.equal(completedData.split('\n').filter(line => line.startsWith('# BOOTSTRAPPER_PROJECT=')).length, 1);
  const forged = Buffer.from(JSON.stringify({...pending, operation: 'f'.repeat(48), state: 'complete', repository: {id: 999}})).toString('base64');
  const hostileRetry = {...saved, data: saved.data.replace(/^# BOOTSTRAPPER_PROJECT=.*$/m, '# BOOTSTRAPPER_PROJECT=' + forged), resumeRepository: {id: 999}};
  assert.equal(restarted.createProject(hostileRetry).id, pending.operation, 'client metadata cannot replace the authoritative receipt');
  assert.equal(restarted.readReceipt(fs.readFileSync(resumeFile, 'utf8')).repository.id, 42);
  const requests = fs.readFileSync(path.join(root, 'native-requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const resumedCreates = requests.filter(request => request.action === 'create' && request.projectKey === 'resume');
  assert.equal(resumedCreates.length, 2); assert.equal(resumedCreates[1].operation, pending.operation);
  assert.deepEqual(resumedCreates[1].resumeRepository, pending.repository, 'only the retained server repository binds resumed provisioning');
  assert(!resumedCreates[1].data.includes('# BOOTSTRAPPER_PROJECT='), 'client receipt metadata is not forwarded to provisioning');
  const newForged = input('forged');
  newForged.data += '# BOOTSTRAPPER_PROJECT=' + forged + '\n'; newForged.resumeRepository = {id: 999};
  const reserved = restarted.createProject(newForged);
  const forgedFile = path.join(root, 'state/.projects.env/.forged.env');
  assert.equal(restarted.readReceipt(fs.readFileSync(forgedFile, 'utf8')).operation, reserved.id, 'initial reservation is server-owned');
  assert.equal((await wait(reserved)).state, 'complete');
  const forgedData = fs.readFileSync(forgedFile, 'utf8');
  assert.equal(restarted.readReceipt(forgedData).repository.id, 42);
  assert.equal(forgedData.split('\n').filter(line => line.startsWith('# BOOTSTRAPPER_PROJECT=')).length, 1);
  const newCreate = fs.readFileSync(path.join(root, 'native-requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    .find(request => request.action === 'create' && request.projectKey === 'forged');
  assert(!Object.hasOwn(newCreate, 'resumeRepository'), 'new provisioning never accepts a client repository binding');
  const rewritten = path.join(root, 'receipt-rewrite.env');
  restarted.writeReceipt(rewritten, completedData + '# BOOTSTRAPPER_PROJECT=' + forged + '\n', completed);
  const rewrittenData = fs.readFileSync(rewritten, 'utf8');
  assert.equal(rewrittenData.split('\n').filter(line => line.startsWith('# BOOTSTRAPPER_PROJECT=')).length, 1);
  assert.deepEqual(restarted.readReceipt(rewrittenData), completed);
  assert.equal(rewrittenData.slice(0, 1184), original.data.slice(0, 1184));
  const nativeInterrupted = await wait(bootstrap.createProject(input('uncertain')));
  assert.equal(nativeInterrupted.uncertain, true);assert.equal(nativeInterrupted.uncertainAction, 'create');
  assert(fs.existsSync(path.join(root,'state/.projects.env/.uncertain.env')),'unconfirmed native writes retain the operation receipt');
  const application = await wait(bootstrap.createProject({...input('reactapp'), template: 'react'}));
  assert.equal(application.state, 'complete');
  assert.equal(application.repository.initialPipeline.id, 123);
  assert.equal(application.repository.deploymentState, 'pipeline-started');
  child = spawn(process.execPath, [path.join(root, 'dist/cli/main.js'),'api'], {cwd: root,
    env: {...process.env, SYNC_USER: 'test', SYNC_PASS: 'test-password'}, stdio: 'ignore'});
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await request('/status'); break; } catch (_) { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal((await request('/projects/namespaces')).status, 401);
  assert.equal((await request('/projects', null, input('unauthorized'))).status, 401);
  const login = await request('/login', null, {username: 'test', password: 'test-password'});
  const token = login.data.accessToken;
  assert.equal((await request('/projects/availability?projectKey=A&namespaceId=1', token)).status, 400);
  assert.equal((await request('/projects', token, input('Bad'))).status, 400);
  const accepted = await request('/projects', token, input('api'));
  assert.equal(accepted.status, 202);
  assert.equal((await request('/status', token)).status, 200, 'Sync remains responsive');
  assert.equal((await request('/config/main', token, {})).status, 409, 'Push cannot race provisioning');
  let job;
  do { await new Promise(resolve => setTimeout(resolve, 50)); job = await request('/projects/jobs/' + accepted.data.id, token); } while (job.data.state === 'running');
  assert.equal(job.data.state, 'complete');
  const fetched = await request('/config/projects', token);
  const project = fetched.data.find(file => file.filename === '.api.env');
  assert.equal(project.repository.id, 42);
  assert.equal(project.data.substr(807, 1), '$');
  assert.equal(require('crypto').createHash('md5').update(project.data.substr(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
  console.log('Project bootstrap validation, idempotency, namespace conflict, race, authentication, polling and Fetch tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (child) child.kill(); fs.rmSync(root, {recursive: true, force: true}); });
