'use strict';
require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const {NestFactory}=require('@nestjs/core');
const {StorageModule}=require('../dist/storage/storage.module');
const {StorageService}=require('../dist/storage/storage.service');
const {StorageLease}=require('../dist/storage/lease');
const {importFreshConfiguration}=require('../dist/storage/configuration');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'storage-service-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('Nest service and standalone entry use the same startup barrier and busy exit code',async t=>{
  const root=fixture(t),environment={...process.env,SYSTEM_CONFIG_DIR:root};
  const app=await NestFactory.createApplicationContext(StorageModule.register({normalizePreview:value=>value}),{logger:false});
  try {
    const service=app.get(StorageService),operation=await service.run({action:'startup-begin',ownerPid:process.pid,environment});
    const result=spawnSync(process.execPath,[path.join(__dirname,'../dist/storage/entry.js'),'startup-begin',String(process.pid)],{env:environment,encoding:'utf8'});
    assert.equal(result.status,75,result.stderr);assert.match(result.stderr,/storage-operation-busy/);
    await service.run({action:'startup-finish',environment:{...environment,SYSTEM_STARTUP_OPERATION:operation}});
    assert(!fs.existsSync(path.join(root,'.storage-operation-lock')));
  } finally {await app.close();}
});
test('CLI redacts malformed private input',t=>{
  const result=spawnSync(process.execPath,[path.join(__dirname,'../dist/storage/entry.js'),'validate'],{env:{...process.env,SYSTEM_STORAGE_SPEC:'secret-do-not-print'},encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/seed-operation-failed/);assert(!result.stderr.includes('secret-do-not-print'));
});
test('fresh configuration import retains environment lease and rejects overwrite',t=>{
  const root=fixture(t),state=path.join(root,'state'),zip=path.join(root,'backup.zip');fs.mkdirSync(state);
  const main=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example')).subarray(0,1184).toString()+'\nGITLAB_IMAGE=gitlab:fixture\n';
  execFileSync('python3',['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr(".docker.env",sys.argv[2])\n z.writestr(".projects.env/.example.env","PROJECT_NAME=example\\n")',zip,main]);
  const held=new StorageLease(state,{operation:'restore'});held.acquireEnvironment();const before=fs.statSync(held.environment).ino;
  try {importFreshConfiguration(zip,state);assert.equal(fs.statSync(held.environment).ino,before);
    assert.equal(fs.readFileSync(path.join(state,'.docker.env'),'utf8'),main);
    assert.equal(fs.readFileSync(path.join(state,'.projects.env/.example.env'),'utf8'),'PROJECT_NAME=example\n');
    assert.throws(()=>importFreshConfiguration(zip,state),/restore-configuration-already-exists/);
  } finally {held.release(true);}
});
