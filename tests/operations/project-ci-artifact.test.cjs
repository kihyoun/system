const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {readCliArtifact,validateCliCompanion}=require('../../dist/modules/project-ci/cliArtifact');
const source=require('../../dist/modules/source-preparation/wizardSource.service');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'project-cli-artifact-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('companion checks exact package bytes, source, version and regular npm entry before use',t=>{
 const root=fixture(t),filename=path.join(root,'cli.tgz'),bytes=Buffer.from('fixture package');fs.writeFileSync(filename,bytes);
 const receipt={format:'system-cli-companion-v1',version:'2.0.0',sourceRevision:'a'.repeat(40),sourceTree:'b'.repeat(40),sha256:hash(bytes)};
 const save=()=>fs.writeFileSync(filename+'.json',JSON.stringify(receipt));save();let calls=0;
 const runner={run(binary,args){calls++;assert.equal(binary,'tar');const value=args.at(-1)==='package/package.json'?{name:'@systembootstrapper/cli',version:'2.0.0',bin:{'system-bootstrapper':'dist/cli/main.js'}}:{format:'system-cli-source-v1',version:'2.0.0',sourceRevision:'a'.repeat(40),sourceTree:'b'.repeat(40)};return {status:0,stdout:JSON.stringify(value),stderr:''};}};
 assert.equal(readCliArtifact(filename,filename+'.json',runner).sha256,receipt.sha256);assert.equal(calls,2);
 fs.appendFileSync(filename,'changed');assert.throws(()=>readCliArtifact(filename,filename+'.json',runner),/hash-mismatch/);assert.equal(calls,2);fs.writeFileSync(filename,bytes);
 receipt.sourceRevision='c'.repeat(40);save();assert.throws(()=>readCliArtifact(filename,filename+'.json',runner),/source-mismatch/);
 for(const patch of [{version:'latest'},{sourceRevision:'branch'},{sha256:'unknown'}])assert.throws(()=>validateCliCompanion({...receipt,...patch}),/receipt-invalid/);
 const link=path.join(root,'linked.tgz');fs.symlinkSync(filename,link);assert.throws(()=>readCliArtifact(link,filename+'.json',runner),/path-required/);
});
test('snapshot v3 binds one separate regular CLI package while retaining committed source provenance',t=>{
 const root=fixture(t),git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const write=(name,bytes)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes);};
 git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 for(const [name,content]of Object.entries({'wizard/package.json':'{}','wizard/src/api/Helper.tsx':'public','wizard/.gitlab-ci.yml':'stages: [test]','wizard/.gitlab/producer-v3.json':JSON.stringify({version:3,cliArtifact:source.cliArtifactPath,buildProfile:'node24-vite8-cli-v7'})}))write(name,content);
 for(const relative of require('../../dist/modules/project-ci/cliRecipe').cliRecipeFiles)write('templates/project-bootstrap/wizard-build/cli-v7/'+relative,'committed input '+relative);
 git('add','wizard','templates');git('commit','-m','Committed source');const revision=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
 const pkg=path.join(root,'package-input'),output=path.join(root,'package-output');fs.mkdirSync(output);
 write('package-input/package.json',JSON.stringify({name:'@systembootstrapper/cli',version:'2.0.0',bin:{'system-bootstrapper':'dist/cli/main.js'},files:['dist','assets']}));
 write('package-input/dist/cli/main.js','#!/usr/bin/env node\n');write('package-input/assets/source.json',JSON.stringify({format:'system-cli-source-v1',version:'2.0.0',sourceRevision:revision,sourceTree:tree}));
 const [packed]=JSON.parse(execFileSync('npm',['pack','--offline','--ignore-scripts','--json','--pack-destination',output],{cwd:pkg,encoding:'utf8'}));const filename=path.join(output,packed.filename);
 const receipt={format:'system-cli-companion-v1',version:'2.0.0',sourceRevision:revision,sourceTree:tree,sha256:hash(fs.readFileSync(filename))};fs.writeFileSync(filename+'.json',JSON.stringify(receipt));
 const previous={SYSTEM_CLI_ARTIFACT:process.env.SYSTEM_CLI_ARTIFACT,SYSTEM_CLI_RECEIPT:process.env.SYSTEM_CLI_RECEIPT};process.env.SYSTEM_CLI_ARTIFACT=filename;delete process.env.SYSTEM_CLI_RECEIPT;
 try{
  const snapshot=source.pack(root);assert.equal(snapshot.version,3);assert.equal(snapshot.cliArtifact.sha256,receipt.sha256);
  assert.equal(snapshot.files.filter(file=>file.path===source.cliArtifactPath).length,1);
  for(const relative of require('../../dist/modules/project-ci/cliRecipe').cliRecipeFiles)assert.equal(Buffer.from(snapshot.files.find(file=>file.path==='.gitlab/build-v3/'+relative).content,'base64').toString(),'committed input '+relative);
  assert(!snapshot.files.some(file=>file.path.startsWith('.system-bootstrapper/build-v3/')),'Native producer inputs must not occupy managed recipe paths');
  assert(Buffer.from(snapshot.files.find(file=>file.path===source.cliArtifactPath).content,'base64').equals(fs.readFileSync(filename)));
  assert.deepEqual(source.verifyCommitted(root,snapshot),snapshot);
  write('wizard/src/api/Helper.tsx','dirty source must not be exported');assert.deepEqual(source.verifyCommitted(root,snapshot),snapshot);
  const forged=structuredClone(snapshot);forged.cliArtifact.sourceRevision='f'.repeat(40);assert.throws(()=>source.validate(forged),/source-bound/);
  const invalid=structuredClone(snapshot);invalid.files.find(file=>file.path===source.cliArtifactPath).content=Buffer.from('replacement').toString('base64');assert.throws(()=>source.validate(invalid),/source file/);
  git('add','wizard/src/api/Helper.tsx');git('commit','-m','Changed committed source');assert.throws(()=>source.verifyCommitted(root,snapshot),/differs from the committed System source/);
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('v3 scan omission covers only the exact frozen historical recipe and license',t=>{
 const root=fixture(t),base='templates/project-bootstrap/wizard-build/typed-v6/runtime/',producer='wizard/.gitlab/producer-v3.json';
 const names=[base+'project-ci.cjs',base+'LICENSES.txt',producer],entries=names.map(name=>({name,type:'blob',mode:'100644'}));
 for(const name of names){const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,name===producer?'{}':fs.readFileSync(path.resolve(__dirname,'../..',name)));}
 const {verifiedGeneratedArtifacts}=require('../../dist/modules/ci/generatedArtifactPolicy');
 const result=verifiedGeneratedArtifacts(root,entries);assert.equal(result.length,1);assert.equal(result[0].path,base+'project-ci.cjs');assert.equal(result[0].generator,'immutable node24-vite8-typed-v6 recipe');
 fs.appendFileSync(path.join(root,base+'LICENSES.txt'),'changed');assert.throws(()=>verifiedGeneratedArtifacts(root,entries),/license differs/);
 fs.copyFileSync(path.resolve(__dirname,'../..',base+'LICENSES.txt'),path.join(root,base+'LICENSES.txt'));
 fs.appendFileSync(path.join(root,base+'project-ci.cjs'),'changed');assert.throws(()=>verifiedGeneratedArtifacts(root,entries),/recipe bytes differ/);
});

