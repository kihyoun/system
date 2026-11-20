require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {NestFactory}=require('@nestjs/core');
const {HostModule,HOST_PROCESS_RUNNER}=require('../dist/host/host.module');
const {HostInstallService}=require('../dist/host/install');
const {RuntimeInspectionService}=require('../dist/host/runtime-inspection');
test('standalone Host module injects shared native adapter without running operations',async()=>{
 let calls=0;const runner={run(){calls++;return {stdout:'',stderr:'',status:0};}};
 const app=await NestFactory.createApplicationContext(HostModule.register({runner,environment:{CUSTOM:'test'}}),{logger:false});
 try {
  const {PromotionNativePortService}=require('../dist/host/promotion-native-port.service'),{PromotionAbortService}=require('../dist/host/promotion-abort.service'),{ColdMaintenanceService}=require('../dist/host/cold-maintenance.service');
  assert.equal(app.get(PromotionAbortService).port,app.get(PromotionNativePortService));assert.equal(app.get(ColdMaintenanceService).port,app.get(PromotionNativePortService));
  const {GitlabPreflightService}=require('../dist/gitlab-preflight/gitlab-preflight.service');
  assert.equal(app.get(PromotionNativePortService).nativeGitlabProbe,app.get(GitlabPreflightService));
  const {promotionRecoveryArguments}=require('../dist/host/promotion-recovery-entry');
  assert.equal(promotionRecoveryArguments(['--checkpoint-dir','/retained/checkpoint','--persistence-env','/private/storage.env']).timeout,1200);
  assert.throws(()=>promotionRecoveryArguments(['--checkpoint-dir','/retained/checkpoint','--persistence-env','/private/storage.env','--timeout','NaN']),/bounded-promotion/);
  await assert.rejects(app.get(PromotionNativePortService).prepare({checkout:'/source',checkpoint:'/retained/checkpoint',persistenceEnv:'/private/storage.env',timeout:0}),/bounded-promotion/);
  const host=app.get(HostInstallService);assert.equal(app.get(HOST_PROCESS_RUNNER),runner);assert.equal(app.get(RuntimeInspectionService).host,host);assert.equal(calls,0);
  host.run('git',['--version']);assert.equal(calls,1);
  const native=app.get(PromotionNativePortService),original=native.lease.command;let received;
  native.lease.command=async(...args)=>{received=args;return Buffer.from('ok');};
  try {assert.equal(await native.command(['exec','-i','a'.repeat(64),'dd','of=/private/credential'],30,'private-input'),'ok');assert(!received[0].some(arg=>arg.includes('private-input')));assert.equal(received[2].toString(),'private-input');}
  finally {native.lease.command=original;}
 }finally{await app.close();}
});
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {HostStorageService}=require('../dist/host/host-storage.service');
test('host storage preserves operation-owned duration and retains uncertain launchers',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-storage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const selector=path.join(root,'persistence.env');fs.writeFileSync(selector,'',{mode:0o600});
 const calls=[],id='sha256:'+'a'.repeat(64),container='b'.repeat(64);let name,uncertain=false;
 const host={rootUser:()=>true,environment:{DOCKER_CONTEXT:'remote'},storage:()=>({selected:{},root}),run(binary,args){calls.push([binary,args]);if(args.includes('create')){name=args[args.indexOf('--name')+1];return container;}if(args.includes('image'))return id;if(args.includes('inspect'))return JSON.stringify([{Id:container,Image:id,Config:{Labels:{'system.storage.launcher':name}},State:{Status:'exited',Running:false,ExitCode:0}}]);return '';}};
 const attached={async run(binary,args,env){calls.push([binary,args]);assert(!env.DOCKER_CONTEXT);assert(args.includes('--attach'));assert(args.includes('--interactive'));if(uncertain)throw Error('host-storage-launch-outcome-uncertain');}};
 const service=new HostStorageService(host,attached),command={operation:'harvest',image:'accepted:image',checkout:root,persistenceEnv:selector,checkOnly:true};
 await service.execute(command);
 const args=calls.find(([,args])=>args.includes('create'))[1];assert(args.includes('type=bind,src=/,dst=/host,readonly'));assert(args.includes(`SYSTEM_SEED_CONTROLLER_IMAGE=${id}`));assert(args.includes('--check-only'));assert(!calls.some(([binary])=>binary==='bash'));assert(calls.at(-1)[1].includes('rm'));
 calls.length=0;uncertain=true;await assert.rejects(service.execute(command),/outcome-uncertain/);assert(!calls.some(([,args])=>args.includes('rm')));
 await assert.rejects(service.execute({...command,operation:'bad'}),/invalid-host-storage-operation/);
});
test('compatibility storage argument parser preserves environment and selectors',()=>{
 const {storageArguments}=require('../dist/host/storage-entry');
 assert.deepEqual(storageArguments(['restore','--image','accepted','--configuration-backup','/backup.zip','--check-only'],{PERSISTENCE_ENV_FILE:'/private/settings'},'/checkout'),{operation:'restore',image:'accepted',checkout:'/checkout',persistenceEnv:'/private/settings',configurationBackup:'/backup.zip',checkOnly:true});
 assert.throws(()=>storageArguments(['restore','--other'],{},'/checkout'),/arguments/);
 const {spawnSync}=require('node:child_process');
 const invalid=spawnSync(process.execPath,[path.resolve(__dirname,'../../bootstrapper/seed-operation.js'),'restore','--other'],{encoding:'utf8'});
 assert.equal(invalid.status,1);assert.equal(invalid.stdout,'');
 assert.equal(invalid.stderr,'Host storage failed or its outcome is uncertain. Retain the owned launcher and storage lease; inspect operation state before retrying.\n');
});
test('native controller lease preserves critical ownership, excludes contenders and adopts only dead owners',async t=>{
 const {ControllerLeaseService}=require('../dist/host/controller-lease.service');
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
 const coordinator=spawn(process.execPath,['-e',`const {ControllerLeaseService}=require(${JSON.stringify(require.resolve('../dist/host/controller-lease.service'))});const lease=new ControllerLeaseService();lease.acquire({root:process.argv[1]});lease.critical=true;lease.command([process.execPath,'-e','setTimeout(()=>{},1200)']).catch(()=>{});`,root],{stdio:'ignore'});
 t.after(()=>{try{coordinator.kill('SIGKILL')}catch{}});
 const journal=path.join(root,'configuration/.gitlab-upgrade-lock/host-child.json');
 const until=Date.now()+5000;
 while((!fs.existsSync(journal)||JSON.parse(fs.readFileSync(journal)).phase!=='running')&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(JSON.parse(fs.readFileSync(journal)).phase,'running');
 const orphanOperation=JSON.parse(fs.readFileSync(ownerPath)).operation;
 const ended=new Promise(resolve=>coordinator.once('exit',resolve));coordinator.kill('SIGKILL');await ended;
 assert.throws(()=>new ControllerLeaseService().adopt({root},orphanOperation),/still-running/);
 while(JSON.parse(fs.readFileSync(journal)).phase!=='completed'&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
 // Completion is published before the guardian finally closes its inherited flock.
 let orphan;
 while(Date.now()<until){try{orphan=new ControllerLeaseService();orphan.adopt({root},orphanOperation);break;}catch(error){assert.match(error.message,/still-running/);await new Promise(resolve=>setTimeout(resolve,20));}}
 assert(orphan?.guardFd>=0);orphan.release();

});
test('cold maintenance shares awaited native sequencing, bounded drain and fail-closed recovery',async()=>{
 const {ColdMaintenanceService,ActiveMaintenanceJobs}=require('../dist/host/cold-maintenance.service');
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
 const {ControllerCheckpointService}=require('../dist/host/controller-checkpoint.service');
 const {PromotionRecoveryService}=require('../dist/host/promotion-recovery.service');
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
 const {RecoveryPublicationService}=require('../dist/host/recovery-publication.service');
 const security=require('../../gitlab/security-release.json'), service=new RecoveryPublicationService();
 const old={archives:[{file:'images/old.tar.gz',imageId:'sha256:'+'1'.repeat(64)}],localImages:[{tag:'system_bootstrapper',imageId:'sha256:'+'1'.repeat(64)}],publicImages:[{reference:security.fromImage,tag:security.fromImage.split('@')[0]},{reference:security.runner.fromImage,tag:security.runner.fromImage.split('@')[0]}],currentController:{reference:'controller:old',imageId:'sha256:'+'1'.repeat(64)}};
 const before=structuredClone(old),archive={file:'images/new.tar.gz',imageId:'sha256:'+'2'.repeat(64)};
 const refresh=previous=>service.refresh(previous,archive,['a'.repeat(40),'b'.repeat(40),'c'.repeat(40)],'controller:new',archive.imageId,security.toImage,'sha256:'+'3'.repeat(64),'wizard:retained',security.runner.toImage,'sha256:'+'4'.repeat(64));
 const value=refresh(old);
 assert.deepEqual(old,before);assert.deepEqual(value.archives[0],before.archives[0]);assert.deepEqual(value.controllerHistory,[before.currentController]);
 assert.deepEqual(new Set(value.publicImages.map(row=>row.reference)),new Set([security.toImage,security.runner.toImage]));
 assert.equal(value.publicImages[1].imageId,'sha256:'+'4'.repeat(64));
 assert.throws(()=>refresh({...old,publicImages:old.publicImages.slice(0,1)}),/Runner-public-image-declaration/);
});
