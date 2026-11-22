'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const projectBootstrap=require('../../dist/modules/project-workflow/projectWorkflow');
const adapter=require('../e2e/guided-preview'),platform=require('../e2e/guided-preview-platform');
const evidence=require('../../dist/modules/release/guidedPreviewEvidence'),state=require('../../dist/modules/project-lifecycle/state');
const image='sha256:'+'a'.repeat(64),source='b'.repeat(40),operation='c'.repeat(48);
function fixture(t,failPage=false,options={}){
  const repository={id:7,namespaceId:3,path:'root/wizard',defaultBranch:'main'},containers=new Map(),calls=[],stages=[];
  const runnerLogs=options.registrationLogs||'';
  let environment,binding,revoked=false,proofs=0,registrationReady=false,sourcePrepared=false,sourcePipelineReads=0;
  const pipelines=[{id:4,sha:'a'.repeat(40),ref:'main',source:'push',status:'skipped'}];
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'system-beta-native-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.projects.env'));
  fs.writeFileSync(path.join(root,'.docker.env'),'fixture-production-configuration\n');
  const statuses=[...(options.statuses||[{defaultWizardSetupInProgress:false,defaultWizardProject:{state:'registered'}}])];
  t.mock.method(platform,'node',async(_candidate,action,input)=>{
    const text=action.toString();
    if(text.includes('readReceipt')){
      assert(registrationReady,'production proof ran before completed registration');
      proofs++;
      const file=path.join(root,'.projects.env/.wizard.env');
      if(options.receipt==='missing')fs.rmSync(file,{force:true});
      else if(options.receipt==='invalid')fs.writeFileSync(file,'# BOOTSTRAPPER_PROJECT='+Buffer.from('{broken').toString('base64')+'\n');
      else projectBootstrap.writeReceipt(file,'fixture-project\n',{defaultProject:true,template:'wizard',state:'complete',repository:{...repository,systemProject:true},wizardWorkflow:{environments:environment},...options.receipt});
      return vm.runInNewContext('('+text+')()', {require:name=>{
        if(name==='fs')return {readFileSync:(file,...args)=>{
          assert(file==='/state/.docker.env'||file==='/state/.projects.env/.wizard.env');
          return fs.readFileSync(path.join(root,file.slice('/state/'.length)),...args);
        }};
        if(name==='/system/dist/modules/project-workflow/projectWorkflow')return projectBootstrap;
        return require(name);
      }});
    }
    if(text.includes('beta-registry-'))return {helper:{id:image,reference:'registry.candidate.test:5050/root/wizard/successor@'+image},wizard:{id:image,reference:'registry.candidate.test:5050/root/wizard/successor-wizard@'+image}};
    if(text.includes('beta-binding-')){binding={...input,version:2,sourceLayout:'system-monorepo-v1'};return binding;}
    if(text.includes('existsSync'))return true;
    if(text.includes("spawnSync('git'")){assert.equal(input.source,source);assert(text.includes("'ci.skip'"));sourcePrepared=true;return;}
    throw Error('unhandled controller fixture '+text.slice(0,80));
  });
  const candidate={id:'e'.repeat(24),spec:{fullAcceptance:true,guidedPreviewAcceptance:true,sourceLayout:'system-monorepo-v1',sharedSourceBundle:'/private/exact.bundle',
    sourceRevision:source,sourceTree:'f'.repeat(40),wizardSourceTree:'1'.repeat(40),ciIdentity:{pipelineId:31,candidateJobId:32},images:{candidate:{id:image},wizard:{id:image}},
    guidedPreviewSettings:{version:2,namespace:'root',wizard:{mode:'existing',project:'wizard',origin:''},review:{enabled:false,host:'',ssl:'',sslKey:''},beta:{enabled:true,host:'beta.candidate.test',ssl:'/ssl/fullchain.pem',sslKey:'/ssl/privkey.pem'}}},
    url:'https://sync.candidate.test',gitlabUrl:'https://gitlab.candidate.test',secrets:{user:'fixture',password:'private'},evidence:{},
    stage:async(name,action)=>{const row={name,status:'running'};stages.push(row);try{const value=await action();row.status='passed';return value;}catch(error){row.status='failed';throw error;}},
    wait:async(action,budget)=>{if(stages.at(-1)?.name==='system-beta-production-baseline')assert.equal(budget,candidate.spec.readinessMilliseconds||600000);for(let i=0;i<10;i++)if(await action())return;assert.fail('fixture readiness exhausted');},
    rails:async script=>{if(script.includes('negativeGatesPassed:true'))return {mode:'contract-fixture',passed:true,negativeGatesPassed:true};
      if(script.includes('activeCount:')){revoked=true;return {activeCount:0};}return {token:'private-fixture-token'};},
    api:async(route,_token,method='GET',payload)=>{calls.push({route,method,payload});
      if(route.includes('/pipelines?')){
        if(sourcePrepared&&++sourcePipelineReads>(options.sourcePipelineDelay||0)&&!pipelines.some(row=>row.id===5))
          pipelines.push({id:5,sha:source,ref:'system-candidate-'+candidate.id,source:'push',status:'skipped',...options.sourcePipeline});
        return pipelines.map(row=>({...row}));
      }
      if(route==='/projects/7/pipelines/5/jobs?per_page=100')return options.sourceJobs||[];
      if(route.includes('/repository/branches/'))return {commit:{id:source},protected:true};
      if(route==='/projects/7'&&method==='GET')return {id:7,path_with_namespace:repository.path,namespace:{id:3},visibility:'private'};
      return {};},
    request:async(url,requestOptions={})=>{let result;
      if(url.endsWith('/login'))result={accessToken:'fixture'};
      else if(url.endsWith('/status')){assert.equal(requestOptions.method,'GET');assert.equal(requestOptions.headers.Host,'sync.candidate.test');assert.equal(requestOptions.headers.Authorization,'Bearer fixture');calls.push({route:'/status'});result={status:statuses.length>1?statuses.shift():statuses[0]};registrationReady=result.status.defaultWizardSetupInProgress===false&&result.status.defaultWizardProject?.state==='registered';}
      else if(url.endsWith('/preflight')){assert(pipelines.some(row=>row.id===5),'setup ran before the fixture source pipeline settled');calls.push({route:'/preflight'});result={version:2,productionChanged:false,manualDeployment:true,source:{id:7,sourceRevision:source},previewHash:'f'.repeat(64)};}
      else if(url.endsWith('/apply')){environment={managementMode:'system-monorepo',operation,settings:{review:{enabled:false},beta:{enabled:true}},deployments:{}};if(options.setupPipeline)pipelines.push({id:6,sha:source,ref:'system-candidate-'+candidate.id,source:'push',...options.setupPipeline});result={state:'complete'};}
      else if(url.endsWith('/preview-setup'))result={version:2,phase:'ready',operation,productionChanged:false,manualDeployment:true};
      else if(url.endsWith('/api/v4/user'))return {status:revoked?401:200,body:''};
      else if(url==='https://beta.candidate.test/'){if(failPage)throw Error('fixture-page-failed');return {status:200,body:'<!doctype html><html></html>'};}
      else throw Error('unexpected URL');return {status:200,body:JSON.stringify(result)};},
    inner:async(args,options)=>{
      calls.push({args,options});
      if(args[0]==='logs')return runnerLogs;
      if(args[0]==='exec')return '';
      if(args[0]==='network')return '';
      if(args[0]==='container'){const filter=args[args.indexOf('--filter')+1];if(filter.startsWith('label='))return [...containers.keys()].join('\n');return containers.has(filter.slice(7,-1))?filter.slice(7,-1):'';}
      if(args[0]==='inspect'){
        if(args.at(-1)==='system_wizard_1')return image;
        const helper=containers.get(args.at(-1));if(helper)return JSON.stringify([{Id:helper.id,Image:image,Config:{Labels:{'system.wizard.environments.helper':operation,'org.system-bootstrapper.disposable-beta':candidate.id}}}]);
        const active=environment.deployments.beta.active;assert.equal(args[1],active.containerName);return JSON.stringify([{State:{Running:true},Image:image,Config:{Labels:state.labels(active)}}]);
      }
      if(args[0]==='create'){const input=JSON.parse(args.at(-1)),name=args[args.indexOf('--name')+1];containers.set(name,{id:'2'.repeat(64),input});return '2'.repeat(64);}
      if(args[0]==='start'){const row=[...containers.values()].find(row=>row.id===args.at(-1)),request=row.input.request;
        if(request.action==='deploy')environment.deployments.beta={active:{...state.record(request,'beta.candidate.test',binding.wizardImageRef),state:'active'}};
        else {const active=environment.deployments.beta.active;environment.deployments.beta={tombstone:{...active,state:'stopped'},stoppedThroughPipelineId:31};}return 'completed';}
      if(args[0]==='stop')return '';
      if(args[0]==='rm'){for(const [name,row]of containers)if(row.id===args[1])containers.delete(name);return '';}
      throw Error('unexpected Docker '+args[0]);
    }};
  return {candidate,calls,stages,containers,get environment(){return environment;},get revoked(){return revoked;},get proofs(){return proofs;}};
}
test('shared candidate native lifecycle settles the skipped source push before proving setup creates no pipelines or builds',async t=>{
  const f=fixture(t,false,{sourcePipelineDelay:2,statuses:[{defaultWizardSetupInProgress:true,defaultWizardProject:{state:'not-started'}},{defaultWizardSetupInProgress:false,defaultWizardProject:{state:'registered'}}]});
  f.candidate.url='http://candidate.invalid';
  await require('../e2e/wizard-registration').waitForRegistration(f.candidate);
  assert.equal(f.proofs,0,'initial registration readiness must not mutate or inspect the production receipt');
  f.candidate.url='https://sync.candidate.test';
  await adapter.run(f.candidate);evidence.validate(f.candidate.evidence.guidedPreview,f.stages);
  assert.equal(f.stages[0].name,'system-beta-production-baseline');assert.equal(f.stages[0].status,'passed');
  assert.equal(f.calls.filter(row=>row.route==='/status').length,3);assert(f.proofs>1);
  assert(f.revoked);assert.equal(f.containers.size,0);assert(!f.environment.deployments.beta.active);
  assert(!f.calls.some(row=>row.method==='POST'&&/pipelines|merge_requests|repository\/commits/.test(row.route)));
  assert(!f.calls.some(row=>row.args?.includes('build')));
  const preflight=f.calls.findIndex(row=>row.route==='/preflight'),jobs=f.calls.findIndex(row=>row.route==='/projects/7/pipelines/5/jobs?per_page=100');
  assert(jobs>=0&&jobs<preflight);assert.equal(f.calls.slice(0,jobs).filter(row=>row.route==='/projects/7/pipelines?per_page=100').length,4);
});
test('native setup cannot add a pipeline even when the fixture source SHA and ref are unchanged',async t=>{
  for(const status of ['skipped','running'])await t.test(status,async t=>{
    const f=fixture(t,false,{setupPipeline:{status}});
    await assert.rejects(()=>adapter.run(f.candidate),/system-beta-setup-started-build/);
    assert.equal(require('./stage-diagnostics').failureReason('system-beta-setup-started-build'),'system-beta-setup-started-build');
    assert.equal(f.stages.find(row=>row.name==='system-beta-native-setup').status,'failed');
    assert(!f.candidate.evidence.guidedPreview.setup);assert(!f.stages.some(row=>row.name==='system-beta-native-binding'));assert(f.revoked);
  });
});
test('source preparation requires the exact skipped push pipeline without jobs before setup',async t=>{
  const cases=[{sourcePipeline:{sha:'a'.repeat(40)}},{sourcePipeline:{ref:'main'}},{sourcePipeline:{source:'api'}},{sourcePipeline:{status:'running'}},{sourceJobs:[{id:10,status:'skipped'}]}];
  for(const [index,options]of cases.entries())await t.test(String(index),async t=>{
    const f=fixture(t,false,options);
    await assert.rejects(()=>adapter.run(f.candidate),options.sourceJobs?/system-beta-source-pipeline-jobs-present/:/system-beta-source-pipeline-invalid/);
    const code=options.sourceJobs?'system-beta-source-pipeline-jobs-present':'system-beta-source-pipeline-invalid';
    assert.equal(require('./stage-diagnostics').failureReason(code),code);
    assert(!f.stages.some(row=>row.name==='system-beta-native-setup'));assert.equal(f.environment,undefined);assert(f.revoked);
  });
});
test('failed TLS page still stops exact generation, removes helpers and revokes credentials',async t=>{
  const f=fixture(t,true);await assert.rejects(()=>adapter.run(f.candidate),/fixture-page-failed/);
  assert(f.revoked);assert.equal(f.containers.size,0);assert.equal(f.environment.deployments.beta.tombstone.state,'stopped');
  assert.throws(()=>evidence.validate(f.candidate.evidence.guidedPreview,f.stages));
});
test('failed DefaultWizard registration stops the baseline before proof or mutations with bounded diagnostics',async t=>{
  const diagnostics=require('./stage-diagnostics');
  const cases=[
    ['Namespace lookup failed','namespace-unavailable'],
    ['The local administrator namespace could not be found.','namespace-unavailable'],
    ['Repository already exists in the selected namespace.','project-rejected'],
    ['GitLab rejected project creation (HTTP 403); check namespace permissions, reserved names or a competing creation.','project-rejected'],
    ['Default branch not ready; retry Save','default-branch-missing'],
    ['CI installation failed; retry Save','ci-installation-failed'],
    ['CI installation failed; retry Save','ci-installation-failed-http-400','unrelated private-fixture-token\nBOOTSTRAPPER_PROJECT_CI_COMMIT_HTTP:400\n'],
    ['CI installation failed; retry Save','ci-installation-failed','BOOTSTRAPPER_PROJECT_CI_COMMIT_HTTP:403 private-fixture-token\n'],
    ['CI installation failed; retry Save','ci-installation-failed','BOOTSTRAPPER_PROJECT_CI_COMMIT_HTTP:403\nBOOTSTRAPPER_PROJECT_CI_COMMIT_HTTP:400\n'],
    ['Repository ready; routing failed. Retry Save.','routing-failed'],
    ['private-token-secret: Namespace lookup failed','unknown-failure'],
  ];
  for(const [index,[message,reason,registrationLogs]]of cases.entries())await t.test(reason+': '+index,async t=>{
    const f=fixture(t,false,{registrationLogs,statuses:[{defaultWizardSetupInProgress:true,defaultWizardProject:{state:'failed',message}}]});
    const code='system-beta-registration-'+reason;
    await assert.rejects(()=>adapter.run(f.candidate),error=>error.message===code&&error.noRetry===true);
    assert.equal(diagnostics.failureReason(code),code);assert.equal(f.proofs,0);assert.equal(f.environment,undefined);assert(!f.revoked);
    const expected=[{route:'/status'}];
    if(message==='CI installation failed; retry Save')expected.push({args:['logs','--tail','200','system_bootstrapper_1'],options:{timeout:10000,maxBuffer:65536}});
    assert.deepEqual(f.calls,expected);assert.deepEqual(f.stages,[{name:'system-beta-production-baseline',status:'failed'}]);
    assert(!code.includes('private-fixture-token'));
  });
});
test('registered status cannot bypass missing, malformed or incomplete native production receipts',async t=>{
  const cases=['missing','invalid',{defaultProject:false},{template:'empty'},{state:'running'},{repository:{id:7,systemProject:false}}];
  for(const [index,receipt]of cases.entries())await t.test(String(index),async t=>{
    const f=fixture(t,false,{receipt});await assert.rejects(()=>adapter.run(f.candidate));
    assert.equal(f.proofs,1);assert.equal(f.environment,undefined);assert(!f.revoked);
    assert.deepEqual(f.calls,[{route:'/status'}]);assert.deepEqual(f.stages,[{name:'system-beta-production-baseline',status:'failed'}]);
  });
});