test('native preview evidence hashes large CLI bytes without widening the normal response budget',async()=>{
 const {PreviewEvidence}=require('../../dist/modules/gitlab-provision/previewEvidence');
 const {cliRepositoryPath,repositoryFileHash,cliFileRoute}=require('../../dist/modules/project-ci/cliFileEvidence');
 const bytes=Buffer.alloc(5*1024*1024,0x81),row={content:bytes.toString('base64')};
 const route='projects/7/repository/files/'+encodeURIComponent(cliRepositoryPath)+'?ref='+'a'.repeat(40);
 assert(cliFileRoute(route));assert(!cliFileRoute(route.replace('a'.repeat(40),'main')));assert(cliFileRoute(route.replace('a'.repeat(40),'main'),false));
 const digest=await new PreviewEvidence({projectIds:[7]},async()=>row).read(route);
 assert.deepEqual(digest,{format:'system-cli-file-digest-v1',sha256:hash(bytes),size:bytes.length});
 assert.equal(repositoryFileHash(cliRepositoryPath,digest),hash(bytes));assert(!JSON.stringify(digest).includes('content'));
 await assert.rejects(new PreviewEvidence({projectIds:[7]},async()=>row).read(route.replace(encodeURIComponent(cliRepositoryPath),encodeURIComponent('.gitlab/other.bin'))),/GitLab request failed/);
 await assert.rejects(new PreviewEvidence({projectIds:[7]},async()=>digest).read(route),/evidence-invalid/);
 assert.throws(()=>repositoryFileHash('.gitlab/other.bin',digest),/evidence-invalid/);
 const {GitlabNativeApiService}=require('../../dist/modules/gitlab-provision/nativeApi.service');let call;
 const api=new GitlabNativeApiService({async run(binary,args,options){call={binary,args,options};return JSON.stringify(row)+'\nBOOTSTRAPPER_HTTP_STATUS:200';}});
 const result=await api.request({checkout:'/fixture',containerId:'a'.repeat(64)},'fixture','GET',route);
 assert.deepEqual(result.value,row);assert.equal(call.args[call.args.indexOf('--max-filesize')+1],String(12*1024*1024));
 assert.equal(call.options.maxBuffer,12*1024*1024+128);
});

test('selected companion installs offline and exposes only the ordinary named CLI',{skip:!process.env.SYSTEM_CLI_ARTIFACT},t=>{
 const {selectedCliArtifact}=require('../../dist/modules/project-ci/cliArtifact');const artifact=selectedCliArtifact();const root=fixture(t),prefix=path.join(root,'installed');
 execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--no-package-lock','--prefix',prefix,process.env.SYSTEM_CLI_ARTIFACT],{env:{PATH:process.env.PATH,HOME:root},timeout:60000,stdio:['ignore','pipe','pipe']});
 const command=path.join(prefix,'node_modules/.bin/system-bootstrapper');
 assert.equal(execFileSync(command,['--version'],{env:{PATH:process.env.PATH,HOME:root},timeout:15000,encoding:'utf8'}).trim(),artifact.version);
 const pkg=path.join(prefix,'node_modules/@systembootstrapper/cli');
 const source=JSON.parse(fs.readFileSync(path.join(pkg,'assets/source.json')));assert.equal(source.sourceRevision,artifact.sourceRevision);assert.equal(source.sourceTree,artifact.sourceTree);
 for(const relative of ['dist/modules/project-ci/portable-entry.js','dist/modules/build/project-ci-bundle.service.js','dist/modules/build/bundle-project-ci-entry.js','assets/cli-companion'])assert(!fs.existsSync(path.join(pkg,relative)),relative);
 const result=execFileSync(command,['project-ci','mirror'],{cwd:root,env:{PATH:process.env.PATH,HOME:root},timeout:15000,encoding:'utf8'});assert.match(result,/skip/i);
});
