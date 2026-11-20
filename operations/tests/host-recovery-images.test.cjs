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
