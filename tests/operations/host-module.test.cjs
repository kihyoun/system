require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {NestFactory}=require('@nestjs/core');
const {HostModule,hostProcessRunner}=require('../../dist/modules/host/host.module');
const {HostInstallService}=require('../../dist/modules/host/install');
const {RuntimeInspectionService}=require('../../dist/modules/host/runtimeInspection');
test('standalone Host module injects shared native adapter without running operations',async()=>{
 let response=new Response('accepted'),requests=[];
 const publicReleaseRequest=async(url,options)=>{requests.push([String(url),options]);return response;};
 let calls=0;const runner={run(){calls++;return {stdout:'',stderr:'',status:0};}};
 const app=await NestFactory.createApplicationContext(HostModule.register({runner,publicReleaseRequest,environment:{CUSTOM:'test'}}),{logger:false});
 try {
  const {PromotionNativePortService}=require('../../dist/modules/host/promotionNativePort.service'),{PromotionAbortService}=require('../../dist/modules/host/promotionAbort.service'),{ColdMaintenanceService}=require('../../dist/modules/host/coldMaintenance.service');
  assert.equal(app.get(PromotionAbortService).port,app.get(PromotionNativePortService));assert.equal(app.get(ColdMaintenanceService).port,app.get(PromotionNativePortService));
  const {GitlabPreflightService}=require('../../dist/modules/gitlab-preflight/gitlabPreflight.service');
  assert.equal(app.get(PromotionNativePortService).nativeGitlabProbe,app.get(GitlabPreflightService));
  const {promotionRecoveryArguments}=require('../../dist/modules/host/promotionRecoveryEntry');
  assert.equal(promotionRecoveryArguments(['--checkpoint-dir','/retained/checkpoint','--persistence-env','/private/storage.env']).timeout,1200);
  assert.throws(()=>promotionRecoveryArguments(['--checkpoint-dir','/retained/checkpoint','--persistence-env','/private/storage.env','--timeout','NaN']),/bounded-promotion/);
  await assert.rejects(app.get(PromotionNativePortService).prepare({checkout:'/source',checkpoint:'/retained/checkpoint',persistenceEnv:'/private/storage.env',timeout:0}),/bounded-promotion/);
  const {PublicReleaseAssetsService}=require('../../dist/modules/host/publicReleaseAssets.service'),
    {PublicUpgradePreparationService}=require('../../dist/modules/host/publicUpgradePreparation.service');
  const assets=app.get(PublicReleaseAssetsService),preparation=app.get(PublicUpgradePreparationService);
  const {RecoveryArchiveService}=require('../../dist/modules/host/recoveryArchive.service');
  assert(app.get(RecoveryArchiveService) instanceof RecoveryArchiveService);
  const {RecoveryExportService}=require('../../dist/modules/host/recoveryExport.service');
  assert.equal(app.get(RecoveryExportService).archives,app.get(RecoveryArchiveService));
  assert.equal(preparation.assets,assets);
  const {PairedControllerService}=require('../../dist/modules/host/pairedController.service'),{PairedUpdateService}=require('../../dist/modules/host/pairedUpdate.service'),{PublicUpgradeService}=require('../../dist/modules/host/publicUpgrade.service'),{ControllerUpdateSequenceService}=require('../../dist/modules/host/controllerUpdateSequence.service'),{ControllerRollbackSequenceService}=require('../../dist/modules/host/controllerRollbackSequence.service');
  const paired=app.get(PairedUpdateService),publicUpgrade=app.get(PublicUpgradeService);
  assert.equal(app.get(PairedControllerService).paired,paired);
  const {PromotionService}=require('../../dist/modules/host/promotion.service'),{PromotionSequenceService}=require('../../dist/modules/host/promotionSequence.service');
  assert.equal(app.get(PromotionService).sequence,app.get(PromotionSequenceService));assert.equal(app.get(PromotionService).coldSequence,app.get(ColdMaintenanceService));
  assert.equal(publicUpgrade.paired,paired);assert.equal(publicUpgrade.preparation,preparation);
  assert.equal(paired.updates,app.get(ControllerUpdateSequenceService));
  assert.equal(paired.rollbacks,app.get(ControllerRollbackSequenceService));

  assert.equal((await assets.load('example/system','v2.0.0','system-release-v2.0.0.json')).toString(),'accepted');
  assert.equal(requests[0][1].redirect,'manual');assert.equal(requests[0][1].headers,undefined);
  response=new Response('',{status:302,headers:{location:'https://unapproved.invalid/asset'}});
  await assert.rejects(assets.load('example/system','v2.0.0','release.json'),/unapproved-public-release-redirect/);
  await assert.rejects(assets.load('example/..','v2.0.0','release.json'),/invalid-public-release-location/);
  const metadata={platform:'linux/amd64',compatibility:{versions:['24.04'],minimumMemoryGiB:8}},
    facts={release:{ID:'ubuntu',VERSION_ID:'24.04'},architecture:'x64',memoryBytes:7864320*1024};
  preparation.verifyHost(metadata,facts);
  assert.throws(()=>preparation.verifyHost(metadata,{...facts,memoryBytes:7800000*1024}),/insufficient-upgrade-memory/);
  assert.throws(()=>preparation.verifyHost(metadata,{...facts,architecture:'arm64'}),/supported-Ubuntu/);
  const host=app.get(HostInstallService);assert.equal(app.get(hostProcessRunner),runner);assert.equal(app.get(RuntimeInspectionService).host,host);assert.equal(calls,0);
  host.run('git',['--version']);assert.equal(calls,1);
  const native=app.get(PromotionNativePortService),original=native.lease.command;let received;
  native.lease.command=async(...args)=>{received=args;return Buffer.from('ok');};
  try {assert.equal(await native.command(['exec','-i','a'.repeat(64),'dd','of=/private/credential'],30,'private-input'),'ok');assert(!received[0].some(arg=>arg.includes('private-input')));assert.equal(received[2].toString(),'private-input');}
  finally {native.lease.command=original;}
 }finally{await app.close();}
});
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {HostStorageService}=require('../../dist/modules/host/hostStorage.service');
for (const [version,imageVersion] of [['1.2.0','1.2.0'],['2.0.0','2.0.0'],['2.0.0','1.2.0'],['1.2.0','2.0.0']]) test('host storage checkout '+version+' / image '+imageVersion+' preserves operation-owned duration and retains uncertain launchers',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-storage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'VERSION'),version+'\n');
 const selector=path.join(root,'persistence.env');fs.writeFileSync(selector,'',{mode:0o600});
 const calls=[],id='sha256:'+'a'.repeat(64),container='b'.repeat(64),imageCommand=imageVersion==='2.0.0'?['system-bootstrapper','lifecycle','start','/system']:['/bin/bash','./start.sh'];let name,uncertain=false,observedCommand=JSON.stringify(imageCommand),inspectionFails=false;
 const host={rootUser:()=>true,environment:{DOCKER_CONTEXT:'remote'},storage:()=>({selected:{},root}),run(binary,args,env,timeout){calls.push([binary,args]);if(args.includes('create')){name=args[args.indexOf('--name')+1];return container;}if(args[1]==='image'&&args[2]==='inspect'){if(args[4]==='{{.Id}}')return id;if(args[4]==='{{json .Config.Cmd}}'){assert.equal(args.at(-1),id);assert.equal(timeout,10000);if(inspectionFails)throw Error('private-inspection-detail');return observedCommand+'\n';}}if(args[1]==='container'&&args[2]==='inspect')return JSON.stringify([{Id:container,Image:id,Config:{Labels:{'system.storage.launcher':name}},State:{Status:'exited',Running:false,ExitCode:0}}]);if(args[1]==='rm')return '';throw Error('unsupported-test-host-command');}};
 const attached={async run(binary,args,env){calls.push([binary,args]);assert(!env.DOCKER_CONTEXT);assert(args.includes('--attach'));assert(args.includes('--interactive'));if(uncertain)throw Error('host-storage-launch-outcome-uncertain');}};
 const persistence={async prepare(){calls.push(['persistence.prepare',[]]);}};
 const service=new HostStorageService(host,attached,persistence),command={operation:'harvest',image:'accepted:image',checkout:root,persistenceEnv:selector,checkOnly:true};
 await service.execute(command);
 const args=calls.find(([,args])=>args.includes('create'))[1];assert.deepEqual(args.slice(args.indexOf(id)+1),imageVersion==='2.0.0'?['/system/dist/cli/main.js','storage','host','harvest','--check-only']:['/system/system/seed-operation.js','host','harvest','--check-only']);assert(args.includes('type=bind,src=/,dst=/host,readonly'));assert(args.includes(`SYSTEM_SEED_CONTROLLER_IMAGE=${id}`));assert(args.includes('--check-only'));assert(!calls.some(([binary])=>binary==='bash'));assert(calls.at(-1)[1].includes('rm'));
 const inspection=calls.find(([,args])=>args.includes('{{json .Config.Cmd}}'))[1];assert.deepEqual(inspection,['--host=unix:///var/run/docker.sock','image','inspect','--format','{{json .Config.Cmd}}',id]);assert(!calls.some(([,args])=>args.includes('run')));assert(!calls.some(([binary])=>binary==='persistence.prepare'));
 calls.length=0;uncertain=true;await assert.rejects(service.execute(command),/outcome-uncertain/);assert(!calls.some(([,args])=>args.includes('rm')));
 await assert.rejects(service.execute({...command,operation:'bad'}),/invalid-host-storage-operation/);
 if(version==='2.0.0'&&imageVersion==='1.2.0'){
  uncertain=false;
  for(const invalid of [null,[],{},'', ['/bin/bash'], ['bash','./start.sh'], ['/bin/bash','./start.sh','extra'], ['system-bootstrapper','lifecycle','start'], ['system-bootstrapper','lifecycle','start','/other']]){
   observedCommand=JSON.stringify(invalid);calls.length=0;
   await assert.rejects(service.execute({...command,checkOnly:false}),error=>error.code==='unsupported-controller-image-layout');
   assert(!calls.some(([binary,args])=>binary==='persistence.prepare'||args.includes('create')||args.includes('start')));
  }
  for(const invalid of ['', '<no value>', '{private-layout-detail']){
   observedCommand=invalid;calls.length=0;
   await assert.rejects(service.execute({...command,checkOnly:false}),error=>error.code==='accepted-controller-image-layout-unavailable');
   assert(!calls.some(([binary,args])=>binary==='persistence.prepare'||args.includes('create')||args.includes('start')));
  }
  observedCommand=JSON.stringify(imageCommand);inspectionFails=true;calls.length=0;
  await assert.rejects(service.execute({...command,checkOnly:false}),error=>error.code==='accepted-controller-image-layout-unavailable');
  assert(!calls.some(([binary,args])=>binary==='persistence.prepare'||args.includes('create')||args.includes('start')));
 }
});
test('compatibility storage argument parser preserves environment and selectors',()=>{
 const {storageArguments}=require('../../dist/modules/host/storageEntry');
 assert.deepEqual(storageArguments(['restore','--image','accepted','--configuration-backup','/backup.zip','--check-only'],{PERSISTENCE_ENV_FILE:'/private/settings'},'/checkout'),{operation:'restore',image:'accepted',checkout:'/checkout',persistenceEnv:'/private/settings',configurationBackup:'/backup.zip',checkOnly:true});
 assert.throws(()=>storageArguments(['restore','--other'],{},'/checkout'),/arguments/);
 const {spawnSync}=require('node:child_process');
 const invalid=spawnSync(process.execPath,[path.resolve(__dirname,'../../dist/cli/main.js'),'restore','--checkout',path.resolve(__dirname,'../..'),'--other'],{encoding:'utf8'});
 assert.equal(invalid.status,1);assert.equal(invalid.stdout,'');
 assert.equal(invalid.stderr,'System Bootstrapper: unknown-command-use-help\n');
});
test('native controller lease preserves critical ownership, excludes contenders and adopts only dead owners',async t=>{
 const {ControllerLeaseService}=require('../../dist/modules/host/controllerLease.service');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'controller-lease-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const directory of ['configuration/.projects.env','host/letsencrypt','gitlab/data'])fs.mkdirSync(path.join(root,directory),{recursive:true});
 const service=new ControllerLeaseService();service.acquire({root});
 const operation=service.operation,ownerPath=path.join(root,'configuration/.gitlab-upgrade-lock/controller-owner.json');
 assert.throws(()=>new ControllerLeaseService().adopt({root},operation),/still-running/);
 const description=service.describe();assert.equal(description.operation,operation);
 description.held.length=0;assert.equal(service.describe().held.length,4);
 assert.throws(()=>service.assertOperation('foreign'),/ownership-changed/);
 for(const directory of service.describe().held)service.assertIdle(directory);
 const extra=path.join(service.describe().held[0],'foreign');fs.writeFileSync(extra,'');
 assert.throws(()=>service.assertIdle(service.describe().held[0]),/lease-changed/);fs.unlinkSync(extra);
 const pending=service.command([process.execPath,'-e','process.stdout.write("guarded")']);
 assert.throws(()=>service.command([process.execPath,'-e','']),/has-not-finished/);assert.throws(()=>service.release(),/has-not-finished/);
 assert.equal((await pending).toString(),'guarded');
 assert.equal(JSON.parse(fs.readFileSync(service.journal)).phase,'completed');
 service.critical=true;service.finish(true);assert(fs.existsSync(ownerPath));
 assert.throws(()=>new ControllerLeaseService().adopt({root},operation),/operation-is-still-running/);
 const directories=['configuration/.gitlab-upgrade-lock','configuration/.storage-operation-lock','host/letsencrypt/.system-bootstrapper-certificate-lock','configuration/.projects.env/.wizard.env.environments.lock'];
 for(const directory of directories){const filename=path.join(root,directory,'controller-owner.json'),owner=JSON.parse(fs.readFileSync(filename));owner.bootId='previous-boot';fs.writeFileSync(filename,JSON.stringify(owner));}
 const recovery=new ControllerLeaseService();recovery.adopt({root},operation);assert.equal(recovery.operation,operation);
 await assert.rejects(recovery.command([process.execPath,'-e','process.exit(7)']),/command-failed/);
 assert.equal(JSON.parse(fs.readFileSync(recovery.journal)).exitCode,7);
 recovery.release();assert(!fs.existsSync(ownerPath));
 const fresh=new ControllerLeaseService();fresh.acquire({root});fresh.release();
 const {spawn}=require('node:child_process');
 const gate=path.join(root,'release-orphan-worker');
 const worker='const fs=require("node:fs");const timer=setInterval(()=>{if(fs.existsSync(process.argv[1])||!fs.existsSync(process.argv[2]))clearInterval(timer)},20)';
 const coordinator=spawn(process.execPath,['-e',`const {ControllerLeaseService}=require(${JSON.stringify(require.resolve('../../dist/modules/host/controllerLease.service'))});const lease=new ControllerLeaseService();lease.acquire({root:process.argv[1]});lease.critical=true;lease.command([process.execPath,'-e',${JSON.stringify(worker)},process.argv[2],process.argv[1]]).catch(error=>{console.error(error.message);process.exitCode=1});`,root,gate],{stdio:['ignore','ignore','pipe']});
 let spawnError,stderr='';
 coordinator.on('error',error=>{spawnError=error;});
 coordinator.stderr.on('data',bytes=>{stderr+=bytes.toString();});
 const ended=new Promise(resolve=>coordinator.once('exit',(code,signal)=>resolve({code,signal})));
 const journal=path.join(root,'configuration/.gitlab-upgrade-lock/host-child.json');
 const readJournal=()=>fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal)):null;
 // Bound a failed test, not the lifetime of the worker being tested. Each phase gets its own wait budget.
 const waitFor=async(predicate,message)=>{
  const until=performance.now()+60000;
  while(!predicate()){
   assert(performance.now()<until,message);
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 };
 try{
  await waitFor(()=>{
   assert.ifError(spawnError);
   assert(coordinator.exitCode===null&&coordinator.signalCode===null,`coordinator exited before worker readiness: ${stderr}`);
   const phase=readJournal()?.phase;
   assert.notEqual(phase,'completed','worker completed before explicit release');
   return phase==='running';
  },'guardian did not publish a running child journal');
  const orphanOperation=JSON.parse(fs.readFileSync(ownerPath)).operation;
  assert(coordinator.kill('SIGKILL'));assert.equal((await ended).signal,'SIGKILL');
  assert.throws(()=>new ControllerLeaseService().adopt({root},orphanOperation),/still-running/);
  // Release only after proving that a dead coordinator cannot be adopted while its worker is alive.
  fs.writeFileSync(gate,'');
  await waitFor(()=>readJournal()?.phase==='completed','guardian did not publish completion');
  assert.equal(readJournal().exitCode,0);
  // Completion is published before the guardian finally closes its inherited flock.
  let orphan;
  await waitFor(()=>{
   try{orphan=new ControllerLeaseService();orphan.adopt({root},orphanOperation);return true;}
   catch(error){assert.match(error.message,/still-running/);return false;}
  },'completed orphan could not be adopted');
  assert(orphan.guardFd>=0);orphan.release();
 }finally{
  // The test worker also exits if the temporary root is removed by the registered cleanup.
  fs.writeFileSync(gate,'');
  if(coordinator.exitCode===null&&coordinator.signalCode===null&&!spawnError){coordinator.kill('SIGKILL');await ended;}
 }

});
test('cold maintenance shares awaited native sequencing, bounded drain and fail-closed recovery',async()=>{
 const {ColdMaintenanceService,ActiveMaintenanceJobs}=require('../../dist/modules/host/coldMaintenance.service');
 for(const scenario of ['success','claimed-job','expired','uncertain-stop','busy-exec','forced-stop','service-up']){
  const row=(Id,service)=>({Id,Image:'old-image',State:{Running:true,Paused:false,ExitCode:0,OOMKilled:false},HostConfig:{RestartPolicy:{Name:'always'}},ExecIDs:[],Config:{Labels:{'com.docker.compose.project':'system','com.docker.compose.service':service}}});
  const rows={controller:row('controller','bootstrapper'),gitlab:row('gitlab','gitlab'),web:row('web','web'),runner:row('runner','docker_1')};
  const input={controller:structuredClone(rows.controller),gitlab:structuredClone(rows.gitlab),web:structuredClone(rows.web),runners:[structuredClone(rows.runner)],deadline:180,mainHash:null};
  const calls=[];let clock=0,uptime=100,copied=false;
  const port={inspect:async id=>structuredClone(rows[id]),phase:async()=>{},probe:async()=>({runningJobs:scenario==='claimed-job'?1:0}),checkpoint:async()=>{copied=true;calls.push(['checkpoint']);return 'digest';},now:()=>clock,sleep:async seconds=>{clock+=seconds;},uptime:()=>{const value=uptime;if(scenario==='expired')uptime+=200;return value;},mainHash:()=>null,
   command:async args=>{calls.push(args);assert(!args.includes('/bin/sh'));assert(!args.includes('-ec'));const target=rows[args.at(-1)];
    if(args.includes('gitlab-ctl')&&args.at(-1)==='stop'&&scenario==='uncertain-stop')throw Error('uncertain-stop');
    if(args[0]==='update')target.HostConfig.RestartPolicy.Name=args[1].split('=')[1];
    if(args[0]==='pause')target.State.Paused=true;
    if(args[0]==='unpause')target.State.Paused=false;
    if(args[0]==='start')target.State.Running=true;
    if(args[0]==='stop'){target.State.Running=false;if(target===rows.gitlab&&scenario==='forced-stop')target.State.ExitCode=137;}
    if(args[0]==='kill')Object.assign(target.State,{Running:false,Paused:false,ExitCode:137});
    if(args.includes('status'))return scenario==='service-up'?'run: puma: 3s':'down: native-service: 0s\n';return '';
   }};
  if(scenario==='busy-exec')rows.gitlab.ExecIDs=['pending'];
  const service=new ColdMaintenanceService(port);
  if(scenario==='success'){
   assert.equal(await service.run(input),'digest');assert(copied);assert(!rows.controller.State.Running);
   const stop=calls.findIndex(args=>args[0]==='stop'&&args.at(-1)==='gitlab'),kill=calls.findIndex(args=>args[0]==='kill');assert(stop>=0&&kill>stop&&calls.at(-1)[0]==='checkpoint');
  }else{
   await assert.rejects(service.run(input),scenario==='claimed-job'?ActiveMaintenanceJobs:/expired|uncertain-stop|drain-timeout|not-clean/);
   assert(!copied);assert(!calls.some(args=>args[0]==='kill'));
   if(scenario==='claimed-job'){for(const value of Object.values(rows))assert(value.State.Running);assert(!rows.controller.State.Paused);assert.equal(rows.controller.HostConfig.RestartPolicy.Name,'always');}
  }
 }
});
test('native checkpoint verifies retained bytes and shared recovery rejects a concurrent caller before cleanup',async t=>{
 const {ControllerCheckpointService}=require('../../dist/modules/host/controllerCheckpoint.service');
 const {PromotionRecoveryService}=require('../../dist/modules/host/promotionRecovery.service');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-checkpoint-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ['data/gitlab','data/configuration','checkpoint'])fs.mkdirSync(path.join(root,name),{recursive:true});
 fs.writeFileSync(path.join(root,'data/gitlab/payload'),'retained');fs.symlinkSync('payload',path.join(root,'data/gitlab/link'));
 const commands=[],lease={guardFd:3,async command(args){commands.push(args);const mounts=args.filter(value=>value.startsWith('type=bind,src=')).map(value=>value.split(',')[1].slice(4));assert.equal(mounts.length,2);fs.cpSync(mounts[0],mounts[1],{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});return Buffer.alloc(0);}};
 const checkpoint=new ControllerCheckpointService(lease),directory=path.join(root,'checkpoint'),digest=await checkpoint.copy(path.join(root,'data'),directory,'accepted-image');
 checkpoint.verify(directory,digest);assert.equal(commands.length,2);assert(commands.every(args=>args.includes('--numeric-ids')&&args.includes('--fsync')&&!args.includes('/bin/sh')));
 fs.writeFileSync(path.join(directory,'gitlab/payload'),'changed');assert.throws(()=>checkpoint.verify(directory,digest),/content-mismatch/);
 let unblock,finished=0;const waiting=new Promise(resolve=>unblock=resolve),port={async prepare(){await waiting;return {};},finish(failed){finished++;assert.equal(failed,false);}},sequence={async run(){}};
 const recovery=new PromotionRecoveryService(port,sequence),first=recovery.abort({});await assert.rejects(recovery.abort({}),/already-running/);assert.equal(finished,0);unblock();await first;assert.equal(finished,1);
});

