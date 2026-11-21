const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {fileLock}=require('../../dist/common/runtime/file-lock');
test('native operation mutex excludes another process until its owner releases descriptor',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'operation-lock-')),file=path.join(dir,'mutex');
 const probe=()=>spawnSync(process.execPath,['-e',`require(${JSON.stringify(require.resolve('../../dist/common/runtime/file-lock'))}).fileLock(process.argv[1])()`,file],{encoding:'utf8'});
 try{const release=fileLock(file);assert.notEqual(probe().status,0);release();assert.equal(probe().status,0);fs.unlinkSync(file);fs.symlinkSync(path.join(dir,'outside'),file);assert.throws(()=>fileLock(file));assert(!fs.existsSync(path.join(dir,'outside')));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
