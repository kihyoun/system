'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {QuickstartService}=require('../dist/host-bootstrap/quickstart.service');
const {hash,integrity}=require('../dist/release/npm-identity');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'quickstart-native-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source={repository:'https://github.com/example/system.git',revision:'a'.repeat(40),tree:'b'.repeat(40),sourceLayout:'system-monorepo-v1',wizardSourceTree:'c'.repeat(40)};
 const receipt={format:'system-cli-source-v1',name:'@systembootstrapper/cli',version:'2.0.0',sourceRevision:source.revision,sourceTree:source.tree,pipelineId:1,packageJobId:2,filename:'systembootstrapper-cli-2.0.0.tgz',sha256:hash(Buffer.from('x')),integrity:integrity(Buffer.from('x'))};
 const value={format:'system-accepted-release-v1',version:'2.0.0',source,quickstart:{cli:receipt},acceptance:{requiredChecksPassed:true,controllerWizardSameAttempt:true},images:Object.fromEntries(['controller','wizard'].map(role=>[role,{reference:'example/'+role+'@sha256:'+'d'.repeat(64)}]))};
 const manifest=path.join(root,'release.json'),checkout=path.join(root,'checkout'),pkg=path.join(root,'package');
 fs.writeFileSync(manifest,JSON.stringify(value),{mode:0o600});for(const name of ['dist','node_modules','assets']){fs.mkdirSync(path.join(pkg,name),{recursive:true});fs.writeFileSync(path.join(pkg,name,'accepted'),'exact');}
 // Exercise the actual package policy's relative dependencies after placement,
 // rather than accepting a checkout whose entrypoints cannot load their assets.
 fs.mkdirSync(path.join(pkg,'dist/release'),{recursive:true});
 fs.copyFileSync(path.join(__dirname,'../dist/release/lifecycle-policy.js'),path.join(pkg,'dist/release/lifecycle-policy.js'));
 fs.cpSync(path.join(__dirname,'../assets/gitlab'),path.join(pkg,'assets/gitlab'),{recursive:true});
 return {root,source,value,manifest,checkout,pkg};
}
test('accepted source verified before runtime placement and native install, followed by real readiness contract',async t=>{
 const f=fixture(t),calls=[];
 const child={async run(binary,args){calls.push([binary,...args]);if(args.includes('clone'))fs.mkdirSync(path.join(f.checkout,'operations'),{recursive:true});if(args.includes('HEAD^{tree}'))return f.source.tree;if(args.includes('ls-tree'))return `040000 tree ${f.source.wizardSourceTree}\twizard`;if(args.includes('HEAD'))return f.source.revision;return '';}};
 const installer={async install(args,checkout){calls.push(['install']);assert.equal(checkout,f.checkout);assert.equal(args.releaseMetadata,f.manifest);for(const name of ['dist','node_modules','assets'])assert.equal(fs.readFileSync(path.join(checkout,'operations',name,'accepted'),'utf8'),'exact');const policy=require(path.join(checkout,'operations/dist/release/lifecycle-policy.js')).lifecyclePolicy();assert.equal(typeof policy.validateAuthority,'function');assert(policy.stagesV2.includes('system-beta-native-deploy'));}};
 const requests=[];const service=new QuickstartService(child,{async install(){calls.push(['ubuntu']);}},installer,f.pkg,async url=>{requests.push(url);return new Response(url.endsWith('configuration')?'<html>fixture</html>':'',{status:url.endsWith('configuration')?200:401});},{async check(){}});
 await service.install(f.checkout,f.manifest,{});
 assert.equal(calls[0][0],'ubuntu');assert.equal(calls.at(-1)[0],'install');assert.equal(requests.length,2);
 assert(calls.filter(row=>row.includes('clone')||row.includes('checkout')).every(row=>row.includes('core.hooksPath=/dev/null')));
});
test('wrong accepted tree leaves checkout for inspection without placing runtime or starting installation',async t=>{
 const f=fixture(t);let installed=false;
 const child={async run(binary,args){if(args.includes('clone'))fs.mkdirSync(f.checkout);if(args.includes('HEAD'))return f.source.revision;return 'wrong';}};
 const service=new QuickstartService(child,{async install(){}},{async install(){installed=true;}},f.pkg,undefined,{async check(){}});
 await assert.rejects(service.install(f.checkout,f.manifest,{}),/source tree mismatch/);
 assert.equal(installed,false);assert(!fs.existsSync(path.join(f.checkout,'operations')));
});
test('mismatched CLI source refuses all host mutations',async t=>{
 const f=fixture(t);f.value.quickstart.cli.sourceRevision='e'.repeat(40);fs.writeFileSync(f.manifest,JSON.stringify(f.value));let mutated=false;
 const service=new QuickstartService(undefined,{async install(){mutated=true;}});
 await assert.rejects(service.install(f.checkout,f.manifest,{}),/same-source/);assert.equal(mutated,false);
});
test('readiness rejects unauthenticated sync and respects cancellation',async()=>{
 const service=new QuickstartService(undefined,undefined,undefined,undefined,async()=>new Response('<html>',{status:200}));
 await assert.rejects(service.ready(undefined,5),/readiness timed out/);
 const abort=new AbortController();abort.abort(new Error('cancelled'));await assert.rejects(service.ready(abort.signal),/cancelled/);
});

