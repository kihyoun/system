'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {RecoveryImageService,HostInstallService,canonicalDigest}=require('../dist/host');
const id=n=>'sha256:'+n.repeat(64);
function fixture(){
 const manifest={archives:[{file:'images/controller.tar.gz',imageId:id('a')}],localImages:[{tag:'system_bootstrapper',imageId:id('a')},{tag:'controller:retained',imageId:id('a')}],publicImages:[{reference:'nginx:retained@'+id('c'),tag:'nginx:retained',imageId:id('c')}]};
 const calls=[],aliases=new Map(manifest.localImages.map(row=>[row.tag,row.imageId]));let fail=false;
 const runner={run(binary,args,options){calls.push({binary,args,options});if(fail&&args[1]==='load')throw Error('timeout');
  let stdout='';if(args[1]==='image'&&args[2]==='inspect'){const reference=args.at(-1);stdout=JSON.stringify([{Id:aliases.get(reference)||reference,RepoDigests:[]}]);if(reference.startsWith('nginx'))stdout=JSON.stringify([{Id:id('c'),RepoDigests:[canonicalDigest(reference)]}]);}
  return {stdout,stderr:'',status:0};
 }};
 return {manifest,calls,aliases,service:new RecoveryImageService(new HostInstallService(runner)),fail:()=>{fail=true;}};
}
test('archive restore reconstructs exact owned aliases without the private registry',()=>{
 const f=fixture();f.service.restore('/retained',f.manifest);
 assert.deepEqual(new Set(f.calls.filter(c=>c.args[1]==='tag').map(c=>c.args.at(-1))),new Set(['system_bootstrapper','controller:retained','nginx:retained']));
 assert(!f.calls.some(c=>c.args.includes('pull')));assert(f.calls.every(c=>c.binary==='docker'));
 const load=f.calls.find(c=>c.args[1]==='load');assert.equal(load.options.timeout,900000);assert.deepEqual(load.args.slice(-2),['--input','/retained/images/controller.tar.gz']);
 f.aliases.set('controller:retained',id('0'));assert.throws(()=>f.service.restore('/retained',f.manifest),/local-image-alias-mismatch/);
});
test('failed bounded archive load stops before image verification, aliases or subsequent archives',()=>{
 const f=fixture();f.fail();assert.throws(()=>f.service.restore('/retained',f.manifest),/command-failed:docker/);assert.equal(f.calls.length,1);
});
test('recovery transport honors the remaining operation deadline without extending archive limits',()=>{
 let timeout;const host=new HostInstallService({run(binary,args,options){timeout=options.timeout;return {stdout:'',stderr:'',status:0};}}, {},undefined,undefined,Date.now()+1000);
 host.run('docker',['load'],undefined,900000);assert(timeout>0&&timeout<=1000);
 const expired=new HostInstallService({run(){assert.fail('expired operation must not spawn');}}, {},undefined,undefined,Date.now()-1);
 assert.throws(()=>expired.run('docker',['load']),/operation-readiness-deadline-expired/);
});
test('native host command timeout terminates its direct process without exposing command output',()=>{
 const host=new HostInstallService();const started=Date.now();
 assert.throws(()=>host.run(process.execPath,['-e','console.error("private-fixture-output"); setTimeout(()=>{},30000)'],undefined,100),/^Error: command-failed:node$/);
 assert(Date.now()-started<5000);
});

test('native recovery archive publishes complete private bytes and cleans failed exports',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
 const {spawn}=require('node:child_process'),{gunzipSync}=require('node:zlib');
 const {RecoveryArchiveService}=require('../dist/host/recovery-archive.service');
 const {DockerArchiveProcess}=require('../dist/runtime/archive-process');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-native-archive-'));fs.mkdirSync(path.join(directory,'images'));
 const source=['a'.repeat(40),'b'.repeat(40),'c'.repeat(40)], image=id('1');
 const child=script=>spawn(process.execPath,['-e',script],{stdio:['ignore','pipe','ignore']});
 try {
  const service=new RecoveryArchiveService(new DockerArchiveProcess(reference=>{assert.equal(reference,image);return child('process.stdout.write("fixture image bytes")');}));
  const result=await service.save(directory,'controller:accepted',image,source);
  const filename=path.join(directory,result.file),bytes=fs.readFileSync(filename);
  assert.equal(gunzipSync(bytes).toString(),'fixture image bytes');assert.equal(result.bytes,bytes.length);
  assert.equal(result.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(fs.statSync(filename).mode&0o777,0o600);
  const before=fs.readdirSync(path.join(directory,'images'));
  for(const script of ['process.stdout.write("partial");process.exitCode=7','process.stdout.end();process.exitCode=1']){
   const failing=new RecoveryArchiveService(new DockerArchiveProcess(()=>child(script)));
   await assert.rejects(failing.save(directory,'controller:accepted',image,source),/archive-failed/);
   assert.deepEqual(fs.readdirSync(path.join(directory,'images')),before);
  }
  const cancel=new AbortController();let launched;
  const waiting=new RecoveryArchiveService(new DockerArchiveProcess(()=>{launched=child('setInterval(()=>process.stdout.write("chunk"),10)');setTimeout(()=>cancel.abort(),60);return launched;}));
  await assert.rejects(waiting.save(directory,'controller:accepted',image,source,cancel.signal),/archive-failed/);
  assert.equal(launched.signalCode,'SIGKILL');assert.deepEqual(fs.readdirSync(path.join(directory,'images')),before);
  const absent=new RecoveryArchiveService(new DockerArchiveProcess(()=>spawn('/nonexistent-bootstrapper-test-binary',[],{stdio:['ignore','pipe','ignore']})));
  await assert.rejects(absent.save(directory,'controller:accepted',image,source),/archive-failed/);
  assert.deepEqual(fs.readdirSync(path.join(directory,'images')),before);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
