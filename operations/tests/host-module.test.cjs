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