test('public bootstrap verifies accepted artifact before handing off to Nest',async()=>{
 const shell=fs.readFileSync(path.join(__dirname,'../../tools/quickstart/quickstart.sh'),'utf8');
 const source=shell.split("<<'SYSTEM_QUICKSTART_JS'\n")[1].split('\nSYSTEM_QUICKSTART_JS')[0];
 const quick=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const original=global.fetch;
 const artifact=Buffer.from('bundled accepted CLI');
 const tag='v2.0.0',repo='https://github.com/kihyoun/system',base=repo+'/releases/download/'+tag+'/';
 const value={format:'system-accepted-release-v1',tag,version:'2.0.0',platform:'linux/amd64',acceptance:{requiredChecksPassed:true,controllerWizardSameAttempt:true},source:{repository:repo+'.git',sourceLayout:'system-monorepo-v1',revision:'a'.repeat(40),tree:'b'.repeat(40),wizardSourceTree:'c'.repeat(40)}};
 value.quickstart={cli:{format:'system-cli-source-v1',name:'@systembootstrapper/cli',version:value.version,sourceRevision:value.source.revision,sourceTree:value.source.tree,pipelineId:1,packageJobId:2,filename:'systembootstrapper-cli-2.0.0.tgz',sha256:hash(artifact),integrity:integrity(artifact)}};
 const name='system-release-'+tag+'.json';let corrupt=false,redirect=false;
 global.fetch=async url=>{
   const address=String(url),raw=Buffer.from(JSON.stringify(value));
   if(address.includes('/releases/latest'))return Response.json({tag_name:tag,draft:false,prerelease:false,assets:[name,name+'.sha256',value.quickstart.cli.filename].map(name=>({name,browser_download_url:base+name}))});
   if(address===base+name)return new Response(raw);
   if(address===base+name+'.sha256')return new Response(hash(raw)+'  '+name+'\n');
   if(redirect)return new Response(null,{status:302,headers:{location:'https://unapproved.example/cli'}});
   return new Response(corrupt?'tampered':artifact);
 };
 try {
   assert.equal((await quick.metadata()).artifact.toString(),artifact.toString());
   corrupt=true;await assert.rejects(quick.metadata(),/CLI checksum mismatch/);corrupt=false;
   redirect=true;await assert.rejects(quick.metadata(),/Unapproved public download origin/);redirect=false;
   value.quickstart.cli.sourceRevision='e'.repeat(40);await assert.rejects(quick.metadata(),/CLI receipt/);
 }finally{global.fetch=original;}
 assert(!shell.includes('python3'));assert(shell.includes('--offline'));assert(shell.includes('--ignore-scripts'));
 const {spawnSync}=require('node:child_process');
 assert.equal(spawnSync('bash',['-n'],{input:shell}).status,0);
 if(process.getuid?.()===0){const result=spawnSync('bash',[],{input:shell,uid:65534});assert.equal(result.status,1);assert.match(result.stderr.toString(),/sudo\/root/);}
});
