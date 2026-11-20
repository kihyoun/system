'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {prepare}=require('../e2e/shared-source-bundle');
test('shared source bundle retains exact existing Git commit and native wizard tree',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shared-source-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');fs.mkdirSync(path.join(root,'wizard'));fs.writeFileSync(path.join(root,'wizard/source'),'native source');
  git('add','.');git('commit','-m','Fixture');const sha=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}'),wizard=git('rev-parse','HEAD:wizard');
  assert.throws(()=>prepare(root,root,'a'.repeat(40),tree,wizard),/Exact committed/);
  assert.throws(()=>prepare(root,root,sha,tree,'b'.repeat(40)),/Exact committed/);
  const bundle=prepare(root,root,sha,tree,wizard),clone=path.join(root,'received');
  execFileSync('git',['clone','--bare',bundle,clone],{stdio:'pipe'});
  assert.equal(execFileSync('git',['--git-dir',clone,'rev-parse',sha+'^{tree}'],{encoding:'utf8'}).trim(),tree);
  assert.equal(execFileSync('git',['--git-dir',clone,'rev-parse',sha+':wizard'],{encoding:'utf8'}).trim(),wizard);
  assert.equal(fs.statSync(bundle).mode&0o777,0o600);assert.throws(()=>prepare(root,root,sha,tree,wizard),/already exists/);
});
