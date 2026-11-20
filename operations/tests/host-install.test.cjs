'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const api=require('../dist/host');
const {nativeProcess}=require('../dist/runtime/process');
const controller='docker.io/example/system@sha256:'+'a'.repeat(64),wizard='docker.io/example/wizard@sha256:'+'b'.repeat(64);
const id=n=>'sha256:'+n.repeat(64);
function fixture(t,monorepo=false) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'host-install-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const checkout=path.join(dir,'checkout'),root=path.join(dir,'live'),selector=path.join(dir,'persistence.env');
 fs.mkdirSync(checkout);fs.mkdirSync(path.join(root,'configuration'),{recursive:true});
 fs.writeFileSync(selector,`PERSISTENCE_MODE=local\nPERSISTENT_DIR='${root}'\n`,{mode:0o600});
 const git=(...args)=>nativeProcess.run('git',['-C',checkout,...args]).stdout.trim();
 git('init','--quiet');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(checkout,'source.txt'),'Reviewed source\n');fs.mkdirSync(path.join(checkout,'wizard'));
 if(monorepo)fs.writeFileSync(path.join(checkout,'wizard/index.ts'),'export {};\n');
 git('add','.');if(!monorepo)git('update-index','--add','--cacheinfo','160000,'+'c'.repeat(40)+',wizard');git('commit','--quiet','-m','Fixture');
 const identity=new api.HostInstallService().source(checkout),calls=[];
 let job=20,failStartup=false;
 const image=(selected)=>{const isWizard=selected===wizard;return {Id:id(isWizard?'e':'d'),Os:'linux',Architecture:'amd64',RepoDigests:[selected.replace('docker.io/','')],Config:{Labels:{'org.opencontainers.image.revision':isWizard&&!monorepo?identity.wizardSourceRevision:identity.sourceCommit,'org.system-bootstrapper.test-job':String(isWizard?job:20),'org.system-bootstrapper.source-revision':identity.sourceCommit}}};};
 const runner={run(binary,args,options={}){calls.push({binary,args,options});let stdout='';
  if(binary==='git')return nativeProcess.run(binary,args,options);
  if(binary==='docker'&&args[1]==='image')stdout=JSON.stringify([image(args.at(-1))]);
  if(failStartup&&args[0]===path.resolve(__dirname,'../dist/cli.js')&&args[1]==='start')throw Error('failure');
  return {stdout,stderr:'',status:0};
 }};
 const guard=()=>api.initializationGuard(path.join(dir,'guard'));
 const service=new api.HostInstallService(runner,{},guard,()=>true);
 const args={controller,wizard,persistenceEnv:selector};
 const metadata={format:'system-accepted-release-v1',version:'1.0.0',tag:'v1.0.0',platform:'linux/amd64',source:{revision:identity.sourceCommit,tree:identity.sourceTree,...(monorepo?{sourceLayout:identity.sourceLayout,wizardSourceTree:identity.wizardSourceTree}:{wizardRevision:identity.wizardSourceRevision})},images:{controller:{reference:controller,imageId:id('d'),configDigest:id('d')},wizard:{reference:wizard,imageId:id('e'),configDigest:id('e')}},acceptance:{candidateJobId:20,controllerWizardSameAttempt:true,requiredChecksPassed:true}};
 return {dir,checkout,root,selector,git,identity,image,calls,service,args,metadata,setJob:v=>job=v,setFail:()=>failStartup=true};
}
test('public digest selectors refuse mutable, private and malformed references',()=>{
 assert.equal(api.reference(controller.replace('docker.io/','')),controller);
 for(const value of ['example/system:latest','registry.example.com/system@'+id('a'),'localhost/system@'+id('a'),controller+'\n',controller+';id',controller.replace('a'.repeat(64),'A'.repeat(64))])assert.throws(()=>api.reference(value),/public-dockerhub/);
});
for(const monorepo of [false,true])test('complete fresh '+(monorepo?'monorepo':'historical')+' installation preserves image selectors and native no-build startup',t=>{
 const f=fixture(t,monorepo),metadata=path.join(f.dir,'release.json');fs.writeFileSync(metadata,JSON.stringify(f.metadata));f.args.releaseMetadata=metadata;
 const result=f.service.install(f.args,f.checkout);
 assert.equal(result.status,'startup-requested');assert.equal(result.productRelease.version,'1.0.0');
 assert.deepEqual(result.sourceCommit,f.identity.sourceCommit);
 assert.equal(fs.readFileSync(path.join(f.root,'configuration/.release-images.env'),'utf8'),'BOOTSTRAPPER_IMAGE='+controller+'\nWIZARD_IMAGE='+wizard+'\n');
 assert.equal(fs.statSync(path.join(f.root,'configuration/.release-images.env')).mode&0o777,0o600);
 const startup=f.calls.filter(c=>c.args[0]===path.resolve(__dirname,'../dist/cli.js')&&c.args[1]==='start');assert.equal(startup.length,1);assert.equal(startup[0].options.env.SYSTEM_BOOTSTRAPPER_SKIP_BUILD,'1');
 assert(!f.calls.some(c=>c.args.includes('build')));assert(!fs.existsSync(path.join(f.root,'configuration/.docker.env')));
 assert.equal(f.calls.find(c=>c.args[0]===path.resolve(__dirname,'../dist/cli.js')&&c.args[1]==='persistence').options.env.PERSISTENCE_CHECK_ONLY,'1');
});
test('image identities reject wrong platform, digest, source, job and monorepo/legacy confusion',t=>{
 const f=fixture(t,true);
 for(const change of [i=>i.Os='windows',i=>i.Architecture='arm64',i=>i.RepoDigests=[controller],i=>i.Config.Labels['org.opencontainers.image.revision']='c'.repeat(40),i=>i.Config.Labels['org.system-bootstrapper.source-revision']='0'.repeat(40),...['',0,'0','9007199254740992'].map(job=>i=>i.Config.Labels['org.system-bootstrapper.test-job']=job)]) {
  const image=f.image(wizard);change(image);assert.throws(()=>api.checkedImage(wizard,f.identity,[image],true));
 }
});
test('source changes and missing Wizard tree are rejected before pulls',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.checkout,'source.txt'),'unreviewed');assert.throws(()=>f.service.install(f.args,f.checkout),/modified/);
 assert(!f.calls.some(c=>c.binary==='docker'));
 f.git('checkout','--','source.txt');f.git('update-index','--force-remove','wizard');f.git('commit','--quiet','-m','No Wizard');assert.throws(()=>f.service.source(f.checkout),/identities/);
});
test('accepted metadata refuses altered source, mixed layouts, image pair, candidate and version',t=>{
 const f=fixture(t,true),filename=path.join(f.dir,'release.json');
 for(const change of [v=>v.source.wizardSourceTree='0'.repeat(40),v=>v.source.wizardRevision='c'.repeat(40),v=>v.images.wizard.reference=controller,v=>v.acceptance.controllerWizardSameAttempt=false,v=>v.version='01.0.0']) {
  const value=structuredClone(f.metadata);change(value);fs.writeFileSync(filename,JSON.stringify(value));assert.throws(()=>api.acceptedMetadata(filename,f.identity,controller,wizard));
 }
});
test('different candidate attempts refuse selectors and startup',t=>{
 const f=fixture(t);f.setJob(21);assert.throws(()=>f.service.install(f.args,f.checkout),/one-accepted-candidate-job/);
 assert(!fs.existsSync(path.join(f.root,'configuration/.release-images.env')));assert(!f.calls.some(c=>c.args[0]===path.resolve(__dirname,'../dist/cli.js')&&c.args[1]==='start'));
});
test('candidate differing from metadata refuses writes, containerd exact manifest identity is supported',t=>{
 const f=fixture(t),filename=path.join(f.dir,'release.json');f.args.releaseMetadata=filename;f.metadata.acceptance.candidateJobId=21;
 fs.writeFileSync(filename,JSON.stringify(f.metadata));assert.throws(()=>f.service.install(f.args,f.checkout),/accepted-public-attempt/);
 assert(!fs.existsSync(path.join(f.root,'configuration/.release-images.env')));
 f.metadata.acceptance.candidateJobId=20;fs.writeFileSync(filename,JSON.stringify(f.metadata));
 f.service.image=(selected)=>({reference:selected,imageId:selected.split('@')[1],candidateJobId:20,platform:'linux/amd64'});
 assert.equal(f.service.install(f.args,f.checkout).images.controller.imageId,id('a'));
});
test('fresh guard refuses saved data, broken links and incomplete operations',t=>{
 const f=fixture(t);
 for(const relative of ['configuration/.docker.env','gitlab/config/gitlab.rb','gitlab/data/database','configuration/.storage-operation-lock','configuration/.gitlab-upgrade-lock','gitlab/data/.system-bootstrapper-restore-incomplete']) {
  const target=path.join(f.root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'retained');assert.throws(()=>api.fresh(f.root,f.checkout));fs.unlinkSync(target);
 }
 fs.symlinkSync(path.join(f.dir,'absent'),path.join(f.root,'configuration/.docker.env'));assert.throws(()=>api.fresh(f.root,f.checkout));
});
test('existing containers and volumes cannot be silently reused',()=>{
 for(const outputs of [['container'],['','','system_configuration']]) {
  const service=new api.HostInstallService({run(){return {stdout:outputs.shift()||'',stderr:'',status:0};}});
  assert.throws(()=>service.noExistingServices(),/fresh-install-existing-system/);
 }
});
test('private outputs refuse symlinks and broad permissions without replacing content',t=>{
 const f=fixture(t),target=path.join(f.root,'configuration/private');fs.symlinkSync(path.join(f.dir,'absent'),target);
 assert.throws(()=>api.writePrivate(target,Buffer.from('new')));fs.unlinkSync(target);fs.writeFileSync(target,'existing',{mode:0o644});
 assert.throws(()=>api.writePrivate(target,Buffer.from('new')));assert.equal(fs.readFileSync(target,'utf8'),'existing');
});
test('failed startup retains selected pair and failure receipt for review',t=>{
 const f=fixture(t);f.setFail();assert.throws(()=>f.service.install(f.args,f.checkout),/command-failed:/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'configuration/.release-images.json'))).status,'startup-failed');
 const release=api.initializationGuard(path.join(f.dir,'guard'));release();
});
test('native initialization flock excludes concurrent owners and releases on close',t=>{
 const f=fixture(t),directory=path.join(f.dir,'guard'),release=api.initializationGuard(directory);
 try{assert.throws(()=>api.initializationGuard(directory),/another-host-initialization/);}finally{release();}
 api.initializationGuard(directory)();
});
test('explicit storage preflight failure cannot create fallback directories',t=>{
 const f=fixture(t);let checked=false;
 f.service.runner.run=(binary,args,options)=>{if(args[0]==='-c')return {stdout:'volume\0/missing\0/missing/platform\0\0',stderr:'',status:0};checked=options.env.PERSISTENCE_CHECK_ONLY==='1';throw Error('missing-volume');};
 assert.throws(()=>f.service.storage(f.selector,f.checkout));assert(checked);assert(!fs.existsSync(path.join(f.root,'.system-bootstrapper-volume')));
});
test('retained monorepo archives bind the original System commit and Wizard tree independently of current host tools',t=>{
 const f=fixture(t,true),directory=path.join(f.dir,'recovery');fs.mkdirSync(path.join(directory,'images'),{recursive:true});
 const archive=path.join(directory,'images/controller.tar.gz');fs.writeFileSync(archive,'retained payload');
 const source={sourceCommit:f.identity.sourceCommit,sourceTree:f.identity.sourceTree,sourceLayout:'system-monorepo-v1',wizardSourceTree:f.identity.wizardSourceTree};
 const manifest={...source,archives:[{...source,file:'images/controller.tar.gz',sha256:api.fileSha(archive),imageId:id('d')}],publicImages:[],localImages:[{tag:'controller:retained',imageId:id('d')}],currentController:{reference:'controller:retained',imageId:id('d'),sourceCommit:source.sourceCommit,sourceTree:source.sourceTree}};
 const filename=path.join(directory,'images.json');fs.writeFileSync(filename,JSON.stringify(manifest));
 fs.writeFileSync(path.join(f.checkout,'source.txt'),'new host tools');f.git('add','.');f.git('commit','--quiet','-m','Newer tools');
 const service=new api.RecoveryManifestService();assert.deepEqual(service.load(directory,f.checkout),manifest);
 for(const change of [m=>m.wizardSourceTree='0'.repeat(40),m=>m.wizardSourceRevision='c'.repeat(40),m=>m.archives[0].wizardSourceTree='c'.repeat(40),m=>m.archives[0].sourceLayout=undefined]) {
  const invalid=structuredClone(manifest);change(invalid);fs.writeFileSync(filename,JSON.stringify(invalid));assert.throws(()=>service.load(directory,f.checkout));
 }
});
test('host source verification distinguishes historical Git objects from current checkout and rejects unrelated ancestry',t=>{
 const f=fixture(t,true),source={sourceRevision:f.identity.sourceCommit,sourceTree:f.identity.sourceTree,sourceLayout:f.identity.sourceLayout,wizardSourceTree:f.identity.wizardSourceTree};
 const service=new api.HostSourceService();service.verifyCheckout(source,f.checkout);
 fs.writeFileSync(path.join(f.checkout,'source.txt'),'newer reviewed tools');assert.throws(()=>service.verifyCheckout(source,f.checkout),/modified/);
 f.git('add','.');f.git('commit','--quiet','-m','Newer tools');service.verifyObjects(source,f.checkout);
 assert.throws(()=>service.verifyCheckout(source,f.checkout),/revision-mismatch/);service.verifyAncestry(source.sourceRevision,f.git('rev-parse','HEAD'),f.checkout);
 f.git('checkout','--orphan','unrelated');f.git('commit','--quiet','-m','Unrelated');assert.throws(()=>service.verifyAncestry(source.sourceRevision,f.git('rev-parse','HEAD'),f.checkout),/not-descendant/);
});
test('reviewed upgrade graph resolves explicit paths and rejects unsafe migration promises',()=>{
 const edge=(from,to)=>({from,to,kind:'controller-wizard',databaseMigration:false,serviceImagesPreserved:true,services:['controller','Wizard'],minimumFreeGiB:8,requiredStage:'public-release-upgrade-'+from.replaceAll('.','-')+'-to-'+to.replaceAll('.','-'),steps:['prerequisites','backup','preflight','apply','verify','recovery']});
 const graph={format:'system-upgrade-paths-v1',versions:['1.0.0','1.1.0','2.0.0'],transitions:[edge('1.0.0','1.1.0'),edge('1.1.0','2.0.0')]};
 assert.equal(api.upgradePath(graph,'missing','2.0.0').status,'unknown');assert.equal(api.upgradePath(graph,'1.0.0','1.0.0').status,'unnecessary');assert.equal(api.upgradePath(graph,'2.0.0','1.0.0').status,'unsupported');assert.equal(api.upgradePath(graph,'1.0.0','2.0.0').transitions.length,2);
 for(const change of [g=>g.transitions[0].databaseMigration=true,g=>g.transitions[0].steps.pop(),g=>g.transitions.push(g.transitions[0]),g=>g.versions.reverse(),g=>g.transitions[0].minimumFreeGiB=7,g=>g.versions.push('02.0.0')]){const invalid=structuredClone(graph);change(invalid);assert.throws(()=>api.validateUpgradeGraph(invalid));}
});
test('storage selectors parse literal quotes without executing configuration',t=>{
 const f=fixture(t);
 const {environmentAssignments}=require('../dist/runtime/environment-assignments');
 assert.deepEqual(environmentAssignments('NGINX_IMAGE=old\nunset NGINX_IMAGE OTHER # defaults\nLAST=value\n'),{NGINX_IMAGE:'',OTHER:'',LAST:'value'});
 for(const invalid of ['unset A; touch /tmp/file', 'unset $(command)', 'unset -- A', 'unset A && command'])assert.throws(()=>environmentAssignments(invalid));
 assert.deepEqual(environmentAssignments("# heading\nexport A='a b'\nB='a'\\''b'\nC=plain # note\nD=\"x\\$y\"\n"),{A:'a b',B:"a'b",C:'plain',D:'x$y'});
 for(const value of ['A=$(id)','A=`id`','A=x;id','A="${HOME}"',"A='unclosed"])
  assert.throws(()=>environmentAssignments(value));
 const result=f.service.storage(f.selector,f.checkout);assert.equal(result.root,f.root);
 assert.equal(f.calls.some(c=>c.binary==='bash'),false);
});
