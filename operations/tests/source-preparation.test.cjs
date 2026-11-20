const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {SourcePreparationService}=require('../dist/source-preparation/source-preparation.service');
for(const historical of [false,true])test(`source preparation preserves ${historical?'historical gitlink':'shared tree'} Git authority`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-preparation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'wizard'));
 if(historical){fs.mkdirSync(path.join(root,'.git/wizard'));fs.writeFileSync(path.join(root,'wizard/.git'),'gitdir: ../.git/wizard\r\n');}
 const calls=[];const service=new SourcePreparationService({run:(binary,args,options)=>{calls.push({binary,args,options});return {stdout:'',stderr:'',status:0};}});
 service.prepare(root);assert.equal(calls.length,1);assert.equal(calls[0].binary,process.execPath);
 assert.equal(calls[0].options.env.SYSTEM_SOURCE_GIT_DIR,path.join(root,'.git'));
 assert.equal(calls[0].options.env.WIZARD_SOURCE_GIT_DIR,path.join(root,historical?'.git/wizard':'.git'));
 assert.deepEqual(calls[0].args,[path.join(root,'project-bootstrap/wizard-source/package.js')]);
});
test('source preparation rejects relative root before invoking a child',()=>{
 const service=new SourcePreparationService({run:()=>assert.fail('unexpected child')});assert.throws(()=>service.prepare('.'),/Absolute/);
});
