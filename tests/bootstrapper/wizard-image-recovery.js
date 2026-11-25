'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {localRegistry,projectForImage}=require('../../dist/modules/wizard-recovery/identity');
const {WizardRecoveryService}=require('../../dist/modules/wizard-recovery/wizardRecovery.service');
const {syncDirectory}=require('../../dist/modules/wizard-recovery/identity');
const recoverImage=(settings,f)=>new WizardRecoveryService({run:async(command,args,details)=>f.execute(command,args,details)},
  {run:command=>{assert.equal(command.action,'recovery');assert.equal(command.environment.DOCKER_HOST,undefined);}},f.registry,{wait:f.waitReady},
  {syncDirectory:directory=>f.syncState?f.syncState():syncDirectory(directory)})
  .recover({checkout:path.resolve(__dirname,'../..'),settings,signal:f.signal});
const logo=require('../../dist/common/configurationSignature').default.textLogo;
const token='synthetic-registry-secret';
test('the isolated component context and native module contain the exact shared recovery implementation',async()=>{
  const {includedTest:included}=require('../../dist/modules/ci/contextSelection');
  for(const name of ['src/cli/applicationCommands.ts','src/modules/wizard-recovery/wizardRecovery.service.ts','src/modules/wizard-recovery/registry.service.ts'])assert(included(name),name);
  assert(!included('config/system/.docker.env'));assert(!included('config/system/credentials.json'));
  const {NestFactory}=require('../../node_modules/@nestjs/core'),{LifecycleModule}=require('../../dist/modules/lifecycle/lifecycle.module');
  const app=await NestFactory.createApplicationContext(LifecycleModule,{logger:false,abortOnError:false});assert(app.get(WizardRecoveryService));await app.close();
});
function fixture(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wizard-pull-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const image='registry.localhost:5050/root/wizard@sha256:'+'a'.repeat(64);
  const receipt={defaultProject:true,state:'complete',template:'wizard',repository:{systemProject:true,id:12,path:'root/wizard'}};
  const content=logo+'# BOOTSTRAPPER_PROJECT='+Buffer.from(JSON.stringify(receipt)).toString('base64')+'\n';
  fs.mkdirSync(path.join(root,'.projects.env'));
  fs.writeFileSync(path.join(root,'.projects.env/.wizard.env'),content);
  const settings={WIZARD_ENABLE:'true',WIZARD_IMAGE:image,GITLAB_REGISTRY_URL:'http://registry.localhost',GITLAB_REGISTRY_DOMAIN_MODE:'0',SYSTEM_CONFIG_DIR:root,DOCKER_CONFIG:'/untrusted/old-config',DOCKER_HOST:'tcp://unrelated:2375'};
  const calls=[],actions=[];let privateConfig,initializations=0;
  const execute=(command,args,details={})=>{
    calls.push({command,args,details});
    if(command===process.execPath && args.includes('routing')){assert.equal(args[2],'recovery');return '';}
    assert.equal(command,'docker');assert.equal(args[0],'--host=unix:///var/run/docker.sock');
    assert.equal(details.env.DOCKER_HOST,undefined);
    if(args[1]==='image'&&args[2]==='inspect'){
      if(args[3]==='--format')return JSON.stringify(options.badDigest?[]:[image]);
      if(options.available)return '{}';
      throw Error('image is absent');
    }
    assert.equal(args[1],'--config');privateConfig=args[2];
    assert.notEqual(privateConfig,settings.DOCKER_CONFIG);
    assert.equal(fs.statSync(privateConfig).mode&0o777,0o700);
    assert.equal(details.env.DOCKER_CONFIG,privateConfig);
    if(args[3]==='login'){
      assert.equal(args.at(-1),'--password-stdin');assert.equal(details.input,token+'\n');
      fs.writeFileSync(path.join(privateConfig,'config.json'),'private-login-fixture');
    }else{assert.equal(args[3],'pull');assert.equal(args[4],image);if(options.pullFailure)throw Error('synthetic pull failed');}
    return '';
  };
  const waitReady=async()=>{if(options.readinessFailure)throw Error('synthetic readiness failed');};
  const registry={async open(){
    initializations++;
    assert(fs.existsSync(path.join(root,'.wizard-image-recovery.pending')),'pending marker must precede credential initialization');
    return {async execute(input,signal){
      actions.push(input.action);
      if(options.revokeFailure&&input.action==='revoke')throw Error('synthetic revoke failed');
      assert.equal(input.projectId,12);assert.equal(input.projectPath,'root/wizard');
      if(input.action==='create'){
        if(options.badResponse)throw Error('lost credential response');
        return {id:21,username:'gitlab+deploy-token-21',token};
      }
      assert(signal&&!signal.aborted,'cleanup has an independent bounded cancellation context');
      if(input.action==='revoke')assert.equal(input.tokenId,21);
      return {revoked:true};
    }};
  }};
  return {root,image,receipt,content,settings,calls,actions,execute,waitReady,registry,initializations:()=>initializations,privateConfig:()=>privateConfig,pending:path.join(root,'.wizard-image-recovery.pending')};
}
test('local registry identity matches the effective HTTP registry port',()=>{
  assert.equal(localRegistry('http://registry.localhost','0').host,'registry.localhost:5050');
  assert.equal(localRegistry('https://registry.localhost','2').host,'registry.localhost');
  for(const url of ['https://user:pass@registry.localhost','https://registry.localhost/path','file:///tmp/config'])assert.throws(()=>localRegistry(url,2));
});
test('managed receipt, immutable digest and signature gate recovery credentials',t=>{
  const f=fixture(t);
  assert.equal(projectForImage(f.content,f.image,f.settings.GITLAB_REGISTRY_URL,0).projectId,12);
  for(const image of [f.image.replace('root/wizard','root/unrelated'),f.image.replace('@sha256:',':'),f.image.replace('registry.localhost','foreign.localhost')])assert.throws(()=>projectForImage(f.content,image,f.settings.GITLAB_REGISTRY_URL,0));
  assert.throws(()=>projectForImage(' '+f.content,f.image,f.settings.GITLAB_REGISTRY_URL,0),/signature/);
  assert.throws(()=>projectForImage(f.content+f.content.slice(logo.length),f.image,f.settings.GITLAB_REGISTRY_URL,0),/ambiguous/);
  for(const field of ['defaultProject','state','template']){
    const receipt={...f.receipt,[field]:false};
    const content=logo+'# BOOTSTRAPPER_PROJECT='+Buffer.from(JSON.stringify(receipt)).toString('base64')+'\n';
    assert.throws(()=>projectForImage(content,f.image,f.settings.GITLAB_REGISTRY_URL,0),/managed Wizard/);
  }
});
test('disabled and external images never mint local credentials',async t=>{
  const f=fixture(t);
  assert.equal((await recoverImage({...f.settings,WIZARD_ENABLE:'false'},f)).state,'disabled');
  assert.equal((await recoverImage({...f.settings,WIZARD_IMAGE:'public/wizard:stable'},f)).state,'external-image');
  assert.deepEqual(f.actions,[]);
});
test('exact cached pin skips registry login when no interrupted cleanup exists',async t=>{
  const f=fixture(t,{available:true});
  assert.equal((await recoverImage(f.settings,f)).state,'available');assert.deepEqual(f.actions,[]);
});
test('exact private digest is pulled with isolated stdin credentials and then revoked',async t=>{
  const f=fixture(t);
  assert.equal((await recoverImage(f.settings,f)).state,'recovered');
  assert.deepEqual(f.actions,['create','revoke']);
  assert(!fs.existsSync(f.privateConfig()));assert(!fs.existsSync(f.pending));
  assert(!JSON.stringify(f.calls.map(call=>call.args)).includes(token));
  assert(!fs.existsSync(path.join(f.root,'.wizard-image-recovery.lock')));
});
test('failed, uncertain and cancelled pulls still revoke credentials and remove login state',async t=>{
 for(const cause of ['pullFailure','badDigest','badResponse','cancelledPull']){
  const f=fixture(t,{[cause]:true});
  if(cause==='cancelledPull'){const abort=new AbortController();f.signal=abort.signal;const run=f.execute;f.execute=(command,args,details)=>{if(args.includes('pull')){abort.abort();throw Error('cancelled');}return run(command,args,details);};}
  await assert.rejects(recoverImage(f.settings,f));
  assert.deepEqual(f.actions,['create',cause==='badResponse'?'cleanup':'revoke']);
  if(f.privateConfig())assert(!fs.existsSync(f.privateConfig()));
  assert(!fs.existsSync(f.pending));
 }
});
test('revocation failure preserves a retry obligation without preserving Docker login',async t=>{
  const f=fixture(t,{revokeFailure:true});
  await assert.rejects(recoverImage(f.settings,f),/revocation failed/);
  assert(fs.existsSync(f.pending));assert(!fs.existsSync(f.privateConfig()));
});
test('cached images still revoke interrupted credentials before clearing the pending marker',async t=>{
  const f=fixture(t,{available:true});fs.writeFileSync(f.pending,'previous interruption');
  await recoverImage(f.settings,f);
  assert.deepEqual(f.actions,['cleanup']);assert(!fs.existsSync(f.pending));
});
test('unavailable GitLab retains the previous pending cleanup obligation',async t=>{
  const f=fixture(t,{readinessFailure:true});fs.writeFileSync(f.pending,'previous interruption');
  await assert.rejects(recoverImage(f.settings,f),/readiness failed/);
  assert.equal(fs.readFileSync(f.pending,'utf8'),'previous interruption');assert.deepEqual(f.actions,[]);
});
test('an existing recovery lease fails closed before minting credentials',async t=>{
  const f=fixture(t);fs.mkdirSync(path.join(f.root,'.wizard-image-recovery.lock'));
  await assert.rejects(recoverImage(f.settings,f),/lease requires operator inspection/);assert.deepEqual(f.actions,[]);
});
test('the pending obligation and lease are durable before minting and their removal is durable afterwards',async t=>{
  const f=fixture(t),observations=[];
  await recoverImage(f.settings,{...f,syncState(){observations.push({pending:fs.existsSync(f.pending),locked:fs.existsSync(path.join(f.root,'.wizard-image-recovery.lock')),actions:[...f.actions],initializations:f.initializations()});}});
  assert.deepEqual(observations,[{pending:true,locked:true,actions:[],initializations:0},{pending:false,locked:false,actions:['create','revoke'],initializations:1}]);
});
test('a failed pending-directory durability barrier mints no token and preserves the cleanup obligation',async t=>{
  const f=fixture(t);let count=0;
  await assert.rejects(recoverImage(f.settings,{...f,syncState(){if(++count===1)throw Error('synthetic-directory-fsync-failure');}}),/directory-fsync-failure/);
  assert.deepEqual(f.actions,[]);assert.equal(f.initializations(),0);assert(fs.existsSync(f.pending));assert.equal(count,2);
});

