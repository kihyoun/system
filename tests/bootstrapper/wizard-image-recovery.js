'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {localRegistry,projectForImage,recoverImage}=require('../../system/wizard-image-recovery');
const logo=require('../../sync/dist/Helper').default.textLogo;
const token='synthetic-registry-secret';
test('the isolated component context contains the exact public recovery implementation',()=>{
  const {included}=require('../prepare-context');
  for(const name of ['system/ensure-wizard-image.sh','system/wizard-image-recovery.js','system/wizard-registry-token.rb'])assert(included(name),name);
  assert(!included('system/.docker.env'));assert(!included('system/credentials.json'));
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
  const calls=[],actions=[];let privateConfig;
  const execute=(command,args,details={})=>{
    calls.push({command,args,details});
    if(command==='bash'){assert.deepEqual(args,['-e','start.sh','recovery']);return '';}
    assert.equal(command,'docker');assert.equal(args[0],'--host=unix:///var/run/docker.sock');
    assert.equal(details.env.DOCKER_HOST,undefined);
    if(args[1]==='image'&&args[2]==='inspect'){
      if(args[3]==='--format')return JSON.stringify(options.badDigest?[]:[image]);
      if(options.available)return '{}';
      throw Error('image is absent');
    }
    if(args[1]==='exec'){
      const encoded=/WIZARD_RECOVERY_INPUT='([^']+)'/.exec(details.input)[1];
      const input=JSON.parse(Buffer.from(encoded,'base64'));
      actions.push(input.action);
      if(options.revokeFailure&&input.action==='revoke')throw Error('synthetic revoke failed');
      if(input.action==='create')return options.badResponse?'not json':JSON.stringify({id:21,username:'gitlab+deploy-token-21',token});
      assert.equal(input.projectId,12);assert.equal(input.projectPath,'root/wizard');
      if(input.action==='revoke')assert.equal(input.tokenId,21);
      return '{"revoked":true}';
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
  return {root,image,receipt,content,settings,calls,actions,execute,waitReady,privateConfig:()=>privateConfig,pending:path.join(root,'.wizard-image-recovery.pending')};
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
for(const cause of ['pullFailure','badDigest','badResponse'])test(cause+' still revokes credentials and removes login state',async t=>{
  const f=fixture(t,{[cause]:true});
  await assert.rejects(recoverImage(f.settings,f));
  assert.deepEqual(f.actions,['create',cause==='badResponse'?'cleanup':'revoke']);
  if(f.privateConfig())assert(!fs.existsSync(f.privateConfig()));
  assert(!fs.existsSync(f.pending));
});
test('revocation failure preserves a retry obligation without preserving Docker login',async t=>{
  const f=fixture(t,{revokeFailure:true});
  await assert.rejects(recoverImage(f.settings,f),/revocation failed/);
  assert(fs.existsSync(f.pending));assert(!fs.existsSync(f.privateConfig()));
});
test('cached images still revoke interrupted credentials before clearing the pending marker',async t=>{
  const f=fixture(t,{available:true});fs.writeFileSync(f.pending,'previous interruption');
  await recoverImage(f.settings,f);
  assert.deepEqual(f.actions,['cleanup','cleanup']);assert(!fs.existsSync(f.pending));
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
  await recoverImage(f.settings,{...f,syncState(){observations.push({pending:fs.existsSync(f.pending),locked:fs.existsSync(path.join(f.root,'.wizard-image-recovery.lock')),actions:[...f.actions]});}});
  assert.deepEqual(observations,[{pending:true,locked:true,actions:[]},{pending:false,locked:false,actions:['create','revoke']}]);
});
test('a failed pending-directory durability barrier mints no token and preserves the cleanup obligation',async t=>{
  const f=fixture(t);let count=0;
  await assert.rejects(recoverImage(f.settings,{...f,syncState(){if(++count===1)throw Error('synthetic-directory-fsync-failure');}}),/directory-fsync-failure/);
  assert.deepEqual(f.actions,[]);assert(fs.existsSync(f.pending));assert.equal(count,2);
});
