'use strict';
// Stateful reconciliation cases consolidated from the former Python suite.
const assert=require('node:assert/strict');
const {RenovateSetupService,protectedDefaultRules,BOT_MARKER}=require('../../operations/dist/renovate/setup.service');
const {RenovateApi}=require('../../operations/dist/renovate/api');
const protection=(name='main',push=40,merge=40)=>({name,push_access_levels:[{access_level:push}],merge_access_levels:[{access_level:merge}]});
class GitLab {
  constructor(){this.user=null;this.members={};this.variables={};this.tokens=[];this.schedules=[];this.calls=[];this.extra=[];this.rules={};}
  async get(route){return this.call('GET',route);}
  async all(route){
    this.calls.push(['GET',route]);
    if(route.endsWith('/protected_branches'))return this.rules[route.split('/')[2]]||[protection()];
    if(route.endsWith('/memberships'))return [...Object.keys(this.members).map(id=>({source_type:'Project',source_id:Number(id),access_level:30})),...this.extra];
    if(route.startsWith('/personal_access_tokens?'))return this.tokens.filter(t=>!t.revoked);
    if(route.endsWith('/pipeline_schedules'))return this.schedules;
    throw Error(route);
  }
  async call(method,route,data){
    this.calls.push([method,route,data]);const parts=route.split('/');
    if(method==='GET'&&['/projects/10','/projects/11'].includes(route))return {id:Number(parts[2]),default_branch:'main',path_with_namespace:'example/'+(parts[2]==='10'?'system':'wizard')};
    if(route.startsWith('/users?'))return this.user?[this.user]:[];
    if(route==='/users'&&method==='POST'){this.user={...data,id:9,is_admin:false,state:'active'};return this.user;}
    if(route==='/users/9'){if(method==='PUT')Object.assign(this.user,data);return this.user;}
    if(route.endsWith('/personal_access_tokens')){const token={...data,id:this.tokens.length+1,token:'fixture-only',revoked:false};this.tokens.push(token);return token;}
    if(route.startsWith('/personal_access_tokens/')&&method==='DELETE'){this.tokens.find(t=>t.id===Number(parts.at(-1))).revoked=true;return;}
    if(route.includes('/members')){const id=parts[2];if(method==='GET')return this.members[id]||null;return this.members[id]={...data};}
    if(route.includes('/variables')&&!route.includes('/pipeline_schedules/')){if(method==='GET')return this.variables[parts.at(-1)]||null;return this.variables[data.key||parts.at(-1)]=data;}
    if(route==='/projects/10/pipeline_schedules'&&method==='POST'){this.schedules.push({...data,id:3,variables:[]});return this.schedules[0];}
    if(route==='/projects/10/pipeline_schedules/3'){if(method==='PUT')Object.assign(this.schedules[0],data);return this.schedules[0];}
    if(route.endsWith('/take_ownership'))return;
    if(route.includes('/pipeline_schedules/3/variables')){this.schedules[0].variables=[data];return data;}
    throw Error(method+' '+route);
  }
}
module.exports=async function run(){
  const service=new RenovateSetupService();
  function fixture(ids=[10,11]){
    const api=new GitLab(),state={},config={endpoint:'https://gitlab.example.com/api/v4',username:'dependency-bot',email:'bot@example.com',project_ids:ids};
    const f={api,state,config,journal:null};
    f.port={save:async s=>{f.journal=structuredClone(s);},bot:()=>({get:async()=>({id:9,is_admin:false})}),now:()=>new Date('2026-11-20T00:00:00Z')};
    f.run=(options={},saved=state)=>service.reconcile(api,config,saved,f.port,options);return f;
  }
  const readOnly=f=>assert(f.api.calls.every(c=>c[0]==='GET'));
  for(const ids of [[10],[10,11]]){
    const f=fixture(ids);assert.equal((await f.run()).active,false);assert.deepEqual(Object.keys(f.api.members).map(Number),ids);
    assert(Object.values(f.api.members).every(m=>m.access_level===30));
    const variable=f.api.variables.RENOVATE_TOKEN;assert(variable.protected&&variable.masked&&variable.raw);
    await f.run({enabled:true});assert.equal(f.api.tokens.length,1);assert.equal(f.api.schedules.length,1);
    await f.run({rotate:true,enabled:true});assert.equal(f.api.tokens.length,2);assert(f.api.tokens[0].revoked);
    const revoke=f.api.calls.findIndex(c=>c[0]==='DELETE');assert(f.api.calls.some((c,i)=>i<revoke&&c[0]==='PUT'&&c[1].endsWith('/RENOVATE_TOKEN')));
    assert.equal(f.journal.token_id,2);await f.run();assert.equal(f.api.schedules[0].active,false);
  }
  for(const ids of [[],[10,10],[10,11,12],[true],[0],['10'],'10',null]){const f=fixture(ids);await assert.rejects(f.run());assert.equal(f.api.calls.length,0);}
  for(const mutate of [
    f=>{f.config.project_ids=[10];},f=>{f.api.extra=[{source_type:'Namespace',source_id:99}];},
    f=>{f.api.user.email='other@example.com';},f=>{f.api.tokens.push({id:99,name:'unrelated',scopes:['api']});f.api.members={};},
    f=>{f.api.rules[11]=[protection(),protection('*',30)];},
  ]){const f=fixture();await f.run();mutate(f);f.api.calls=[];await assert.rejects(f.run({rotate:true}));readOnly(f);}
  for(const project of [10,11])for(const pattern of ['*','m*','*ain'])for(const permission of ['push_access_levels','merge_access_levels']){
    const f=fixture(),rule=protection(pattern);rule[permission]=[{access_level:30}];f.api.rules[project]=[protection(),rule];await assert.rejects(f.run());assert.equal(f.api.user,null);readOnly(f);
  }
  for(const permission of ['push_access_levels','merge_access_levels'])for(const invalid of [undefined,[],null,{},[null],[{access_level:null}],[{access_level:'40'}],...['user_id','group_id','member_role_id','deploy_key_id'].map(key=>[{access_level:40,[key]:9}])]){
    const f=fixture(),rule=protection();rule[permission]=invalid;f.api.rules[10]=[rule];await assert.rejects(f.run());assert.equal(f.api.user,null);
  }
  {const f=fixture();f.api.rules[10]=[protection('release/*')];await assert.rejects(f.run());}
  {const f=fixture();f.api.rules[10]=[protection('m*'),protection('release/*',30,30)];f.api.rules[11]=[protection(),{...protection('*',0,40),inherited:true},protection('M*',30,30)];await f.run();}
  {const f=fixture();f.api.rules[11]=[protection(),{...protection('m*',40,30),inherited:true}];await assert.rejects(f.run());}
  {const pages=new RenovateApi('https://gitlab.example.com/api/v4','fixture');let count=0;pages.call=async()=>++count===1?[protection(),...Array.from({length:99},(_,i)=>protection('release/'+i))]:[protection('*',40,30)];await assert.rejects(protectedDefaultRules(pages,{id:10,default_branch:'main'}));assert.equal(count,2);}
  {const f=fixture();f.api.user={id:9,name:BOT_MARKER,is_admin:true,state:'active'};await assert.rejects(f.run());assert.equal(f.api.tokens.length,0);}
  {const f=fixture();await f.run();f.api.calls=[];await assert.rejects(f.run({},{}));readOnly(f);}
  {const f=fixture(),original=f.api.call.bind(f.api);f.api.call=async(...args)=>{const value=await original(...args);if(args[0]==='POST'&&args[1]==='/users')throw Error('response loss');return value;};await assert.rejects(f.run(),/response loss/);assert.equal(f.journal.user_id,undefined);assert.equal(f.api.user.note,BOT_MARKER+': '+f.journal.ownership_nonce);assert(f.api.user.force_random_password);assert.equal(f.api.user.reset_password,false);f.api.call=original;await f.run({},f.journal);assert.equal(f.api.calls.filter(c=>c[0]==='POST'&&c[1]==='/users').length,1);}
  {const f=fixture();await f.run();const recovered={};await f.run({recoverUserId:9},recovered);assert.notEqual(recovered.ownership_nonce,f.state.ownership_nonce);assert(f.api.tokens[0].revoked);}
  {const f=fixture();await f.run();f.api.user.can_create_group=true;f.api.calls=[];await assert.rejects(f.run({recoverUserId:9},{}));readOnly(f);}
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {savePrivate}=require('../../operations/dist/renovate/setup-entry'),{privateJson}=require('../../operations/dist/renovate/private-files');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'renovate-private-'));
  try{const file=path.join(tmp,'state.json');savePrivate(file,{ok:true});assert.equal(fs.statSync(file).mode&0o777,0o600);assert.deepEqual(privateJson(file),{ok:true});fs.chmodSync(file,0o644);assert.throws(()=>privateJson(file),/0600/);assert.throws(()=>savePrivate(file,{}),/0600/);}finally{fs.rmSync(tmp,{recursive:true,force:true});}
  console.log('PASS: native Renovate reconciliation, protected rules, interrupted ownership and token recovery');
};
