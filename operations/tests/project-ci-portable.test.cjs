const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'../../wizard/.gitlab/runtime/project-ci.cjs');
function isolated(t,args,env={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'portable-project-ci-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const script=path.join(directory,'project-ci.cjs');
  fs.copyFileSync(source,script);
  return spawnSync(process.execPath,[script,...args],{cwd:directory,env:{PATH:path.dirname(process.execPath),...env},encoding:'utf8',timeout:15000});
}
test('portable shared Nest runtime starts without source checkout or installed dependencies',t=>{
 const result=isolated(t,['mirror']);
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/skip/i);
});
test('portable environment boundary rejects mutable helper identity before native execution',t=>{
 const result=isolated(t,['environment','deploy','review'],{SYSTEM_WIZARD_ENVIRONMENT_IMAGE:'latest'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/Immutable/);
 assert.doesNotMatch(result.stderr,/Cannot find module|ENOENT/);
});
test('portable browser boundary requires prepared source artifacts',t=>{
 const result=isolated(t,['browser']);
 assert.equal(result.status,1);
 assert.doesNotMatch(result.stderr,/Cannot find module/);
});
test('portable artifact carries reproducible package notices without checkout paths',()=>{
 const content=fs.readFileSync(source,'utf8');
 assert.doesNotMatch(content,/\/home\/codex\//);
 const licenses=fs.readFileSync(path.join(path.dirname(source),'LICENSES.txt'),'utf8');
 for(const pkg of ['@nestjs/core@12.5.1','@nestjs/common@12.5.1','reflect-metadata@0.2.2','rxjs@7.8.2']) assert(licenses.includes(pkg),pkg);
});
