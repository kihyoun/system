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
  const host=app.get(HostInstallService);assert.equal(app.get(HOST_PROCESS_RUNNER),runner);assert.equal(app.get(RuntimeInspectionService).host,host);assert.equal(calls,0);
  host.run('git',['--version']);assert.equal(calls,1);
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
});
test('native controller lease preserves critical ownership, excludes contenders and adopts only dead owners',async t=>{
 const {ControllerLeaseService}=require('../dist/host/controller-lease.service');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'controller-lease-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const directory of ['configuration/.projects.env','host/letsencrypt','gitlab/data'])fs.mkdirSync(path.join(root,directory),{recursive:true});
 const service=new ControllerLeaseService();service.acquire({root});
 const operation=service.operation,ownerPath=path.join(root,'configuration/.gitlab-upgrade-lock/controller-owner.json');
 assert.throws(()=>new ControllerLeaseService().adopt({root},operation),/still-running/);
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
