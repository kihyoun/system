const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {SourcePreparationService}=require('../../dist/modules/source-preparation/sourcePreparation.service');
for(const historical of [false,true])test(`source preparation preserves ${historical?'historical gitlink':'shared tree'} Git authority`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-preparation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'wizard'));
 if(historical){fs.mkdirSync(path.join(root,'.git/wizard'));fs.writeFileSync(path.join(root,'wizard/.git'),'gitdir: ../.git/wizard\r\n');}
 const calls=[],snapshot={sourceRevision:'fixture'};const service=new SourcePreparationService({run:()=>assert.fail('packing must use the shared provider')},{pack(directory,git){calls.push({directory,git});return snapshot;}});
 service.prepare(root);assert.equal(calls.length,1);assert.equal(calls[0].directory,root);
 assert.equal(calls[0].git.system,path.join(root,'.git'));
 assert.equal(calls[0].git.wizard,path.join(root,historical?'.git/wizard':'.git'));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'assets/wizard-source/snapshot.json'),'utf8')),snapshot);
});
test('source preparation rejects relative root before invoking a child',()=>{
 const service=new SourcePreparationService({run:()=>assert.fail('unexpected child')});assert.throws(()=>service.prepare('.'),/Absolute/);
});