test('shared registry recovery uses native binding and exact pushed image without minting pipeline evidence',async t=>{
  const wizard='sha256:'+'d'.repeat(64),digest='sha256:'+'e'.repeat(64);
  const imageRef='registry.candidate.test:5050/root/wizard/successor-wizard@'+digest;
  const descriptor={projectId:7,projectPath:'root/wizard',imageRef,imageId:wizard,sourceCommit:source};
  t.mock.method(platform,'node',async()=>descriptor);
  const candidate={id:'f'.repeat(24),spec:{sourceRevision:source,images:{wizard:{id:wizard},candidate:{id:image}}},
    evidence:{guidedPreview:{version:2,sourceLayout:'system-monorepo-v1',setup:{native:true},beta:{containerRemoved:true,leaseReleased:true},candidate:{projectId:7,wizardRegistryDigest:digest}}},
    inner:async()=>JSON.stringify([{Id:wizard,RepoDigests:[imageRef],Config:{Labels:{'org.opencontainers.image.revision':source}}}])};
  const result=await require('../e2e/wizard-pin-fixture').publish(candidate);
  assert.equal(result.kind,'shared-candidate-registry-v2');assert(!Object.hasOwn(result,'pipelineId'));
  candidate.inner=async()=>JSON.stringify([{Id:wizard,RepoDigests:[imageRef],Config:{Labels:{'org.opencontainers.image.revision':'a'.repeat(40)}}}]);
  await assert.rejects(()=>require('../e2e/wizard-pin-fixture').publish(candidate),/registry-identity-invalid/);
});
