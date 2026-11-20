'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const adapter=require('../e2e/guided-preview'),platform=require('../e2e/guided-preview-platform');
const evidence=require('../../gitlab/guided-preview-evidence'),state=require('../../project-bootstrap/wizard-environments/state');
const image='sha256:'+'a'.repeat(64),source='b'.repeat(40),operation='c'.repeat(48);
function fixture(t,failPage=false){
  const repository={id:7,namespaceId:3,path:'root/wizard',defaultBranch:'main'},containers=new Map(),calls=[],stages=[];
  let environment,binding,revoked=false;
  t.mock.method(platform,'node',async(_candidate,action,input)=>{
    const text=action.toString();
    if(text.includes('readReceipt'))return {mainSha256:'d'.repeat(64),repository,environment,runningImage:image};
    if(text.includes('beta-registry-'))return {helper:{id:image,reference:'registry.candidate.test:5050/root/wizard/successor@'+image},wizard:{id:image,reference:'registry.candidate.test:5050/root/wizard/successor-wizard@'+image}};
    if(text.includes('beta-binding-')){binding={...input,version:2,sourceLayout:'system-monorepo-v1'};return binding;}
    if(text.includes('existsSync'))return true;
    if(text.includes("spawnSync('git'")){assert.equal(input.source,source);assert(text.includes("'ci.skip'"));return;}
    throw Error('unhandled controller fixture '+text.slice(0,80));
  });
  const candidate={id:'e'.repeat(24),spec:{fullAcceptance:true,guidedPreviewAcceptance:true,sourceLayout:'system-monorepo-v1',sharedSourceBundle:'/private/exact.bundle',
    sourceRevision:source,sourceTree:'f'.repeat(40),wizardSourceTree:'1'.repeat(40),ciIdentity:{pipelineId:31,candidateJobId:32},images:{candidate:{id:image},wizard:{id:image}},
    guidedPreviewSettings:{version:2,namespace:'root',wizard:{mode:'existing',project:'wizard',origin:''},review:{enabled:false,host:'',ssl:'',sslKey:''},beta:{enabled:true,host:'beta.candidate.test',ssl:'/ssl/fullchain.pem',sslKey:'/ssl/privkey.pem'}}},
    url:'https://sync.candidate.test',gitlabUrl:'https://gitlab.candidate.test',secrets:{user:'fixture',password:'private'},evidence:{},
    stage:async(name,action)=>{const row={name,status:'running'};stages.push(row);try{const value=await action();row.status='passed';return value;}catch(error){row.status='failed';throw error;}},
    wait:async action=>assert(await action()),
    rails:async script=>{if(script.includes('negativeGatesPassed:true'))return {mode:'contract-fixture',passed:true,negativeGatesPassed:true};
      if(script.includes('activeCount:')){revoked=true;return {activeCount:0};}return {token:'private-fixture-token'};},
    api:async(route,_token,method='GET',payload)=>{calls.push({route,method,payload});
      if(route.includes('/pipelines?'))return [];
      if(route.includes('/repository/branches/'))return {commit:{id:source},protected:true};
      if(route==='/projects/7'&&method==='GET')return {id:7,path_with_namespace:repository.path,namespace:{id:3},visibility:'private'};
      return {};},
    request:async(url,options={})=>{let result;
      if(url.endsWith('/login'))result={accessToken:'fixture'};
      else if(url.endsWith('/preflight'))result={version:2,productionChanged:false,manualDeployment:true,source:{id:7,sourceRevision:source},previewHash:'f'.repeat(64)};
      else if(url.endsWith('/apply')){environment={managementMode:'system-monorepo',operation,settings:{review:{enabled:false},beta:{enabled:true}},deployments:{}};result={state:'complete'};}
      else if(url.endsWith('/preview-setup'))result={version:2,phase:'ready',operation,productionChanged:false,manualDeployment:true};
      else if(url.endsWith('/api/v4/user'))return {status:revoked?401:200,body:''};
      else if(url==='https://beta.candidate.test/'){if(failPage)throw Error('fixture-page-failed');return {status:200,body:'<!doctype html><html></html>'};}
      else throw Error('unexpected URL');return {status:200,body:JSON.stringify(result)};},
    inner:async(args,options)=>{
      calls.push({args,options});
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
  return {candidate,calls,stages,containers,get environment(){return environment;},get revoked(){return revoked;}};
}
test('shared candidate native lifecycle produces explicit v2 evidence without pipeline or build creation',async t=>{
  const f=fixture(t);await adapter.run(f.candidate);evidence.validate(f.candidate.evidence.guidedPreview,f.stages);
  assert(f.revoked);assert.equal(f.containers.size,0);assert(!f.environment.deployments.beta.active);
  assert(!f.calls.some(row=>row.method==='POST'&&/pipelines|merge_requests|repository\/commits/.test(row.route)));
  assert(!f.calls.some(row=>row.args?.includes('build')));
});
test('failed TLS page still stops exact generation, removes helpers and revokes credentials',async t=>{
  const f=fixture(t,true);await assert.rejects(()=>adapter.run(f.candidate),/fixture-page-failed/);
  assert(f.revoked);assert.equal(f.containers.size,0);assert.equal(f.environment.deployments.beta.tombstone.state,'stopped');
  assert.throws(()=>evidence.validate(f.candidate.evidence.guidedPreview,f.stages));
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