test('retained recovery publication advances both security images without losing earlier archives',()=>{
 const {RecoveryPublicationService}=require('../../dist/modules/host/recoveryPublication.service');
 const security=require('../../config/gitlab/security-release.json'), service=new RecoveryPublicationService();
 const old={archives:[{file:'images/old.tar.gz',imageId:'sha256:'+'1'.repeat(64)}],localImages:[{tag:'system_bootstrapper',imageId:'sha256:'+'1'.repeat(64)}],publicImages:[{reference:security.fromImage,tag:security.fromImage.split('@')[0]},{reference:security.runner.fromImage,tag:security.runner.fromImage.split('@')[0]}],currentController:{reference:'controller:old',imageId:'sha256:'+'1'.repeat(64)}};
 const before=structuredClone(old),archive={file:'images/new.tar.gz',imageId:'sha256:'+'2'.repeat(64)};
 const refresh=previous=>service.refresh(previous,archive,['a'.repeat(40),'b'.repeat(40),'c'.repeat(40)],'controller:new',archive.imageId,security.toImage,'sha256:'+'3'.repeat(64),'wizard:retained',security.runner.toImage,'sha256:'+'4'.repeat(64));
 const value=refresh(old);
 assert.deepEqual(old,before);assert.deepEqual(value.archives[0],before.archives[0]);assert.deepEqual(value.controllerHistory,[before.currentController]);
 assert.deepEqual(new Set(value.publicImages.map(row=>row.reference)),new Set([security.toImage,security.runner.toImage]));
 assert.equal(value.publicImages[1].imageId,'sha256:'+'4'.repeat(64));
 assert.throws(()=>refresh({...old,publicImages:old.publicImages.slice(0,1)}),/Runner-public-image-declaration/);
});
test('native paired runtime preserves immutable peers, lease ownership, readiness diagnostics and private command transport',async()=>{
 const {PairedRuntimeService,repairPeers,verifyRunnerContainers,unchangedPairedServices}=require('../../dist/modules/host/pairedRuntime.service');
 const {HostPolicyError}=require('../../dist/modules/host/install');
 let nativeCalls=[],leaseCalls=[],finished=[],probe={version:'19.6.1',edition:'CE',runningJobs:0,unfinishedBackgroundMigrations:0};
 const host={environment:{DOCKER_CONTEXT:'foreign',DOCKER_TLS_VERIFY:'1',DOCKER_CERT_PATH:'/private'},runner:{run(binary,args,options){nativeCalls.push({binary,args,options});return {status:0,stdout:'native',stderr:''};}}};
 const row=(service,id)=>({Id:id.repeat(64),Image:'sha256:'+id.repeat(64),Config:{Labels:{'com.docker.compose.project':service.startsWith('docker_')?'runner':'system','com.docker.compose.service':service}},State:{Running:true,Health:{Status:'healthy'}},ExecIDs:null});
 const rows={system_bootstrapper_1:row('bootstrapper','a'),system_gitlab_1:row('gitlab','b'),runner_docker_1:row('docker_1','c'),runner_docker_2:row('docker_2','d')};
 const runtime={services:()=>rows,publicImages(){},verify:async()=>{throw new HostPolicyError('runner-contact-missing');}};
 const lease={acquire(){leaseCalls.push('acquire');},command:async(...args)=>{leaseCalls.push(args);return Buffer.from('guarded');},finish:value=>finished.push(value)};
 const service=new PairedRuntimeService(host,runtime,{mounts(){}},lease,{probe:async(_id,port)=>{await port.command(['exec','b'.repeat(64),'psql'],30,'private-password');return probe;}},{});
 const config={_root:'/live',_main:'/live/configuration/.docker.env'},input={checkout:'/source',persistenceEnv:'/selector',tokenFile:'/token',timeout:0},context=service.context(input,config);
 assert.equal(await context.docker(['version'],5,'private'), 'native');
 assert.equal(nativeCalls[0].options.env.DOCKER_HOST,'unix:///var/run/docker.sock');for(const key of ['DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])assert.equal(nativeCalls[0].options.env[key],undefined);
 assert.equal(nativeCalls[0].options.input,'private');assert(!nativeCalls[0].args.includes('private'));
 context.acquire();assert.equal(await context.docker(['version'],5,'private'),'guarded');assert.equal(leaseCalls[1][2].toString(),'private');
 const evidence={evidence:{gitlabUpgrade:{toImageId:rows.system_gitlab_1.Image,runnerImageId:rows.runner_docker_1.Image}}};
 rows.runner_docker_2.Image=rows.runner_docker_1.Image;
 await context.current(evidence,{toVersion:'19.6.1'});probe={...probe,runningJobs:1};await assert.rejects(context.current(evidence,{toVersion:'19.6.1'}),/jobs-or-migrations/);probe.runningJobs=0;
 rows.runner_docker_2.Image='wrong';await assert.rejects(context.current(evidence,{toVersion:'19.6.1'}),/current-runner-image/);rows.runner_docker_2.Image=rows.runner_docker_1.Image;
 repairPeers(rows);rows.runner_docker_2.ExecIDs=['active'];assert.throws(()=>repairPeers(rows),/active-or-unknown-execs/);rows.runner_docker_2.ExecIDs=null;
 verifyRunnerContainers(rows,{runner_docker_1:rows.runner_docker_1.Id,runner_docker_2:rows.runner_docker_2.Id});assert.throws(()=>verifyRunnerContainers(rows,{runner_docker_1:rows.runner_docker_1.Id}),/runner-containers-changed/);
 const baseline={selectedImages:Object.fromEntries(Object.entries(rows).map(([name,value])=>[name,{imageId:value.Image}]))};unchangedPairedServices(rows,baseline);assert.throws(()=>unchangedPairedServices({...rows,foreign:rows.system_gitlab_1},baseline),/service-set-changed/);
 await assert.rejects(context.waitReady({}),/readiness-failed:runner-contact-missing/);assert.equal(host.deadline,undefined);
 runtime.verify=async()=>{throw Error('private-password');};await assert.rejects(context.waitReady({}),error=>error.message==='controller-update-readiness-failed:unexpected-readiness-error');assert.equal(host.deadline,undefined);
 runtime.verify=async()=>({runnerManagers:{checked:true}});assert.deepEqual(await context.waitReady({}),{runnerManagers:{checked:true}});
 context.finish(true);assert.deepEqual(finished,[true]);
 const originalNow=Date.now,originalTimeout=global.setTimeout;
 try {
  for(const [failure,expected] of [['command-failed:docker','runner-contact-missing'],['service-not-healthy','service-not-healthy'],['operation-readiness-deadline-expired','runner-contact-missing']]){
   let clock=100000,calls=0;Date.now=()=>clock;global.setTimeout=(callback,ms)=>{clock+=ms;queueMicrotask(callback);return {};};
   runtime.verify=async()=>{if(++calls===1)throw new HostPolicyError('runner-contact-missing');clock=103100;throw new HostPolicyError(failure);};
   const retry=service.context({...input,timeout:3.1},config);
   await assert.rejects(retry.waitReady({}),error=>error.message==='controller-update-readiness-failed:'+expected);assert.equal(calls,2);assert.equal(host.deadline,undefined);
  }
  let clock=100000;Date.now=()=>clock;global.setTimeout=(callback,ms)=>{clock+=ms;queueMicrotask(callback);return {};};host.deadline=102500;runtime.verify=async()=>{throw new HostPolicyError('runner-contact-missing');};
  await assert.rejects(service.context({...input,timeout:10},config).waitReady({}),/runner-contact-missing/);assert.equal(clock,102500);assert.equal(host.deadline,102500);host.deadline=undefined;
 }finally{Date.now=originalNow;global.setTimeout=originalTimeout;}

 const {parsePublicUpgradeInput}=require('../../dist/modules/host/publicUpgradeEntry');const parsed=parsePublicUpgradeInput(['--operation','status','--checkout','/source','--persistence-env','/selector','--plan-dir','/retained']);assert.equal(parsed.directory,'/retained');assert.equal(parsed.timeout,1200);assert.throws(()=>parsePublicUpgradeInput(['--operation','bad']),/invalid-public-upgrade-operation/);
 const {spawn}=require('node:child_process');
 const cancellationPath=path.resolve(__dirname,'../../dist/modules/host/operationCancellation');
 const child=spawn(process.execPath,['-e',`const {operationSignals}=require(${JSON.stringify(cancellationPath)});const before=process.listenerCount('SIGTERM');const owner=operationSignals();const timer=setInterval(()=>{},1000);owner.signal.addEventListener('abort',()=>{owner.close();clearInterval(timer);process.stdout.write('closed:'+String(process.listenerCount('SIGTERM')===before));});process.stdout.write('ready\\n');`],{stdio:['ignore','pipe','pipe']});
 let output='';await new Promise((resolve,reject)=>{child.stdout.on('data',bytes=>{output+=bytes;if(output.includes('ready')&&!output.includes('closed:'))child.kill('SIGTERM');});child.once('error',reject);child.once('close',(code,signal)=>{try{assert.equal(code,0);assert.equal(signal,null);assert(output.endsWith('closed:true'));resolve();}catch(error){reject(error);}});});

});
test('configuration backup native reader preserves store/deflate bytes and rejects ambiguous or corrupt exports',()=>{
 const {ConfigurationBackupArchive}=require('../../dist/modules/host/configurationBackupArchive'),{crc32,deflateRawSync}=require('node:zlib');
 function zip(entries){let offset=0;const bodies=[],directory=[];for(const [name,value,method=0] of entries){const filename=Buffer.from(name),raw=Buffer.from(value),data=method===8?deflateRawSync(raw):raw,local=Buffer.alloc(30),central=Buffer.alloc(46);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(method,8);local.writeUInt32LE(crc32(raw),14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(method,10);central.writeUInt32LE(crc32(raw),16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);bodies.push(local,filename,data);directory.push(central,filename);offset+=local.length+filename.length+data.length;}const dir=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...bodies,dir,end]);}
 const content='private exact bytes\n$Cube\n',raw=zip([['.docker.env',content],['.projects.env/.a.env','UNICODE=한글\n',8]]),archive=new ConfigurationBackupArchive(raw);
 assert.equal(archive.read('.docker.env').toString(),content);assert.equal(archive.read('.projects.env/.a.env').toString(),'UNICODE=한글\n');assert.throws(()=>archive.read('missing'),/entry-missing/);
 assert.throws(()=>new ConfigurationBackupArchive(zip([['same','a'],['same','b']])),/duplicate/);
 const corrupted=Buffer.from(raw);corrupted[30+'.docker.env'.length]^=1;assert.throws(()=>new ConfigurationBackupArchive(corrupted).read('.docker.env'),/checksum/);
 const huge=Buffer.from(raw),central=huge.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));huge.writeUInt32LE(50*1024**2+1,central+24);assert.throws(()=>new ConfigurationBackupArchive(huge),/too-large/);
 assert.throws(()=>new ConfigurationBackupArchive(Buffer.from('not a ZIP')),/invalid-configuration/);
});
test('native promotion uses shared providers, preserves old image selectors and retains interrupted ownership',async t=>{
 const {PromotionService}=require('../../dist/modules/host/promotion.service'),{PromotionSequenceService}=require('../../dist/modules/host/promotionSequence.service'),{ColdMaintenanceService}=require('../../dist/modules/host/coldMaintenance.service');
 const {PairedRuntimeService}=require('../../dist/modules/host/pairedRuntime.service');
 const {promotionAssignment,bytesSha}=require('../../dist/modules/host/releaseSelection.service');
 const {HostPolicyError}=require('../../dist/modules/host/install');
 for(const scenario of ['success','interrupted','wrong-old-image','empty-image','alias-retargeted','check-only']){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'promotion-native-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  fs.mkdirSync(path.join(directory,'configuration'),{recursive:true});fs.mkdirSync(path.join(directory,'recovery'),{recursive:true});fs.mkdirSync(path.join(directory,'config/gitlab'),{recursive:true});fs.writeFileSync(path.join(directory,'VERSION'),'2.0.0\n');
  fs.writeFileSync(path.join(directory,'config/gitlab/security-release.json'),JSON.stringify({fromVersion:'19.5.3'}));
  const image=n=>'sha256:'+n.repeat(64),selected='gitlab@'+image('2'),release={sourceRevision:'a'.repeat(40),sourceTree:'b'.repeat(40),projectId:4,pipelineId:10,candidateJobId:20,imageId:image('1'),registryRepository:'registry.example.test/system/successor',registryReference:'registry.example.test/system/successor@'+image('7')},
    alias='system-successor:'+release.sourceRevision+'-job20';
  const config={_root:directory,_main:path.join(directory,'configuration/.docker.env'),GITLAB_IMAGE:scenario==='empty-image'?'':selected,GITLAB_HOST:'gitlab.example.test',GITLAB_DOMAIN_MODE:'2',BOOTSTRAPPER_IMAGE:'old:controller'};
  const raw=Buffer.concat([fs.readFileSync(path.resolve(__dirname,'../../config/system/.docker.env.example')).subarray(0,1184),Buffer.from("\nexport BOOTSTRAPPER_IMAGE='old:controller'\nexport GITLAB_IMAGE='"+selected+"'\nexport SECRET='line one\nline two'\n")]);
  fs.writeFileSync(config._main,raw,{mode:0o600});const manifestBytes=Buffer.from('{}\n');fs.writeFileSync(path.join(directory,'recovery/images.json'),manifestBytes,{mode:0o600});
  for(const name of ['release','evidence','token'])fs.writeFileSync(path.join(directory,name),'private',{mode:0o600});
  const row=(Id,service,Image)=>({Id,Image,Config:{Labels:{'com.docker.compose.project':'system','com.docker.compose.service':service}},State:{Running:true,StartedAt:'before'},HostConfig:{RestartPolicy:{Name:'always'}},ExecIDs:[]});
  const rows={system_bootstrapper_1:row('old-controller','bootstrapper',image('0')),system_gitlab_1:row('old-gitlab','gitlab',image(scenario==='wrong-old-image'?'3':'2')),system_web_1:row('web','web',image('4'))},events=[];
  const baseline={configurationFiles:{'configuration/.docker.env':bytesSha(raw)},runnerManagerIdentitySha256:{},expectedRunnerCount:0,hostToolsRevision:release.sourceRevision};
  let held=false,critical=false,finished,tagged=false;
  const imageRow={Id:release.imageId,RepoDigests:[release.registryReference],Config:{Labels:{'org.opencontainers.image.revision':release.sourceRevision,'org.system-bootstrapper.test-job':'20'}}};
  const images={inspect(value){if(value===selected)return {Id:image('2'),RepoDigests:[selected]};if(value===alias){if(scenario==='alias-retargeted')return {...imageRow,Id:image('9')};if(!tagged)throw Error('missing');}return imageRow;}};
  const runDocker=(args)=>{
   if(args[0]==='inspect')return JSON.stringify([Object.values(rows).find(row=>row.Id===args[1])||rows[args[1]]]);
   if(args[0]==='tag'){tagged=true;return '';}
   if(args[0]==='stop') {rows.system_bootstrapper_1.State.Running=false;if(scenario==='interrupted')cancellation.abort();return '';}
   if(args[0]==='compose'){rows.system_bootstrapper_1={...rows.system_bootstrapper_1,Id:'new-controller',Image:release.imageId,State:{Running:true}};return '';}
   return '';
  };
  const host={rootUser:()=>true,environment:{},runner:{run(_binary,args,options){assert(!args.some(value=>value==='private'));return {stdout:runDocker(args.slice(1)),stderr:'',status:0};}},run(_binary,args){events.push(args);return '';}};
  const runtime={settings:async()=>config,services:()=>rows,capture:()=>baseline,assertBaseline(){},routes:async()=>{},sync:async()=>{}};
  const lease={operation:'f'.repeat(32),get critical(){return critical;},set critical(value){critical=value;},acquire(){assert(!held);held=true;events.push('lease');},async command(args,_timeout,_stdin,env){assert(held);events.push(args.slice(2));if(env){assert.equal(env.GITLAB_IMAGE,selected);assert.equal(env.SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER,'1');}return Buffer.from(runDocker(args.slice(2)));},finish(failed){finished={failed,critical};held=false;}};
  const preflight={probe:async()=>({version:'19.5.3',edition:'CE',runningJobs:0,unfinishedBackgroundMigrations:0})},preparation={syncIdle:async()=>{events.push('idle');}},inspection={mounts(){},images(){}},paired=new PairedRuntimeService(host,runtime,inspection,lease,preflight,preparation),cancellation=new AbortController();
  const candidates={pipeline:async()=>{events.push('pipeline');return {verified:true};}},authority={inputs:()=>({release,evidence:{evidence:{gitlabUpgrade:{fromImageId:image('2')}}}})},source={verifyCheckout(){events.push('checkout');}},manifests={load:()=>({}),validateSelected(){}},api={get:async()=>({username:'operator'})};
  const service=new PromotionService(host,runtime,candidates,{connect:()=>api},authority,source,images,manifests,inspection,lease,{}, {},{},new PromotionSequenceService({}),new ColdMaintenanceService({}),paired,preparation);
  const input={signal:cancellation.signal,operation:'promote',checkout:directory,persistenceEnv:path.join(directory,'selector'),checkpoint:path.join(directory,'recovery/controller-promotions/example'),timeout:60,releaseFile:path.join(directory,'release'),evidenceFile:path.join(directory,'evidence'),tokenFile:path.join(directory,'token'),gitlabUrl:'https://gitlab.example.test',checkOnly:scenario==='check-only'};
  if(scenario==='success'){
   const result=await service.execute(input);assert.equal(result.phase,'controller-promoted-old-GitLab-preserved');assert.equal(result.GitLabMigrationStarted,false);assert.deepEqual(finished,{failed:false,critical:true});
   assert(fs.readFileSync(config._main).equals(promotionAssignment(raw,alias)));assert(fs.readFileSync(path.join(directory,'recovery/images.json')).equals(manifestBytes));
   assert.equal(rows.system_gitlab_1.Image,image('2'));assert.equal(result.oldGitLabImagePreserved,true);assert.equal(result.leaseOperation,'f'.repeat(32));
   const record=JSON.parse(fs.readFileSync(path.join(input.checkpoint,'operation.json')));assert.equal(record.newControllerId,'new-controller');assert.equal(events.filter(event=>event==='pipeline').length,2);
  }else if(scenario==='check-only'){
   assert.equal((await service.execute(input)).verified,true);assert.equal(finished,undefined);assert(!fs.existsSync(input.checkpoint));assert(!tagged);
  }else{
   await assert.rejects(service.execute(input),scenario==='interrupted'?/host-operation-interrupted/:scenario==='wrong-old-image'?/old-GitLab-image/:scenario==='empty-image'?/image-selection-required/:/alias-would-be-overwritten/);
   assert(fs.readFileSync(config._main).equals(raw));
   if(scenario==='interrupted'){assert.deepEqual(finished,{failed:true,critical:true});assert.equal(JSON.parse(fs.readFileSync(path.join(input.checkpoint,'operation.json'))).phase,'controller-stop-started');assert(!events.some(event=>Array.isArray(event)&&event[0]==='compose'));}
   else assert.equal(finished,undefined);
  }
 }
});
test('native staged promotion authenticates retained candidate and preserves original recovery declaration',async t=>{
 const {PromotionService}=require('../../dist/modules/host/promotion.service'),{promotionAssignment,bytesSha}=require('../../dist/modules/host/releaseSelection.service');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'staged-native-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const checkpoint=path.join(directory,'recovery/controller-promotions/previous');fs.mkdirSync(checkpoint,{recursive:true});fs.mkdirSync(path.join(directory,'configuration'));
 const image=n=>'sha256:'+n.repeat(64),release={projectId:4,candidateJobId:29,sourceRevision:'a'.repeat(40),sourceTree:'b'.repeat(40),registryRepository:'registry.example.test/system/successor',registryReference:'registry.example.test/system/successor@'+image('7'),imageId:image('1')},target={...release,sourceRevision:'c'.repeat(40)},alias='system-successor:'+release.sourceRevision+'-job29';
 const before=Buffer.concat([fs.readFileSync(path.resolve(__dirname,'../../config/system/.docker.env.example')).subarray(0,1184),Buffer.from("\nexport BOOTSTRAPPER_IMAGE='old:controller'\nexport GITLAB_IMAGE='old:gitlab'\n")]),current=promotionAssignment(before,alias),config={_root:directory,_main:path.join(directory,'configuration/.docker.env'),BOOTSTRAPPER_IMAGE:alias};
 const manifest={sourceCommit:'d'.repeat(40),publicImages:[],localImages:[],currentController:{reference:'original:archive',imageId:image('0')}},manifestBytes=Buffer.from(JSON.stringify(manifest));
 const write=(file,value)=>fs.writeFileSync(file,value,{mode:0o600});write(config._main,current);write(path.join(directory,'recovery/images.json'),manifestBytes);write(path.join(checkpoint,'manifest-before.json'),manifestBytes);write(path.join(checkpoint,'main-before.env'),before);
 const state={release,controllerAlias:alias,configurationBeforeSha256:bytesSha(before),configurationAfterSha256:bytesSha(current),newControllerId:'staged',oldGitLab:{imageId:image('2')},coldMaintenance:true,coldCheckpointSha256:'e'.repeat(64)};
 const labels=service=>({Labels:{'com.docker.compose.project':'system','com.docker.compose.service':service}}),rows={system_bootstrapper_1:{Id:'staged',Image:image('1'),Config:labels('bootstrapper'),State:{Running:true}},system_gitlab_1:{Id:'old-gitlab',Image:image('2'),Config:labels('gitlab')}};
 let verified=0,ancestry=[];const service=new PromotionService({}, {},{completed:async(_api,value)=>{assert.deepEqual(value,state);return {release,evidence:{evidence:{gitlabUpgrade:{fromImageId:image('2')}}}};}},{},{},{verifyObjects(){},verifyAncestry(a,b){ancestry.push([a,b]);}},{inspect:()=>({Id:image('1'),RepoDigests:[release.registryReference],Config:{Labels:{'org.opencontainers.image.revision':release.sourceRevision,'org.system-bootstrapper.test-job':'29'}}})},{validateSelected(view){assert.equal(view.localImages.at(-1).tag,alias);assert.equal(view.currentController.reference,alias);}},{},{},{verify(_checkpoint,hash){assert.equal(hash,state.coldCheckpointSha256);verified++;}});
 const input={checkout:directory,stagedPromotion:checkpoint};write(path.join(checkpoint,'operation.json'),JSON.stringify(state));
 const result=await service.staged(input,config,manifest,rows,{}, {},target);assert.equal(result.receipt.checkpoint,checkpoint);assert.equal(verified,1);assert.deepEqual(ancestry,[[manifest.sourceCommit,release.sourceRevision],[release.sourceRevision,target.sourceRevision]]);assert.deepEqual(manifest.localImages,[]);assert(fs.readFileSync(path.join(directory,'recovery/images.json')).equals(manifestBytes));
 write(config._main,Buffer.concat([current,Buffer.from('# changed\n')]));await assert.rejects(service.staged(input,config,manifest,rows,{}, {},target),/configuration-mismatch/);write(config._main,current);
 write(path.join(directory,'recovery/images.json'),'changed');await assert.rejects(service.staged(input,config,manifest,rows,{}, {},target),/manifest-changed/);write(path.join(directory,'recovery/images.json'),manifestBytes);
 rows.system_gitlab_1.Image=image('3');await assert.rejects(service.staged(input,config,manifest,rows,{}, {},target),/old-GitLab-image-changed/);
});
test('native promotion abort adopts before cleanup, resumes only the exact old generation and retains ambiguous outcomes',async t=>{
 const checkout=fs.mkdtempSync(path.join(os.tmpdir(),'native-abort-checkout-'));t.after(()=>fs.rmSync(checkout,{recursive:true,force:true}));fs.writeFileSync(path.join(checkout,'VERSION'),'2.0.0\n');
 const {PromotionAbortService}=require('../../dist/modules/host/promotionAbort.service'),{bytesSha}=require('../../dist/modules/host/releaseSelection.service');
 const before=Buffer.concat([fs.readFileSync(path.resolve(__dirname,'../../config/system/.docker.env.example')).subarray(0,1184),Buffer.from("\nexport BOOTSTRAPPER_IMAGE='old:controller'\n")]),after=Buffer.concat([before,Buffer.from('# accepted target\n')]),image=n=>'sha256:'+n.repeat(64);
 for(const scenario of ['restored','early','compose-uncertain','readiness-uncertain','live-owner','changed-GitLab','changed-config','changed-checkpoint','foreign-helper','completed']){
  const state={format:'system-controller-promotion-v1',phase:scenario==='completed'?'controller-promoted-old-GitLab-preserved':'controller-start-started',release:{sourceRevision:'a'.repeat(40)},leaseOperation:'f'.repeat(32),configurationBeforeSha256:bytesSha(before),configurationAfterSha256:bytesSha(after),previousController:{imageId:image('0'),restartPolicy:{Name:'on-failure',MaximumRetryCount:3}},oldGitLab:{imageId:image('2')},coldCheckpointSha256:'e'.repeat(64),remoteCommandDeadlineUptime:102,remoteCommandBootId:'current-boot',coldPhase:scenario==='early'?'scheduling-ingress-stop-started':'old-controller-killed-before-cold-checkpoint'};
  const row=(Id,service,Image)=>({Id,Image,Config:{Labels:{'com.docker.compose.project':'system','com.docker.compose.service':service}},HostConfig:{RestartPolicy:{Name:'no'}},State:{Running:false,Paused:false,ExitCode:0,OOMKilled:false},ExecIDs:[]});
  const rows={system_bootstrapper_1:row('controller','bootstrapper',image('1')),system_gitlab_1:row('gitlab','gitlab',image(scenario==='changed-GitLab'?'3':'2')),system_web_1:row('web','web',image('4'))};
  if(scenario==='early'){rows.system_bootstrapper_1.Image=image('0');rows.system_bootstrapper_1.State={Running:true,Paused:true};rows.system_gitlab_1.State.Running=true;rows.system_web_1.State.Running=true;}
  let main=scenario==='changed-config'?Buffer.from('changed').toString('base64'):(scenario==='early'?before:after).toString('base64'),adopted=false,released=false,journal,clock=0;const events=[];
  const port={main:()=>main,checkout:async()=>{events.push('checkout');},inspect:async name=>rows[name]||Object.values(rows).find(row=>row.Id===name),image:async()=>({Id:image('0')}),adopt:async operation=>{events.push('adopt');assert.equal(operation,state.leaseOperation);if(scenario==='live-owner')throw Error('controller-operation-is-still-running');adopted=true;},helper:async()=>{assert(adopted);events.push('helper');return {name:'copy-helper',owner:'owned'};},inspectOptional:async()=>({Id:'helper',Config:{Labels:{'org.system-bootstrapper.controller-copy':scenario==='foreign-helper'?'foreign':'owned'}}}),verifyCheckpoint:async hash=>{assert.equal(hash,state.coldCheckpointSha256);events.push('checkpoint');if(scenario==='changed-checkpoint')throw Error('controller-cold-checkpoint-content-mismatch');},bootId:()=> 'current-boot',uptime:()=>100,now:()=>clock,sleep:async seconds=>{clock+=seconds;events.push(['sleep',seconds]);},runners:async()=>[],writeConfiguration:async value=>{events.push('write');main=value;},reload:async()=>{},services:async()=>rows,mounts:async()=>{},routes:async()=>{if(scenario==='readiness-uncertain')throw Error('route-uncertain');},sync:async()=>{},journal:async value=>{journal=value;events.push('journal');},timestamp:()=> 'completed-time',release:async()=>{released=true;events.push('release');},compose:async()=>{assert(adopted);events.push('compose');if(scenario==='compose-uncertain')throw Error('native-compose-uncertain');rows.system_bootstrapper_1.Image=image('0');},command:async args=>{assert(adopted);events.push(args);if(args[0]==='stop')rows.system_web_1.State.Running=false;}};
  const cold={drain:async()=>{events.push('drain');},quiesce:async()=>{events.push('quiesce');},resume:async input=>{assert.deepEqual(input.controller.HostConfig.RestartPolicy,state.previousController.restartPolicy);events.push('resume');},cleanStop:async()=>{events.push('database-stop');}};
  const service=new PromotionAbortService(port,cold),input={record:state,before:before.toString('base64'),checkout,timeout:1};
  if(['restored','early'].includes(scenario)){
   await service.run(input);assert(released);assert.equal(journal.phase,'aborted');assert.equal(journal.databaseRewound,false);assert.equal(journal.abortedAt,'completed-time');assert(events.indexOf('adopt')<events.indexOf('helper'));assert(events.some(event=>Array.isArray(event)&&event[0]==='sleep'&&event[1]===4));
   if(scenario==='early'){assert(events.includes('resume'));assert(!events.includes('compose'));assert(!events.includes('database-stop'));assert(!events.includes('write'));}
   else {assert.equal(main,input.before);assert(events.includes('compose'));assert(events.some(event=>Array.isArray(event)&&event[1]==='--restart=on-failure:3'));}
  }else{
   await assert.rejects(service.run(input));assert(!released);assert.equal(journal,undefined);
   if(['completed','changed-GitLab','changed-config','live-owner'].includes(scenario)){assert(!events.includes('helper'));assert(!events.some(Array.isArray));}
   if(scenario==='foreign-helper')assert(!events.some(event=>Array.isArray(event)&&event[0]==='rm'));
   if(scenario==='changed-checkpoint')assert(!events.includes('write'));
   if(scenario==='compose-uncertain')assert.equal(main,input.before);
  }
 }
});
