'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const adapter=require('../e2e/guided-preview');
const {Operator,readInput}=require('../e2e/guided-preview-live');
const image='sha256:'+'a'.repeat(64),commit='b'.repeat(40);
const desired={version:1,namespace:'team',wizard:{mode:'import',project:'wizard-source',origin:'https://github.com/example/wizard.git'},
  review:{enabled:true,host:'review.example.test',ssl:'/ssl/review/fullchain.pem',sslKey:'/ssl/review/privkey.pem'},beta:{enabled:false,host:'',ssl:'',sslKey:''}};
async function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'guided-preview-contract-'));try{return await run(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
const input=root=>({version:1,syncUrl:'https://sync.example.test',gitlabUrl:'https://gitlab.example.test',controllerImageId:image,settings:desired,reportPath:path.join(root,'report.json'),timeBudgetMilliseconds:60000});
test('postdeployment acceptance requires private operator input and exact fresh import intent',()=>fixture(root=>{
  const filename=path.join(root,'input.json'),valid=input(root);
  fs.writeFileSync(filename,JSON.stringify(valid),{mode:0o600});assert.deepEqual(readInput(filename),valid);
  fs.chmodSync(filename,0o644);assert.throws(()=>readInput(filename),/private-regular-input/);fs.chmodSync(filename,0o600);
  for(const change of [{syncUrl:'http://sync.example.test'},{gitlabUrl:'https://token@example.test'},{controllerImageId:'latest'},{token:'must-not-accept'},
    {settings:{...desired,wizard:{mode:'existing',project:'existing-source',origin:''}}}]) {
    fs.writeFileSync(filename,JSON.stringify({...valid,...change}));assert.throws(()=>readInput(filename));
  }
}));
test('native acceptance rejects fake success without four required real runner jobs',()=>{
  const pipeline={id:31,status:'success',sha:commit};
  const jobs=['build:source','test:browser','build:wizard','test:wizard'].map((name,index)=>({id:40+index,name,status:'success',allow_failure:false,commit:{id:commit},pipeline:{id:31},runner:{id:9}}));
  assert.equal(adapter.nativeJobs(pipeline,jobs).length,4);
  for(const change of [rows=>rows.pop(),rows=>delete rows[0].runner,rows=>rows[1].allow_failure=true,rows=>rows[2].commit.id='c'.repeat(40),rows=>rows[3].status='failed']){
    const rows=structuredClone(jobs);change(rows);assert.throws(()=>adapter.nativeJobs(pipeline,rows));
  }
});
test('Production identity proof compares both exact saved bytes and running immutable image',()=>{
  const before={mainSha256:'a'.repeat(64),runningImage:image};adapter.unchanged(before,{...before});
  assert.throws(()=>adapter.unchanged(before,{...before,mainSha256:'b'.repeat(64)}),/production-changed/);
  assert.throws(()=>adapter.unchanged(before,{...before,runningImage:'sha256:'+'c'.repeat(64)}),/production-changed/);
});
test('unexpected selected controller fails before reading credentials or making setup requests',async()=>{
  await fixture(async root=>{
    let commands=0;
    const operator=new Operator(input(root),{command:()=>{commands++;return {status:0,stdout:JSON.stringify([{Image:'sha256:'+'d'.repeat(64),State:{Running:true}}])};}});
    await assert.rejects(()=>operator.prepare(),/exact-accepted-controller-failed/);assert.equal(commands,1);assert.equal(operator.secrets,undefined);
  });
});
test('native transport keeps request credentials on stdin and does not expose subprocess diagnostics',async()=>{
  await fixture(async root=>{
    let captured;
    const operator=new Operator(input(root),{command:(command,args,options)=>{captured={command,args,options};return {status:0,stdout:JSON.stringify({status:200,body:'{}'})};}});
    await operator.request('https://gitlab.example.test/api/v4/user',{headers:{'PRIVATE-TOKEN':'test-secret-value',Host:'foreign.example.test'}});
    assert.equal(captured.command,'docker');assert.equal(captured.args[0],'--host=unix:///var/run/docker.sock');
    assert.ok(!captured.args.join(' ').includes('test-secret-value'));assert.ok(captured.options.input.includes('test-secret-value'));
    assert.ok(!captured.options.input.includes('foreign.example.test'));
    operator.command=()=>({status:1,stderr:'test-secret-value raw unsafe failure'});
    await assert.rejects(()=>operator.inner(['inspect','system_bootstrapper_1']),error=>!error.message.includes('test-secret-value')&&error.message==='guided-preview-native-command-failed');
  });
});
test('check-only validates accepted public proof and native preflight without starting setup',async()=>{
  await fixture(async root=>{
    const operator=new Operator(input(root));operator.secrets={user:'fixture-user',password:'fixture-only-password'};
    const requests=[];
    operator.inner=async args=>['inspect','image'].includes(args[0])?image:JSON.stringify({mainSha256:'c'.repeat(64),publicImage:'docker.io/example/wizard@sha256:'+'d'.repeat(64),projectId:1});
    operator.request=async(url,options)=>{requests.push({url,options});return {status:200,body:JSON.stringify(url.endsWith('/login')?{accessToken:'memory-only'}:{runnerReady:true,productionChanged:false,namespaceId:9})};};
    await operator.plan();assert.equal(requests.length,2);
    assert.ok(requests[1].url.endsWith('/preview-setup/preflight'));
    assert.ok(requests.every(request=>!request.url.endsWith('/apply')));assert.equal(operator.evidence.plan.runnerReady,true);
  });
});
function proofTransport() {
  const vm=require('node:vm'),{Adoption}=require('../../project-bootstrap/wizard-source-primary/run');
  const original=Adoption.prototype.publicRelease;
  Adoption.prototype.publicRelease=function(){return 'docker.io/example/wizard@sha256:'+'d'.repeat(64);};
  const receipt={repository:{id:1,path:'team/wizard'}};
  return {restore:()=>Adoption.prototype.publicRelease=original,inner:async args=>{
    if(['inspect','image'].includes(args[0]))return image;
    const script=args.at(-1);let output='';
    const runtime={stdout:{write:value=>output+=value},exitCode:0};
    vm.runInNewContext(script,{require:name=>{
      if(name==='fs')return {readFileSync:()=> 'fixture configuration bytes'};
      if(name==='/system/project-bootstrap/wizard-source-primary/binding')return {read:()=>({receipt}),primary:()=>false};
      if(name==='/system/project-bootstrap/wizard-source-primary/run')return {Adoption};
      return require(name);
    },process:runtime});
    assert.equal(runtime.exitCode,0,'The actual Adoption constructor must not open an undefined API credential file during a local public-release proof.');
    return output;
  }};
}
test('local public release proof executes actual Adoption constructor without an API credential file',async()=>{
  const transport=proofTransport();
  try{const result=await adapter.production({inner:transport.inner},true);assert.equal(result.publicImage,'docker.io/example/wizard@sha256:'+'d'.repeat(64));}
  finally{transport.restore();}
});
test('failed setup still revokes temporary token and checks the distinct configured GitLab origin',async()=>{
  const proof=proofTransport(),requests=[],apiCalls=[];
  const candidate={id:'a'.repeat(24),spec:{operatorAcceptance:true,guidedPreviewAcceptance:true,guidedPreviewSettings:desired},url:'https://sync.example.test',gitlabUrl:'https://gitlab.example.test',
    secrets:{user:'fixture-user',password:'fixture-only'},evidence:{},inner:proof.inner,stage:async(_name,action)=>action(),
    rails:async()=>({token:'fixture-memory-token'}),wait:async action=>action(),
    api:async(route,_token,method)=>{apiCalls.push({route,method});return route.startsWith('/projects?')?[]:null;},
    request:async(url)=>{requests.push(url);
      if(url.endsWith('/login'))return {status:200,body:JSON.stringify({accessToken:'fixture-access'})};
      if(url.endsWith('/preview-setup'))return {status:200,body:JSON.stringify({phase:'not-started'})};
      if(url==='https://gitlab.example.test/api/v4/user')return {status:401,body:''};
      return {status:409,body:'private error body must not leak'};
    }};
  try {
    await assert.rejects(()=>adapter.run(candidate),/guided-preview-sync-request-failed/);
    assert.ok(apiCalls.some(call=>call.route==='/personal_access_tokens/self'&&call.method==='DELETE'));
    assert.ok(requests.includes('https://gitlab.example.test/api/v4/user'));
    assert.ok(!requests.includes('https://sync.example.test/api/v4/user'));
  } finally {proof.restore();}
});
test('retained public receipt cannot substitute for the actual running public image identity',async()=>{
  const proof=proofTransport();
  try {
    await assert.rejects(()=>adapter.production({inner:args=>args[0]==='image'?'sha256:'+'e'.repeat(64):proof.inner(args)},true),/running-public-image-mismatch/);
  } finally {proof.restore();}
});
test('operator URLs must match the selected controller TLS configuration before credentials are retained',async()=>fixture(async root=>{
  let commands=0;
  const operator=new Operator(input(root),{command:()=>({status:0,stdout:JSON.stringify(++commands===1?[{Image:image,State:{Running:true}}]:
    {user:'fixture',password:'memory-only',gitlab:'https://gitlab.example.test',sync:'different.example.test',syncMode:'2',syncEnabled:'true'})})});
  await assert.rejects(()=>operator.prepare(),/exact-accepted-controller-failed/);
  assert.equal(commands,2);assert.equal(operator.secrets,undefined);
}));
