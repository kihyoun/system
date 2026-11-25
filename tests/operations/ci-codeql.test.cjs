const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {CodeqlService}=require('../../dist/modules/ci/codeql.service');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codeql-service-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'source/.hidden'),{recursive:true});
 const source=path.join(root,'source'),reports=path.join(root,'reports');
 fs.writeFileSync(path.join(source,'index.js'),'const value = 1;');
 fs.writeFileSync(path.join(source,'.hidden/worker.ts'),'export const value = 1;');
 fs.writeFileSync(path.join(source,'scan-source.json'),JSON.stringify({files:['index.js','.hidden/worker.ts']}));
 return {source,reports};
}
test('CodeQL service preserves failing evidence and excludes inherited extraction filters',async t=>{
 const f=fixture(t),calls=[];
 const service=new CodeqlService({async run(binary,args,options){
  calls.push({args,env:{...options.env}});
  if(args[0]==='version')return '{"version":"2.27.4"}';
  if(args[1]==='analyze'){
   const locations=['index.js','.hidden/worker.ts'].map(uri=>({physicalLocation:{artifactLocation:{uri}}}));
   const sarif={version:'2.1.0',runs:[{tool:{driver:{name:'CodeQL',semanticVersion:'2.27.4',rules:[{id:'js/example-finding'}]}},invocations:[{executionSuccessful:true,toolExecutionNotifications:['js/baseline/expected-extracted-files','js/diagnostics/successfully-extracted-files'].map(id=>({descriptor:{id},locations}))}],artifacts:[{location:{uri:'index.js'}}],results:[{ruleId:'js/example-finding',message:{text:'Fixture finding'}}]}]};
   fs.writeFileSync(path.join(f.reports,'results.sarif'),JSON.stringify(sarif));
  }
  return '';
 }});
 await assert.rejects(service.scan(f.source,f.reports,{LGTM_INDEX_EXCLUDE:'all'}),/codeql-findings/);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.reports,'gate.json'))),{passed:false,findings:1,expectedFiles:2,extractedFiles:2,committedFiles:2});
 assert.equal(calls[1].env.LGTM_INDEX_INCLUDE,'.\n.hidden');
 assert(!('LGTM_INDEX_EXCLUDE' in calls[1].env));
 assert(calls[2].args.includes('--sarif-add-baseline-file-info'));
});
test('unexpected CodeQL version stops before extraction',async t=>{
 const f=fixture(t),calls=[];
 const service=new CodeqlService({async run(binary,args){calls.push(args);return '{"version":"wrong"}';}});
 await assert.rejects(service.scan(f.source,f.reports,{}),/pinned-codeql-version-required/);
 assert.equal(calls.length,1);
});
