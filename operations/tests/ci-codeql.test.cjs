const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {CodeqlService}=require('../dist/ci/codeql.service');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codeql-service-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'source/tests/codeql'),{recursive:true});
 const source=path.join(root,'source'),reports=path.join(root,'reports');
 fs.writeFileSync(path.join(source,'tests/codeql/extractor-includes.js'),"exports.includes=()=>['.','.hidden'];");
 fs.writeFileSync(path.join(source,'tests/codeql/check-sarif.js'),"exports.assess=(sarif)=>({passed:sarif.pass,findings:sarif.pass?0:1});");
 fs.writeFileSync(path.join(source,'scan-source.json'),'{}');
 return {source,reports};
}
test('CodeQL service preserves failing evidence and excludes inherited extraction filters',async t=>{
 const f=fixture(t),calls=[];
 const service=new CodeqlService({async run(binary,args,options){
  calls.push({args,env:{...options.env}});
  if(args[0]==='version')return '{"version":"2.27.4"}';
  if(args[1]==='analyze')fs.writeFileSync(path.join(f.reports,'results.sarif'),'{"pass":false}');
  return '';
 }});
 await assert.rejects(service.scan(f.source,f.reports,{LGTM_INDEX_EXCLUDE:'all'}),/codeql-findings/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.reports,'gate.json'))).passed,false);
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