test('native registry credentials bind the exact project, expire next UTC day and remove only owned deploy tokens',async()=>{
  const {RecoveryRegistryCredentialService}=require('../../dist/modules/gitlab-provision/recoveryRegistryCredential.service');
  const name='system-bootstrapper-wizard-image-recovery', context={checkout:'/source',containerId:'a'.repeat(64)},calls=[],tokens=new Map();
  const fixtureToken=(id,scopes=['read_registry'],extra={})=>({id,name,scopes,username:`gitlab+deploy-token-${id}`,token:'fixture-registry-token',expires_at:'2026-11-21T00:00:00.000Z',revoked:false,expired:false,...extra});
  tokens.set(1,fixtureToken(1,['api'],{name:'unrelated'}));tokens.set(2,fixtureToken(2));
  let unexpected=false,lost=false;
  const api={async request(actual,administrator,method,route,body){
    assert.equal(actual,context);assert.equal(administrator,'fixture-administrator');calls.push({method,route,body});
    if(route==='projects/12')return {status:200,value:{id:12,path_with_namespace:'root/wizard'}};
    if(route==='user')return {status:200,value:{is_admin:true,state:'active'}};
    if(method==='GET'&&route==='projects/12/deploy_tokens?per_page=100&page=1')return {status:200,value:[...tokens.values()]};
    if(method==='POST'){
      assert.deepEqual(body,{name,scopes:['read_registry'],expires_at:'2026-11-21T00:00:00Z'});
      const created=fixtureToken(21,unexpected?['api']:['read_registry']);tokens.set(21,created);
      if(lost)throw Object.assign(Error('lost response'),{uncertain:true});
      return {status:201,value:created};
    }
    const match=/^projects\/12\/deploy_tokens\/(\d+)$/.exec(route);assert(match,route);const id=Number(match[1]);
    if(method==='GET')return {status:tokens.has(id)?200:404,value:tokens.get(id)};
    assert.equal(method,'DELETE');assert.notEqual(id,1);tokens.delete(id);return {status:204,value:null};
  }};
  const service=new RecoveryRegistryCredentialService(api),input={projectId:12,projectPath:'root/wizard',action:'create'},now=new Date('2026-11-20T23:59:59Z');
  assert.deepEqual(await service.execute(context,'fixture-administrator',input,now),{id:21,username:'gitlab+deploy-token-21',token:'fixture-registry-token'});
  assert(tokens.has(1));assert(!tokens.has(2));
  await service.execute(context,'fixture-administrator',{...input,action:'revoke',tokenId:21});assert(!tokens.has(21));
  await service.execute(context,'fixture-administrator',{...input,action:'revoke',tokenId:21});
  await assert.rejects(service.execute(context,'fixture-administrator',{...input,action:'revoke',tokenId:1}),/ownership/);assert(tokens.has(1));
  unexpected=true;await assert.rejects(service.execute(context,'fixture-administrator',input,now),/created-token-invalid/);assert(!tokens.has(21));
  unexpected=false;lost=true;await assert.rejects(service.execute(context,'fixture-administrator',input,now),/lost response/);assert(tokens.has(21));
  await service.execute(context,'fixture-administrator',{...input,action:'cleanup'});assert(!tokens.has(21));assert(tokens.has(1));
  const before=calls.length;await assert.rejects(service.execute(context,'fixture-administrator',{...input,projectPath:'wrong/wizard'}),/mismatch/);
  assert(!calls.slice(before).some(call=>call.method!=='GET'));
  const {WizardRecoveryRegistryService}=require('../../dist/modules/wizard-recovery/registry.service');
  const bound=[],abort=new AbortController();
  const bridge=new WizardRecoveryRegistryService({async ensure(options){return {context:{checkout:options.checkout,containerId:options.checkout},credential:{token:options.checkout+'-token'}};}},
    {async execute(actual,administrator,input){bound.push({actual,administrator,input});return {revoked:true};}});
  const first=await bridge.open({checkout:'/first',settings:{},signal:abort.signal});
  const second=await bridge.open({checkout:'/second',settings:{}});
  await first.execute({action:'create',projectId:12,projectPath:'root/wizard'});
  await second.execute({action:'cleanup',projectId:13,projectPath:'root/other'});
  abort.abort();const cleanupSignal=AbortSignal.timeout(1000);
  await first.execute({action:'revoke',projectId:12,projectPath:'root/wizard',tokenId:21},cleanupSignal);
  assert.deepEqual(bound.map(row=>row.actual.checkout),['/first','/second','/first']);
  assert.deepEqual(bound.map(row=>row.administrator),['/first-token','/second-token','/first-token']);
  assert.equal(bound[0].actual.signal,abort.signal);assert.equal(bound[2].actual.signal,cleanupSignal);assert(!bound[2].actual.signal.aborted);

});
