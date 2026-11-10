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
test('long native waits renew Sync authentication before writes and retry expired read tokens only once',async()=>{
  let clock=0,logins=0,expiredRead=true;
  const requests=[];
  const sync=adapter.syncSession({url:'https://sync.example.test',secrets:{user:'fixture',password:'memory-only'},now:()=>clock,
    request:async(url,options)=>{
      requests.push({url,method:options.method,authorization:options.headers.Authorization});
      if(url.endsWith('/login'))return {status:200,body:JSON.stringify({accessToken:'fixture-'+(++logins)})};
      if(url.endsWith('/jobs/1')&&expiredRead){expiredRead=false;return {status:403,body:'expired'};}
      return {status:200,body:'{"state":"running"}'};
    }});
  await sync('/status');clock+=16*60000;
  await sync('/apply',{confirmed:true});
  assert.equal(logins,2);
  assert.equal(requests.filter(row=>row.url.endsWith('/apply')).length,1);
  assert.equal(requests.find(row=>row.url.endsWith('/apply')).authorization,'Bearer fixture-2');
  await sync('/jobs/1');assert.equal(logins,3);
  assert.deepEqual(requests.filter(row=>row.url.endsWith('/jobs/1')).map(row=>row.authorization),['Bearer fixture-2','Bearer fixture-3']);
});
test('Sync authentication failures never replay a mutation and read reauthentication stays bounded',async()=>{
  for(const status of [401,403]) {
    let logins=0,writes=0,reads=0;
    const sync=adapter.syncSession({url:'https://sync.example.test',secrets:{user:'fixture',password:'memory-only'},request:async(url,options)=>{
      if(url.endsWith('/login'))return {status:200,body:JSON.stringify({accessToken:'fixture-'+(++logins)})};
      if(options.method==='POST')writes++;else reads++;
      return {status,body:'private diagnostic must not leak'};
    }});
    await assert.rejects(()=>sync('/apply',{confirmed:true}),/guided-preview-sync-request-failed/);
    assert.equal(writes,1);assert.equal(logins,1);
    await assert.rejects(()=>sync('/jobs/1'),error=>error.message==='guided-preview-sync-request-failed');
    assert.equal(reads,2);assert.equal(logins,2);assert.equal(writes,1);
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
test('only synchronous native preflight receives a longer HTTP budget and the global deadline still caps it',async()=>fixture(async root=>{
  let clock=0,captured;
  const operator=new Operator({...input(root),timeBudgetMilliseconds:600000},{now:()=>clock,
    command:(_command,_args,options)=>{captured=options;return {status:0,stdout:'{"status":200,"body":"{}"}'};}});
  await operator.request(operator.url+'/projects/wizard/preview-setup/preflight',{method:'POST'});
  assert.equal(JSON.parse(captured.input).timeoutMilliseconds,300000);assert.equal(captured.timeout,310000);
  await operator.request(operator.url+'/projects/wizard/preview-setup/apply',{method:'POST'});
  assert.equal(JSON.parse(captured.input).timeoutMilliseconds,20000);assert.equal(captured.timeout,30000);
  clock=operator.deadline-7000;
  await operator.request(operator.url+'/projects/wizard/preview-setup/preflight',{method:'POST'});
  assert.equal(JSON.parse(captured.input).timeoutMilliseconds,6000);assert.equal(captured.timeout,7000);
  clock=operator.deadline;
  await assert.rejects(()=>operator.request(operator.url+'/status'),/overall-timeout/);
}));
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
  const original=Adoption.prototype.publicRelease,originalRetained=Adoption.prototype.retainedInstallation;
  Adoption.prototype.publicRelease=function(){return 'docker.io/example/wizard@sha256:'+'d'.repeat(64);};
  Adoption.prototype.retainedInstallation=function(main){return this.publicRelease(main);};
  const receipt={repository:{id:1,path:'team/wizard'}};
  return {restore:()=>{Adoption.prototype.publicRelease=original;Adoption.prototype.retainedInstallation=originalRetained;},inner:async args=>{
    if(['inspect','image'].includes(args[0]))return image;
    const script=args.at(-1);let output='';
    const runtime={stdout:{write:value=>output+=value},exitCode:0};
    vm.runInNewContext(script,{require:name=>{
      if(name==='fs')return {readFileSync:()=> 'fixture configuration bytes'};
      if(name==='/system/project-bootstrap/wizard-source-primary/binding')return {read:()=>({receipt}),primary:()=>false};
      if(name==='/system/project-bootstrap/wizard-source-primary/run')return {Adoption};
      return require(name);
    },process:runtime});
    assert.equal(runtime.exitCode,0,'The actual Adoption constructor must not open an undefined API credential file during a local retained-installation proof.');
    return output;
  }};
}
test('local retained installation proof executes actual Adoption constructor without an API credential file',async()=>{
  const transport=proofTransport();
  try{const result=await adapter.production({inner:transport.inner},true);assert.equal(result.publicImage,'docker.io/example/wizard@sha256:'+'d'.repeat(64));}
  finally{transport.restore();}
});
test('failed setup still revokes temporary token and checks the distinct configured GitLab origin',async()=>{
  const proof=proofTransport(),requests=[],apiCalls=[];
  const candidate={id:'a'.repeat(24),spec:{operatorAcceptance:true,guidedPreviewAcceptance:true,guidedPreviewSettings:desired},url:'https://sync.example.test',gitlabUrl:'https://gitlab.example.test',
    secrets:{user:'fixture-user',password:'fixture-only'},evidence:{},inner:proof.inner,stage:async(_name,action)=>action(),
    rails:async script=>script.includes('activeCount')?{activeCount:0}:{token:'fixture-memory-token'},wait:async action=>action(),
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
const lifecycleFixture=require('./guided-preview-fixture');
const guidedEvidence=require('../../gitlab/guided-preview-evidence');
function nativeLifecycle(options={}) {
  const binding=require('../../project-bootstrap/wizard-source-primary/binding'),state=require('../../project-bootstrap/wizard-environments/state');
  const {sha,reviewSha,mergedSha,imageDigest}=lifecycleFixture;
  const publicImage='docker.io/example/wizard@sha256:'+'d'.repeat(64),imageRef='registry.example.test/team/wizard@'+imageDigest;
  const source={id:2,namespace:{id:9},path_with_namespace:'team/wizard-source',default_branch:'main',visibility:'private',ci_config_path:'.gitlab/primary.yml',
    only_allow_merge_if_pipeline_succeeds:true,only_allow_merge_if_all_discussions_are_resolved:true};
  const receipt={namespaceId:9,repository:{id:2,namespaceId:9,path:source.path_with_namespace,defaultBranch:'main',ciPath:'.gitlab/primary.yml',managementMode:'source-primary'},
    sourcePrimary:{version:1,operation:'f'.repeat(48),adoptionCommit:sha,ciFiles:[{path:'.gitlab/primary.yml',sha256:binding.hash('approved CI')}]}};
  const pipelines=[{id:31,sha,source:'push',ref:'main',status:'success'},
    {id:32,sha:reviewSha,source:'merge_request_event',ref:'guided-review',status:'success'},
    {id:33,sha:mergedSha,source:'push',ref:'main',status:'success'}];
  const jobs=new Map(pipelines.map(pipeline=>[pipeline.id,[...guidedEvidence.requiredJobs.map((name,index)=>({id:pipeline.id*10+index,name,status:'success',allow_failure:false,
    commit:{id:pipeline.sha},pipeline:{id:pipeline.id},runner:{id:9}})),...['deploy','stop'].map((action,index)=>({id:pipeline.id*10+4+index,name:action+':'+(pipeline.id===32?'review':'beta'),
      status:'manual',allow_failure:true,commit:{id:pipeline.sha},pipeline:{id:pipeline.id},runner:{id:9}}))]]));
  for(const [index,context] of ['source','review','merge'].entries()) {
    const pipeline=pipelines[index];
    if(options.failedContext===context){pipeline.status='failed';jobs.get(pipeline.id)[0].status='failed';}
    if(options.missingContext===context)jobs.get(pipeline.id).shift();
  }
  const environment={phase:'ready',operation:'f'.repeat(48),deployments:{}},calls=[],stages=[],railCalls=[];let applies=0,merged=false,revoked=false;
  const candidate={id:'a'.repeat(24),spec:{operatorAcceptance:true,guidedPreviewAcceptance:true,guidedPreviewSettings:{...desired,
    beta:options.betaDisabled?desired.beta:{enabled:true,host:'beta.example.test',ssl:'/ssl/beta/fullchain.pem',sslKey:'/ssl/beta/privkey.pem'}}},
    url:'https://sync.example.test',gitlabUrl:'https://gitlab.example.test',secrets:{user:'fixture-user',password:'fixture-only'},evidence:{},
    stage:async(name,action)=>{const stage={name,status:'running'};stages.push(stage);try{const result=await action();stage.status='passed';return result;}catch(error){stage.status='failed';throw error;}},
    wait:async action=>{assert.equal(await action(),true,'fixture wait must complete from actual mocked native evidence');},
    rails:async script=>{
      railCalls.push(script);
      if(script.includes('create!')&&options.malformedMint)return {};
      if(script.includes('create!')&&options.lostMint)throw Error('fixture-mint-response-lost');
      if(script.includes('activeCount')){if(options.uncertainRevoke)throw Error('fixture-revoke-response-lost');revoked=true;return {activeCount:0};}
      return {token:'fixture-memory-token'};
    },
    inner:async args=>{
      if(args[0]==='inspect'&&args.at(-1)==='system_wizard_1'||args[0]==='image')return image;
      if(args[0]==='container')return '';
      if(args[0]==='inspect') {
        const deployment=Object.values(environment.deployments).map(slot=>slot.active).find(active=>active?.containerName===args.at(-1));
        assert.ok(deployment);return JSON.stringify([{State:{Running:true},Image:image,Config:{Labels:state.labels(deployment)}}]);
      }
      const script=args.at(-1);
      if(script.includes('JSON.stringify({receipt})'))return JSON.stringify({receipt});
      if(script.includes('JSON.stringify({publicImage'))return JSON.stringify({publicImage});
      return JSON.stringify({mainSha256:'a'.repeat(64),publicImage,projectId:applies>=2?2:1,
        managementMode:applies>=2?'source-primary':'managed',sourcePrimary:receipt.sourcePrimary,build:{phase:'candidate-verified'},environment});
    },
    request:async(url,request={})=>{
      if(url.endsWith('/api/v4/user'))return {status:revoked?401:200,body:''};
      if(url.startsWith('https://review.')||url.startsWith('https://beta.')) {
        if(options.pageFailure&&url.startsWith('https://'+options.pageFailure+'.'))throw Error('fixture-page-failed');
        return {status:200,body:'<!doctype html><html></html>'};
      }
      let result;
      if(url.endsWith('/login'))result={accessToken:'memory-only'};
      else if(url.endsWith('/preflight'))result={productionChanged:false,runnerReady:true,previewHash:'fixture'};
      else if(url.endsWith('/apply')){applies++;result={id:'fixture',state:'completed'};}
      else result=applies?{phase:applies>=2?'ready':'waiting-build',projects:{wizard:{id:2}}}:{phase:'not-started'};
      return {status:200,body:JSON.stringify(result)};
    },
    api:async(route,token,method='GET',payload)=>{
      assert.equal(token,'fixture-memory-token');calls.push({route,method,payload});
      if(route==='/personal_access_tokens/self'){revoked=true;return null;}
      if(route.startsWith('/projects?'))return [{id:1,path_with_namespace:'team/initial'}];
      if(route==='/projects/2')return source;
      if(route.includes('/repository/branches/'))return {commit:{id:merged?mergedSha:sha}};
      if(route.includes('/repository/files/'))return {content:Buffer.from('approved CI').toString('base64')};
      if(route==='/projects/2/repository/commits')return {id:reviewSha};
      if(route==='/projects/2/merge_requests')return {iid:7};
      if(route==='/projects/2/merge_requests/7/merge') {
        assert.equal(method,'PUT');assert.deepEqual(payload,{sha:reviewSha,should_remove_source_branch:true});
        merged=true;return {state:'merged',merge_commit_sha:mergedSha};
      }
      if(route.includes('with_merge_status_recheck'))return {state:'opened',sha:reviewSha,draft:false,head_pipeline:{id:32,status:'success'},detailed_merge_status:'mergeable'};
      if(route==='/projects/2/merge_requests/7/pipelines')return [pipelines[1]];
      if(route.startsWith('/projects/2/pipelines?'))return [pipelines[merged?2:0]];
      const pipelineRoute=route.match(/^\/projects\/2\/pipelines\/(\d+)(.*)$/);
      if(pipelineRoute) {
        const id=Number(pipelineRoute[1]);
        if(pipelineRoute[2].startsWith('/jobs'))return jobs.get(id);
        return pipelines.find(row=>row.id===id);
      }
      const jobRoute=route.match(/^\/projects\/2\/jobs\/(\d+)(.*)$/);
      if(jobRoute) {
        const id=Number(jobRoute[1]),pipelineId=Math.floor(id/10),job=jobs.get(pipelineId).find(row=>row.id===id),pipeline=pipelines.find(row=>row.id===pipelineId);
        if(jobRoute[2].startsWith('/artifacts/'))return {version:1,pipelineId,sourceCommit:pipeline.sha,imageRef,testRunner:'vitest',unitTests:true,lint:true,typecheck:true,productionBuild:true,
          http:true,renderedUI:true,projects:true,spa:true,configurationBackup:true,cubeSignature:true,...(options.artifactFailure===pipelineId?{renderedUI:false}:{})};
        if(jobRoute[2]==='/play') {
          const [action,kind]=job.name.split(':');job.status=options.deployFailure===kind&&action==='deploy'?'failed':'success';
          if(action==='deploy') {
            const deployment=state.record({action:'deploy',kind,projectId:2,pipelineId,jobId:id,sourceCommit:pipeline.sha,mrIid:kind==='review'?7:0,operation:'f'.repeat(48)},desired.review.host,imageRef);
            environment.deployments[kind]={active:{...deployment,state:'active'}};
          } else {
            const slot=environment.deployments[kind];slot.tombstone={...slot.active,state:'stopped'};slot.active=null;slot.stoppedThroughPipelineId=pipelineId;
            if(options.staleStop===kind)slot.tombstone.generation='p999-j999';
            if(options.gateChanged&&kind==='review')source.only_allow_merge_if_pipeline_succeeds=false;
          }
          if(options.uncertainPlay===kind&&action==='deploy')throw Error('fixture-play-result-lost');
          return job;
        }
        return job;
      }
      throw Error('unexpected fixture API route: '+route);
    }};
  return {candidate,calls,stages,railCalls,get revoked(){return revoked;},environment};
}
test('native guided lifecycle merges through normal MR gates and proves all three CI contexts plus Review/Beta',async()=>{
  const fixture=nativeLifecycle();const result=await adapter.run(fixture.candidate);
  assert.deepEqual(guidedEvidence.validate(result,fixture.stages),JSON.parse(JSON.stringify(result)));
  assert.equal(fixture.revoked,true);
  const mutations=fixture.calls.filter(call=>call.method!=='GET');
  assert.equal(mutations.filter(call=>call.route.endsWith('/merge')).length,1);
  assert.equal(mutations.some(call=>call.route.includes('/pipelines')),false,'no pipeline is manufactured or rerun');
  assert.equal(mutations.some(call=>/override|skip|production/i.test(JSON.stringify(call))),false);
  assert.equal(fixture.stages.filter(stage=>stage.name==='guided-preview-native-review-stop').length,1);
  assert.equal(fixture.stages.filter(stage=>stage.name==='guided-preview-native-beta-stop').length,1);
});
test('Beta stays optional for operator lifecycle while the MR still merges and verifies merged-default CI',async()=>{
  const fixture=nativeLifecycle({betaDisabled:true});const proof=await adapter.run(fixture.candidate);
  assert.equal(proof.merge.merged,true);assert.equal(proof.betaEnabled,false);assert.equal(proof.beta,undefined);
  assert.ok(!fixture.calls.some(call=>call.route==='/projects/2/jobs/334/play'));
});
test('failed or uncertain Deploy and failed page checks still stop the owned generation and revoke credentials',async()=>{
  for(const options of [{pageFailure:'review'},{pageFailure:'beta'},{deployFailure:'review'},{deployFailure:'beta'},{uncertainPlay:'review'},{uncertainPlay:'beta'},{staleStop:'review'}]) {
    const fixture=nativeLifecycle(options);await assert.rejects(()=>adapter.run(fixture.candidate));
    const kind=Object.values(options)[0];assert.equal(fixture.environment.deployments[kind].active,null);
    assert.equal(fixture.revoked,true);
    assert.equal(fixture.stages.find(stage=>stage.name==='guided-preview-production-retained').status,'passed');
    assert.ok(fixture.calls.some(call=>call.route==='/projects/2/jobs/'+(kind==='review'?325:335)+'/play'));
    assert.equal(fixture.stages.find(stage=>stage.name==='guided-preview-native-'+kind+'-stop').status,options.staleStop?'failed':'passed');
  }
});
test('cleanup recovery preserves allowlisted lifecycle proof across reports and repeated cleanup',()=>fixture(root=>{
  const {recover}=require('./disposable-candidate'),proof=lifecycleFixture.proof(),marker='secret-fixture-token';
  const malicious=structuredClone(proof);malicious.token=marker;malicious.source.url='https://'+marker+'@example.test';
  malicious.review.deploy.trace=marker;malicious.beta.deployment.private=marker;
  const input={runId:'a'.repeat(24),resources:[],fullAcceptance:true,results:guidedEvidence.stages.map(name=>({name,status:'passed'})),evidence:{guidedPreview:malicious}};
  const recovered=recover(input);assert.deepEqual(recovered.evidence.guidedPreview,proof);assert.equal(recovered.cleanup(),true);recovered.report(root);
  const report=JSON.parse(fs.readFileSync(path.join(root,'results.json')));assert.ok(!JSON.stringify(report).includes(marker));
  const twice=recover(report);assert.equal(twice.cleanup(),true);twice.report(root);
  assert.deepEqual(twice.evidence.guidedPreview,proof);guidedEvidence.validate(twice.evidence.guidedPreview,twice.results);
}));

test('failed or missing required checks in each native context prevent merge or Beta deployment and retain cleanup',async()=>{
  for(const context of ['source','review','merge'])for(const failure of ['failedContext','missingContext']) {
    const fixture=nativeLifecycle({[failure]:context});await assert.rejects(()=>adapter.run(fixture.candidate));
    assert.equal(fixture.revoked,true);assert.equal(fixture.stages.find(stage=>stage.name==='guided-preview-production-retained').status,'passed');
    assert.equal(fixture.calls.some(call=>call.route==='/projects/2/jobs/334/play'),false);
    if(context!=='merge')assert.equal(fixture.calls.some(call=>call.route.endsWith('/merge')),false);
  }
});
test('changed normal merge gates and mismatched artifacts fail without override or subsequent deployment',async()=>{
  for(const options of [{gateChanged:true},{artifactFailure:31},{artifactFailure:32},{artifactFailure:33}]) {
    const fixture=nativeLifecycle(options);await assert.rejects(()=>adapter.run(fixture.candidate));
    assert.equal(fixture.revoked,true);assert.equal(fixture.calls.some(call=>call.route==='/projects/2/jobs/334/play'),false);
    if(options.artifactFailure!==33)assert.equal(fixture.calls.some(call=>call.route.endsWith('/merge')),false);
    assert.equal(fixture.calls.some(call=>call.method==='PUT'&&call.route==='/projects/2'),false,'merge gates are never weakened');
  }
});

test('uncertain token creation attempts exact-name cleanup but never claims completed revocation',async()=>{
  for(const options of [{lostMint:true},{malformedMint:true},{lostMint:true,uncertainRevoke:true}]) {
    const fixture=nativeLifecycle(options);
    await assert.rejects(()=>adapter.run(fixture.candidate),error=>error.message==='guided-preview-credential-mint-completion-uncertain');
    assert.ok(fixture.railCalls.some(script=>script.includes("where(name:'guided-preview-acceptance-"+fixture.candidate.id+"',revoked:false).find_each(&:revoke!)")));
    assert.equal(fixture.stages.find(stage=>stage.name==='guided-preview-temporary-credential-revoked').status,'failed');
    assert.equal(fixture.stages.find(stage=>stage.name==='guided-preview-production-retained').status,'passed');
    assert.equal(fixture.candidate.evidence.guidedPreview.credentialCleanupUncertain,true);
    assert.equal(guidedEvidence.sanitize(fixture.candidate.evidence.guidedPreview).credentialCleanupUncertain,true);
    const recovered=require('./disposable-candidate').recover({runId:fixture.candidate.id,resources:[],evidence:fixture.candidate.evidence});
    assert.equal(recovered.evidence.guidedPreview.credentialCleanupUncertain,true);
    if(!options.uncertainRevoke)assert.equal(fixture.revoked,true,'best-effort cleanup was attempted and observed no active token, but mint completion remains uncertain');
  }
});
