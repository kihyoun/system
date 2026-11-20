const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ManagedChildProcess}=require('../dist/runtime/managed-child');
test('managed process passes exact binary file through stdin and refuses links',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'process-input-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'archive'),data=Buffer.from([0,255,254,13,10,128]);
 fs.writeFileSync(input,data);
 const child=new ManagedChildProcess();
 const options={cwd:root,env:process.env,timeout:5000,inputFile:input};
 const result=await child.run(process.execPath,['-e','process.stdout.write(require("node:fs").readFileSync(0).toString("hex"))'],options);
 assert.equal(result,data.toString('hex'));
 fs.symlinkSync(input,path.join(root,'link'));
 await assert.rejects(child.run(process.execPath,['-e','process.exit(0)'],{...options,inputFile:path.join(root,'link')}));
 await assert.rejects(child.run(process.execPath,['-e','process.exit(0)'],{...options,input:'ambiguous'}),/ambiguous-process-input/);
});
