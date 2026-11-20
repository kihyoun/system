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
test('host storage launches pinned accepted image with readonly host selectors',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-storage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const selector=path.join(root,'persistence.env');fs.writeFileSync(selector,'',{mode:0o600});
 const calls=[],id='sha256:'+'a'.repeat(64);
 const host={rootUser:()=>true,environment:{},storage:()=>({selected:{},root}),run(binary,args){calls.push([binary,args]);return args.includes('inspect')?id:'started';}};
 const service=new HostStorageService(host);
 assert.equal(service.execute({operation:'harvest',image:'accepted:image',checkout:root,persistenceEnv:selector,checkOnly:true}),'started');
 const args=calls.at(-1)[1];assert(args.includes('type=bind,src=/,dst=/host,readonly'));assert(args.includes(`SYSTEM_SEED_CONTROLLER_IMAGE=${id}`));assert(args.includes('--check-only'));assert(!calls.some(([binary])=>binary==='bash'));
 assert.throws(()=>service.execute({operation:'bad',image:'accepted:image',checkout:root,persistenceEnv:selector}),/invalid-host-storage-operation/);
});
