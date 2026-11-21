'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os');
require('../../operations/node_modules/reflect-metadata');
const {NestFactory}=require('../../operations/node_modules/@nestjs/core');
const {GitLabUpgradeModule}=require('../../operations/dist/gitlab-upgrade/gitlab-upgrade.module');
const {GitLabUpgradeService}=require('../../operations/dist/gitlab-upgrade/gitlab-upgrade.service');
const {UpgradeGuardianService}=require('../../operations/dist/gitlab-upgrade/guardian.service');
const {parseContainer,parseCheckpoint,parseOwner,parseChild}=require('../../operations/dist/gitlab-upgrade/types');
const base={sourceRevision:'a'.repeat(40),evidence:'/state/evidence.json',stateDir:'/state',persistentDir:'/operator/platform',checkpointDir:'/state/gitlab-upgrades/test',readyTimeoutSeconds:600};
test('Nest creates independent upgrade sessions and validates options before executing injected commands',async(t)=>{
 const app=await NestFactory.createApplicationContext(GitLabUpgradeModule,{logger:false,abortOnError:false});
 try{
  let calls=0;const service=app.get(GitLabUpgradeService),dependencies={run:()=>{calls++;return 'fixture';}};
  const first=service.create(base,dependencies),second=service.create(base,dependencies);
  assert.equal(calls,0);assert.notEqual(first,second);assert.notEqual(first.held,second.held);
  first.operation='a'.repeat(32);first.owner={operation:first.operation};first.held.push('/fixture');
  assert.equal(second.owner,undefined);assert.deepEqual(second.held,[]);
  assert.equal(second.docker(['version']),'fixture');assert.equal(calls,1);
  for(const malformed of [null,[],{...base,sourceRevision:10},{...base,checkpointDir:'/state/gitlab-upgrades/../other'},{...base,readyTimeoutSeconds:'600'}])assert.throws(()=>service.create(malformed,dependencies));
  assert.equal(calls,1,'invalid input cannot invoke native work');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'upgrade-sync-idle-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const captured=[],session=service.create(base,{run:(binary,args,options)=>{captured.push({binary,args,options});return JSON.stringify({idle:true});}});
  const auth=path.join(dir,'sync-auth.env'),main=path.join(dir,'.docker.env');
  session.state=dir;session.config=main;
  fs.writeFileSync(auth,"export SYNC_AUTH_TOKEN='private-token'\nSYNC_IP=auth-host\n");
  fs.writeFileSync(main,'export SYNC_IP="configured-host"\n');
  session.syncIdle();
  assert.equal(captured[0].binary,process.execPath);
  assert.deepEqual(captured[0].args,[path.resolve(__dirname,'../../gitlab/upgrade.js'),'sync-status']);
  assert.equal(captured[0].options.env.SYNC_AUTH_TOKEN,'private-token');
  assert.equal(captured[0].options.env.SYNC_IP,'configured-host');
  assert.equal(captured[0].options.timeout,15000);
  assert(!captured[0].args.join(' ').includes('private-token'));
  for(const file of [auth,main]){
   const saved=fs.readFileSync(file,'utf8');
   for(const invalid of ['SYNC_IP=$(touch marker)\n','SYNC_IP=$HOSTNAME\n','SYNC_IP=x; echo injected\n']){
    fs.writeFileSync(file,invalid);assert.throws(()=>session.syncIdle(),/environment-/);
    assert.equal(captured.length,1,'invalid configuration must fail before launching status');
   }
   fs.writeFileSync(file,saved);
  }
  for(const response of [{idle:false},{idle:'true'},{}]){
   session.run=()=>JSON.stringify(response);
   assert.throws(()=>session.syncIdle(),/upgrade-sync-operation-running/);
  }
  fs.unlinkSync(auth);assert.throws(()=>session.syncIdle(),/ENOENT/);
 }finally{await app.close();}
});
test('guardian process port preserves the native watchdog contract and inherited runner/GitLab owner',async()=>{
 const app=await NestFactory.createApplicationContext(GitLabUpgradeModule,{logger:false,abortOnError:false});
 try{
  const calls=[],port={run:(binary,args,options)=>{calls.push({binary,args,options});return 'done';}};
  const guardian=new UpgradeGuardianService(port),session=app.get(GitLabUpgradeService).create(base);
  assert.equal(guardian.ownedRun(session,'fixture',['arg']), 'done');assert.equal(calls[0].binary,'fixture');
  session.owner={operation:'b'.repeat(32)};session.operation=session.owner.operation;
  guardian.ownedRun(session,'fixture',['arg'],{timeout:1000,input:'private-input',env:{TEST:'private'}});
  assert.equal(calls[1].binary,process.execPath);assert.equal(calls[1].args[1],'watchdog');assert.equal(calls[1].options.detached,true);assert.equal(calls[1].options.timeout,6000);
  assert(!calls[1].args.join(' ').includes('private'));assert.equal(JSON.parse(calls[1].options.input).timeout,1000);
  session.run=port.run;session.runnerPool('start');
  assert.equal(calls.at(-1).options.env.SYSTEM_GITLAB_UPGRADE_OPERATION,session.operation);
  assert.equal(calls.at(-1).options.env.SYSTEM_CONFIG_DIR,base.stateDir);
  session.start('fixture',true);
  assert.equal(calls.at(-1).options.env.SYSTEM_GITLAB_UPGRADE_OPERATION,session.operation);
 }finally{await app.close();}
});
test('persisted/transport shape failures stop before domain use',()=>{
 for(const value of [null,[],{State:{Running:'true'}},{Image:1},{Mounts:[null]},{HostConfig:{RestartPolicy:{MaximumRetryCount:'3'}}}])assert.throws(()=>parseContainer(JSON.stringify([value])));
 for(const value of [null,{plan:null},{plan:{},entries:[null]},{plan:{runner:{configurations:[null]}},entries:[]}])assert.throws(()=>parseCheckpoint(JSON.stringify(value)));
 assert.throws(()=>parseOwner({format:'system-gitlab-upgrade-lock-v1',operation:'a'.repeat(32),pid:'1'}));
 assert.throws(()=>parseChild({format:'system-gitlab-upgrade-child-v1',operation:'a'.repeat(32),group:'1'}));
});
test('legacy executable validates CLI usage through the typed entry without opening maintenance',()=>{
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../gitlab/upgrade.js'),'promote'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/GitLab upgrade stopped/);assert(!result.stderr.includes('at '));
});
test('public prerequisite runs the accepted helper while preserving the previous controller identity',async t=>{
 const {release}=require('../../operations/dist/gitlab-upgrade/types');
 const {prerequisiteController}=require('../../operations/dist/host/public-gitlab-prerequisite.service');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'public-prerequisite-evidence-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const candidate='sha256:'+'d'.repeat(64),old='sha256:'+'e'.repeat(64),serviceImage='sha256:'+'f'.repeat(64),
  helperId='1'.repeat(64),controllerId='2'.repeat(64),preparationSha256='3'.repeat(64),
  controller={Id:controllerId,Name:'/system_bootstrapper_1',Image:old,State:{Running:true},
   Config:{Labels:{'com.docker.compose.project':'system','com.docker.compose.service':'bootstrapper'}},
   Mounts:[{Destination:'/state',Type:'bind',Source:'/operator/platform/configuration',RW:true}],
   HostConfig:{RestartPolicy:{Name:'always',MaximumRetryCount:0}}},
  original=prerequisiteController(controller),helper={Id:helperId,Image:candidate,State:{Running:true},
   Config:{Hostname:os.hostname(),Labels:{'system.gitlab.prerequisite':preparationSha256}},
   Mounts:structuredClone(controller.Mounts),HostConfig:{PidMode:'host',NetworkMode:'container:'+controllerId}},
  evidence={sourceRevision:base.sourceRevision,fullAcceptance:true,
   results:['gitlab-upgrade-migrated-data','gitlab-upgrade-registry-ci','gitlab-upgrade-restored-checkpoint','gitlab-upgrade-security-trust'].map(name=>({name,status:'passed'})),
   images:{candidate,gitlab:serviceImage,runner:serviceImage},evidence:{gitlabUpgrade:{
    fromImage:release.fromImage,toImage:release.toImage,fromImageId:serviceImage,toImageId:serviceImage,
    migrationVerified:true,rollbackVerified:true,registryVerified:true,checkpointVerified:true,
    runnerImage:release.runner.toImage,runnerImageId:serviceImage,fromRunnerImageId:serviceImage,
    helperImageId:serviceImage,fromHelperImageId:serviceImage,runnerUpgradeVerified:true,runnerManagerIdentityPreserved:true,
    runnerVersion:release.runner.toVersion,helperImage:release.runner.helperImage,
    jobCaBundleSha256:release.jobCaBundleSha256,securityTrustVerified:true}}},
  filename=path.join(directory,'evidence.json');
 fs.writeFileSync(filename,JSON.stringify(evidence),{mode:0o600});
 let currentHelper=helper,currentController=controller;
 const run=(binary,args)=>{
  assert.equal(binary,'docker');
  if(args[0]==='image')return JSON.stringify([{Id:serviceImage,RepoDigests:[args.at(-1)]}]);
  assert.equal(args[0],'inspect');return JSON.stringify([args[1]===helperId?currentHelper:currentController]);
 };
 const app=await NestFactory.createApplicationContext(GitLabUpgradeModule,{logger:false,abortOnError:false});
 try{
  const service=app.get(GitLabUpgradeService),input={...base,evidence:filename},
   dependencies={run,publicExecution:{containerId:helperId,preparationSha256,controller:original}};
  assert.throws(()=>service.create(input,{run}).evidence(),/upgrade-tested-controller-required/);
  assert.equal(service.create(input,dependencies).evidence().candidateImage,candidate);
  for(const patch of [
   {Image:old},{Id:'4'.repeat(64)},{State:{Running:false}},
   {Config:{...helper.Config,Hostname:'foreign-host'}},
   {Config:{...helper.Config,Labels:{'system.gitlab.prerequisite':'4'.repeat(64)}}},
   {HostConfig:{...helper.HostConfig,PidMode:'private'}},
   {HostConfig:{...helper.HostConfig,NetworkMode:'host'}},
   {Mounts:[...helper.Mounts,{Destination:'/unexpected',Type:'bind',RW:true,Source:'/operator/platform/other'}]},
  ]){currentHelper={...helper,...patch};assert.throws(()=>service.create(input,dependencies).evidence(),/public-helper-identity/);}
  currentHelper=helper;
  for(const patch of [{Id:'5'.repeat(64)},{Image:candidate},{State:{Running:false}},
   {HostConfig:{RestartPolicy:{Name:'no'}}},{Mounts:[]}]){
   currentController={...controller,...patch};assert.throws(()=>service.create(input,dependencies).evidence(),/public-helper-identity/);
  }
  currentController=controller;
  const checkpoint='/operator/platform/recovery/controller-updates/retained';
  currentHelper={...helper,Mounts:[...helper.Mounts,{Destination:checkpoint,Type:'bind',Source:checkpoint,RW:false}]};
  assert.equal(service.create(input,{...dependencies,publicExecution:{...dependencies.publicExecution,recoveryCheckpoint:checkpoint}}).evidence().candidateImage,candidate);
  currentHelper.Mounts.at(-1).RW=true;
  assert.throws(()=>service.create(input,{...dependencies,publicExecution:{...dependencies.publicExecution,recoveryCheckpoint:checkpoint}}).evidence(),/public-helper-identity/);
 }finally{await app.close();}
});
test('public prerequisite CLI and mount authority reject unreviewed commands and helper code overlays',()=>{
 const {parsePublicGitlabInput}=require('../../operations/dist/host/public-gitlab-prerequisite-entry');
 const {prerequisiteMountTarget}=require('../../operations/dist/host/public-gitlab-prerequisite.service');
 const common=['--checkout','/reviewed/source','--persistence-env','/private/storage.env','--directory','/platform/configuration/gitlab-prerequisites/to-2-0-0'];
 assert.equal(parsePublicGitlabInput([...common,'--operation','prepare','--target','2.0.0']).operation,'prepare');
 assert.equal(parsePublicGitlabInput([...common,'--operation','rollback','--confirm-checkpoint','a'.repeat(64),'--paired-checkpoint','/platform/recovery/controller-updates/retained']).pairedCheckpoint,'/platform/recovery/controller-updates/retained');
 for(const extra of [['--operation','promote'],['--operation','rollback','--confirm-plan','a'.repeat(64)],
  ['--operation','plan','--confirm-plan','a'.repeat(64)],['--operation','delete'],['--skip-tested-controller']])assert.throws(()=>parsePublicGitlabInput([...common,...extra]));
 for(const target of ['/','/system','/system/../system','/usr','/usr/local','/usr/local/bin','/usr/local/bin/node'])assert.throws(()=>prerequisiteMountTarget(target),/runtime-overlay/);
 for(const target of ['/state','/srv/gitlab/data','/usr/bin/docker','/operator/platform/runners'])assert.doesNotThrow(()=>prerequisiteMountTarget(target));
});
test('completed paired rollback receipts permit a new owned controller ID but reject unverified recovery',t=>{
 const {pairedPrerequisiteRecovery,prerequisiteController}=require('../../operations/dist/host/public-gitlab-prerequisite.service');
 const {bytesSha}=require('../../operations/dist/host/release-selection.service');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-prerequisite-rebind-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const checkpoint=path.join(root,'recovery/controller-updates/retained'),main=path.join(root,'main.env'),
  image='sha256:'+'a'.repeat(64),source='b'.repeat(40),before=Buffer.from('retained configuration\n'),
  controller={Id:'c'.repeat(64),Name:'/system_bootstrapper_1',Image:image,State:{Running:true},
   Mounts:[],Config:{Labels:{'com.docker.compose.project':'system','com.docker.compose.service':'bootstrapper'}},HostConfig:{RestartPolicy:{Name:'always'}}},
  retained={root,controller:prerequisiteController(controller),previous:{images:{controller:{imageId:image}}},metadata:{source:{revision:source}}},
  current={...controller,Id:'d'.repeat(64)},
  operation={format:'system-public-controller-update-v1',phase:'rolled-back',databaseRewound:false,
   release:{sourceRevision:source},previousController:{imageId:image,restartPolicy:{Name:'always'}},configurationBeforeSha256:bytesSha(before)},
  verification={passed:true,configurationUnchanged:true,cubeExact:true,authenticatedFetchMatchesSavedBytes:true};
 fs.mkdirSync(checkpoint,{recursive:true});
 const save=(name,value)=>fs.writeFileSync(path.join(checkpoint,name),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value),{mode:0o600});
 save('operation.json',operation);save('rollback-verification.json',verification);
 save('baseline-before.json',{selectedImages:{system_bootstrapper_1:{imageId:image}}});
 save('main-before.env',before);fs.writeFileSync(main,before,{mode:0o600});
 assert.doesNotThrow(()=>pairedPrerequisiteRecovery(retained,current,checkpoint,main));
 for(const patch of [{phase:'completed'},{databaseRewound:true},{release:{sourceRevision:'e'.repeat(40)}},
  {previousController:{imageId:'sha256:'+'f'.repeat(64),restartPolicy:{Name:'always'}}}]){
  save('operation.json',{...operation,...patch});assert.throws(()=>pairedPrerequisiteRecovery(retained,current,checkpoint,main),/completed-paired-recovery/);
 }
 save('operation.json',operation);save('rollback-verification.json',{...verification,passed:false});
 assert.throws(()=>pairedPrerequisiteRecovery(retained,current,checkpoint,main),/completed-paired-recovery/);
 save('rollback-verification.json',verification);fs.writeFileSync(main,'changed\n');
 assert.throws(()=>pairedPrerequisiteRecovery(retained,current,checkpoint,main),/configuration-changed/);
 const recovered=Buffer.from('offline recovery aliases\n');fs.writeFileSync(main,recovered);
 save('operation.json',{...operation,recoveredConfigurationSha256:bytesSha(recovered)});
 assert.doesNotThrow(()=>pairedPrerequisiteRecovery(retained,current,checkpoint,main));
});
test('shared native GitLab status reads durable receipts without requiring any live controller',t=>{
 const {upgradeStatus}=require('../../operations/dist/gitlab-upgrade/status');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-prerequisite-status-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.deepEqual(upgradeStatus(root,root),{phase:'not-checkpointed',locked:false,checkpointSha256:undefined,planSha256:undefined});
 fs.writeFileSync(path.join(root,'operation.json'),JSON.stringify({phase:'promoted',checkpointSha256:'a'.repeat(64)}),{mode:0o600});
 assert.equal(upgradeStatus(root,root).phase,'promoted');
 fs.chmodSync(path.join(root,'operation.json'),0o644);
 assert.throws(()=>upgradeStatus(root,root),/status-receipt-invalid/);
});
test('host prerequisite prepares public recovery payloads and launches only the pinned helper with private bounded inputs',async t=>{
 const {PublicGitlabPrerequisiteService,prerequisiteController}=require('../../operations/dist/host/public-gitlab-prerequisite.service');
 const {release}=require('../../operations/dist/gitlab-upgrade/types');
 const {bytesSha}=require('../../operations/dist/host/release-selection.service');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-prerequisite-host-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const directory=path.join(root,'configuration/gitlab-prerequisites/to-2-0-0'),candidate='sha256:'+'a'.repeat(64),
  controller={Id:'b'.repeat(64),Name:'/system_bootstrapper_1',Image:'sha256:'+'c'.repeat(64),State:{Running:true},
   Mounts:[{Type:'bind',Source:path.join(root,'configuration'),Destination:'/state',RW:true}],
   Config:{Labels:{'com.docker.compose.project':'system','com.docker.compose.service':'bootstrapper'},
    Env:['NODE_OPTIONS=--require=/state/private-module.js','NODE_PATH=/state/modules','LD_PRELOAD=/state/private.so','PATH=/state/bin',
     'PERSISTENT_DIR='+root,"GITLAB_OMNIBUS_CONFIG=private setting",'SYSTEM_CONFIG_DIR=/state']},
   HostConfig:{RestartPolicy:{Name:'always'}}},
  metadata={version:'2.0.0',images:{controller:{reference:'example/system@'+candidate,imageId:candidate}}},
  previous={version:'1.2.0',images:{controller:{imageId:controller.Image}}},
  graph=require('../../bootstrapper/upgrade-paths.json'),
  accepted={metadata,security:release,release:{sourceRevision:base.sourceRevision},graph,
   proofBytes:Buffer.from('public proof'),raw:Buffer.from('public metadata'),evidence:{}},
  calls=[],helper='d'.repeat(64),
  host={rootUser:()=>true,environment:{PATH:process.env.PATH},run:(binary,args)=>{
   assert.equal(binary,'docker');assert.equal(args[0],'--host=unix:///var/run/docker.sock');calls.push(args.slice(1));
   const command=args[1];
   if(command==='pull')return '';
   if(command==='image')return JSON.stringify([{Id:candidate}]);
   if(command==='create')return helper;
   if(command==='rm')return helper;
   if(command==='inspect')return JSON.stringify([args.at(-1)==='system_bootstrapper_1'?controller:
    {Id:helper,Image:candidate,State:{Running:false,ExitCode:0},Config:{Labels:{'system.gitlab.prerequisite':bytesSha(fs.readFileSync(path.join(directory,'preparation.json')))}}}]);
   throw Error('unexpected host Docker command');
  }},
  config={_root:root,_main:path.join(root,'configuration/.docker.env')},
  runtime={settings:async()=>config,child:{run:async(binary,args,options)=>{
   assert.equal(binary,'docker');assert.deepEqual(args,['--host=unix:///var/run/docker.sock','start','--attach',helper]);
   assert(options.timeout>0);const create=calls.findLast(args=>args[0]==='create');
   assert.deepEqual(create.slice(0,3),['create','--pull','never']);
   assert(create.includes('container:'+controller.Id));assert(create.includes('host'));
   assert.equal(create.at(-6),candidate);
   const launch=JSON.parse(fs.readFileSync(path.join(directory,path.basename(create.at(-3)))));
   assert.equal(launch.containerId,helper);assert.deepEqual(launch.controller,prerequisiteController(controller));
   const envFile=create[create.indexOf('--env-file')+1],env=fs.readFileSync(envFile,'utf8');
   assert(env.includes('GITLAB_OMNIBUS_CONFIG=private setting'));
   assert(!/NODE_OPTIONS|NODE_PATH|LD_PRELOAD|PATH=/.test(env));assert.equal(fs.statSync(envFile).mode&0o777,0o600);
   assert(!create.join(' ').includes('private setting'));
   return JSON.stringify({planSha256:'e'.repeat(64)})+'\n';
  }}},
  preparation={inputs:async()=>accepted,installed:async()=>previous,verifyHost:()=>{},syncIdle:async()=>{}},
  authority={publicInputs:()=>accepted},inspection={mounts:()=>{},inspect:()=>({'system_bootstrapper_1':controller})},
  source={verifyCheckout:()=>{}},service=new PublicGitlabPrerequisiteService(host,runtime,preparation,authority,inspection,source),
  input={operation:'prepare',checkout:path.resolve(__dirname,'../..'),persistenceEnv:'/private/storage.env',directory,repository:'example/system',target:'2.0.0',timeout:900};
 const prepared=await service.execute(input);
 assert.equal(prepared.checkpointDir,path.join(root,'configuration/gitlab-upgrades/public-to-2-0-0'));
 assert.deepEqual(calls.filter(args=>args[0]==='pull').map(args=>args[1]),[
  metadata.images.controller.reference,release.fromImage,release.toImage,release.runner.fromImage,release.runner.toImage,
  release.runner.fromHelperImage,release.runner.helperImage]);
 assert(!calls.some(args=>['stop','rm','update','create'].includes(args[0])),'prepare does not replace a running service');
 const planned=await service.execute({...input,operation:'plan'});
 assert.equal(planned.planSha256,'e'.repeat(64));assert.equal(planned.checkpointDir,prepared.checkpointDir);
 const removed=calls.filter(args=>args[0]==='rm').length;
 runtime.child.run=async()=>{throw Error('attachment outcome uncertain');};
 await assert.rejects(()=>service.execute({...input,operation:'plan'}),/attachment outcome uncertain/);
 assert.equal(calls.filter(args=>args[0]==='rm').length,removed,'an uncertain helper stays available for inspection');
 assert.equal(fs.readdirSync(directory).filter(name=>/^launch-/.test(name)).length,2);
 const inspectionCount=calls.filter(args=>args[0]==='inspect').length;
 assert.equal((await service.execute({...input,operation:'status'})).phase,'not-checkpointed');
 assert.equal(calls.filter(args=>args[0]==='inspect').length,inspectionCount,'status needs no live controller');
});
test('future public fixture proves prerequisite authority without exporting unobserved candidate results',()=>{
 const {PublicUpgradePublicationService}=require('../../operations/dist/testing/public-upgrade-publication.service');
 const {HostReleaseAuthorityService}=require('../../operations/dist/host/release-authority.service');
 const input=require('../shared/public-upgrade-fixture').publicationFixture(),
  edge=require('../../bootstrapper/upgrade-paths.json').transitions.find(row=>row.databaseMigration),
  security=require('../../gitlab/security-release.json');
 input.previous.version=edge.from;input.previous.tag='v'+edge.from;input.edge=edge;
 input.publicationMode='future-release-before-prerequisite-v1';
 for(const key of ['checkpointVerified','migrationVerified','registryVerified','securityTrustVerified','runnerUpgradeVerified'])delete input.gitlabUpgrade[key];
 const original=JSON.stringify(input),service=new PublicUpgradePublicationService({verify(){throw Error('actual prerequisite not migrated yet');}}),
  publication=service.prepare(path.resolve(__dirname,'../..'),input),
  accepted=new HostReleaseAuthorityService({}).publicInputs(publication.metadata,publication.proof,security);
 assert.equal(accepted.release.imageId,input.spec.images.candidate.id);
 assert.equal(JSON.stringify(input),original,'fixture publication does not claim the observed migration ran');
 assert(publication.proof.equals(service.prepare(path.resolve(__dirname,'../..'),input).proof));
});
