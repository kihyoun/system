'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {harvest,restore}=require('../dist/storage/copy');
const {ProcessFailure,nativeProcess}=require('../dist/runtime/process');
const manifest=require('../dist/storage/manifest');
function fixture(t,options={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'storage-copy-'));
  const saved={...process.env};t.after(()=>{fs.rmSync(root,{recursive:true,force:true});process.env=saved;});
  const paths=Object.fromEntries(['seed','srv','ssl','certbot'].map(name=>[name,path.join(root,name)]));paths.gitlab='fixture';
  for(const directory of Object.values(paths).filter(name=>name!=='fixture'))fs.mkdirSync(directory);
  fs.mkdirSync(path.join(paths.srv,'gitlab/data'),{recursive:true});
  fs.writeFileSync(path.join(paths.srv,'gitlab/data/database'),'fixture');
  fs.mkdirSync(path.join(paths.certbot,'renewal'));fs.writeFileSync(path.join(paths.certbot,'renewal/example.conf'),'renewal');
  const calls=[],logs=[],settings={running:false,...options};
  const serviceDir=path.join(root,'services'),sv=path.join(root,'sv');
  fs.mkdirSync(serviceDir);
  for(const name of ['postgresql','redis'])fs.symlinkSync(root,path.join(serviceDir,name));
  fs.writeFileSync(sv,'#!'+process.execPath+'\n'+`const fs=require('node:fs');
const settings=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'settings.json'))},'utf8'));
for(const service of process.argv.slice(3)) {
 if(process.argv[2]==='status')console.log(settings.proof===undefined?'down: '+service:settings.proof);
 else fs.appendFileSync(${JSON.stringify(path.join(root,'up-calls'))},service+'\\n');
}
if(settings.proofFailure&&process.argv[2]==='status'||settings.restartFailure&&process.argv[2]==='u')process.exit(1);
`,{mode:0o755});
  const serviceCommand=(args,opts)=>{
    fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify(settings));
    if(settings.proof==='')for(const entry of fs.readdirSync(serviceDir))fs.unlinkSync(path.join(serviceDir,entry));
    const native=args.slice(2).map(arg=>arg==='/opt/gitlab/service'?serviceDir:arg==='/opt/gitlab/embedded/bin/sv'?sv:arg);
    return nativeProcess.run(native[0],native.slice(1),opts).stdout.replaceAll(serviceDir,'/opt/gitlab/service');
  };
  const runtime={monotonicSeconds:()=>0,log:message=>logs.push(message),process:{run(binary,args,opts) {
    calls.push([binary,...args]);let stdout='';
    if(binary==='rsync') {
      if(settings.copyFailure && (settings.copyFailure===true||args.at(-1).includes('/'+settings.copyFailure+'/')))
        throw new ProcessFailure('rsync',settings.uncertainCopy?null:12,settings.uncertainCopy?'SIGTERM':null,!!settings.uncertainCopy);
      return nativeProcess.run(binary,args,opts);
    }
    assert.equal(binary,'docker');assert(!args.includes('/bin/sh')&&!args.includes('bash'));
    if(args[0]==='inspect') {
      if(args[2]==='{{.State.Running}}')stdout=String(settings.running);
      else if(args[2].includes('ExitCode'))stdout=settings.malformedState?'private malformed':`${settings.running} ${settings.exitCode||0} ${!!settings.oom}`;
      else if(args[2]==='{{.Image}}')stdout='sha256:'+'a'.repeat(64);
      else if(args[2]==='{{.Config.Image}}')stdout='gitlab:fixture';
    } else if(args[0]==='ps')stdout='fixture';
    else if(args[0]==='image')stdout=settings.wrongImage?'sha256:wrong':'sha256:'+'a'.repeat(64);
    else if(args.includes('gitlab-ctl')) {
      assert(args.includes('timeout'));assert(Number(args[7])>0&&Number(args[7])<=108);
      if(settings.realTimeout)nativeProcess.run('timeout',['-k','0.1','0.1',process.execPath,'-e','setInterval(()=>{},1000)']);
      if(settings.quiesceFailure)throw new ProcessFailure('docker',settings.quiesceFailure,null,false);
      if(settings.uncertainStop)throw new ProcessFailure('docker',null,'SIGKILL',true);
    } else if(args.includes('status')) {
      stdout=serviceCommand(args,opts);
    } else if(args.includes('u')) {
      stdout=serviceCommand(args,opts);
    } else if(args[0]==='stop')settings.running=false;
    else if(args[0]==='start') {
      if(settings.restartFailure)throw new ProcessFailure('docker',1,null,false);
      settings.running=true;
    }
    return {stdout,stderr:'',status:0};
  }}};
  return {paths,runtime,calls,logs,settings,root,certificate:path.join(paths.certbot,'.system-bootstrapper-certificate-lock'),lock:path.join(paths.seed,'.operation-lock')};
}
test('Harvest publishes verified cold generations with real rsync, ownership, modes and ordered native stop proof',async t=>{
  const f=fixture(t,{running:true});
  fs.mkdirSync(path.join(f.paths.seed,'srv'));fs.writeFileSync(path.join(f.paths.seed,'srv/legacy'),'retain');
  fs.chmodSync(f.paths.ssl,0o711);fs.mkdirSync(path.join(f.paths.ssl,'live'),{mode:0o700});
  fs.writeFileSync(path.join(f.paths.ssl,'live/key'),'private',{mode:0o600});
  nativeProcess.run('mkfifo',[path.join(f.paths.srv,'gitlab/data/pipe')]);
  const socket=require('node:net').createServer();
  await new Promise(resolve=>socket.listen(path.join(f.paths.srv,'gitlab/data/socket'),resolve));
  t.after(()=>socket.close());
  harvest(f.paths,f.runtime);
  const first=manifest.current(f.paths.seed);assert.equal(manifest.verify(first).consistency,'gitlab-stopped');
  assert(!fs.existsSync(path.join(first,'srv/gitlab/data/pipe')));
  assert(!fs.existsSync(path.join(first,'srv/gitlab/data/socket')));
  assert.equal(fs.readFileSync(path.join(first,'letsencrypt/renewal/example.conf'),'utf8'),'renewal');
  assert(f.calls.findIndex(call=>call.includes('gitlab-ctl'))<f.calls.findIndex(call=>call.includes('status')));
  assert(f.calls.findIndex(call=>call.includes('status'))<f.calls.findIndex(call=>call[1]==='stop'));
  fs.writeFileSync(path.join(f.paths.srv,'gitlab/data/database'),'second');harvest(f.paths,f.runtime);
  assert.notEqual(manifest.current(f.paths.seed),first);
  assert.equal(fs.readFileSync(path.join(first,'srv/gitlab/data/database'),'utf8'),'fixture');
  assert.equal(fs.readFileSync(path.join(f.paths.seed,'srv/legacy'),'utf8'),'retain');
  f.settings.running=false;
  for(const directory of [f.paths.srv,f.paths.ssl,f.paths.certbot])fs.rmSync(directory,{recursive:true});
  restore(f.paths,f.runtime);
  assert.equal(fs.readFileSync(path.join(f.paths.srv,'gitlab/data/database'),'utf8'),'second');
  for(const [relative,mode] of [['',0o711],['live',0o700],['live/key',0o600]])assert.equal(fs.statSync(path.join(f.paths.ssl,relative)).mode&0o777,mode);
  assert(!fs.existsSync(f.lock));assert(!fs.existsSync(f.certificate));
});
test('Harvest refuses incomplete data, foreign TLS leases and unclean or unproven stops before copy',t=>{
  for(const options of [{exitCode:1},{exitCode:137},{exitCode:139},{exitCode:143},{oom:true},{malformedState:true},{proof:'run: postgresql'},{proof:''},{proof:'private malformed'},{proof:'down:malformed'},{proofFailure:true}]){
    const f=fixture(t,{running:true,...options});assert.throws(()=>harvest(f.paths,f.runtime));
    assert(!f.calls.some(call=>call[0]==='rsync'));assert(!fs.existsSync(path.join(f.paths.seed,'current')));
    assert(!f.logs.join('\n').includes('private malformed'));assert(f.settings.running);
    if('proof' in options||options.proofFailure)assert(!f.calls.some(call=>call[1]==='stop'));
  }
  for(const options of [{exitCode:137},{exitCode:143},{oom:true}]){
    const f=fixture(t,options);assert.throws(()=>harvest(f.paths,f.runtime));
    assert(!f.calls.some(call=>['exec','start'].includes(call[1])));
  }
  for(const boundary of ['incomplete','certificate','foreign-owner']){
    const f=fixture(t,{running:true});
    if(boundary==='incomplete')fs.writeFileSync(path.join(f.paths.srv,'gitlab/data/.system-bootstrapper-restore-incomplete'),'guard');
    else {fs.mkdirSync(f.certificate);fs.writeFileSync(path.join(f.certificate,'coordinated-owner'),'a'.repeat(48));}
    assert.throws(()=>harvest(f.paths,f.runtime,boundary==='foreign-owner'?'b'.repeat(48):undefined));assert.equal(f.calls.length,0);
  }
  const f=fixture(t,{running:true});fs.mkdirSync(f.certificate);fs.writeFileSync(path.join(f.certificate,'coordinated-owner'),'a'.repeat(48));
  harvest(f.paths,f.runtime,'a'.repeat(48));assert(fs.existsSync(f.certificate));
  assert(!fs.existsSync(path.join(manifest.current(f.paths.seed),'letsencrypt/.system-bootstrapper-certificate-lock')));
});
test('Harvest failure phases preserve the previous Seed and remote completion ownership before recovery',t=>{
  for(const options of [{copyFailure:'srv'},{copyFailure:'ssl'},{copyFailure:'letsencrypt'},{quiesceFailure:7},{realTimeout:true},{quiesceFailure:7,restartFailure:true},{uncertainStop:true},{quiesceFailure:1},{manifestFailure:'create'},{manifestFailure:'publish'}]){
    const f=fixture(t,{running:true});harvest(f.paths,f.runtime);const first=manifest.current(f.paths.seed);f.calls.length=0;
    Object.assign(f.settings,options);const original=manifest[options.manifestFailure];
    if(options.manifestFailure)manifest[options.manifestFailure]=()=>{throw Object.assign(Error('fixture-manifest-failed'),{exitCode:19});};
    try {assert.throws(()=>harvest(f.paths,f.runtime),error=>{
      if(options.quiesceFailure)assert.equal(error.status??error.exitCode,options.quiesceFailure);
      if(options.realTimeout)assert.equal(error.status,124);
      if(options.restartFailure)assert.equal(error.message,'gitlab-restart-failed');
      return true;
    });} finally {if(options.manifestFailure)manifest[options.manifestFailure]=original;}
    assert.equal(manifest.current(f.paths.seed),first);
    const uncertain=!!options.uncertainStop||options.quiesceFailure===1;
    assert.equal(fs.existsSync(f.lock),uncertain);
    assert.equal(fs.existsSync(f.certificate),uncertain);
    if(options.quiesceFailure||options.realTimeout||options.uncertainStop){assert(!f.calls.some(call=>call[1]==='stop'));assert.equal(f.calls.some(call=>call.includes('u')),!uncertain);}
  }
});
test('uncertain copy plus restart failure retains certificate, Seed and stage barriers',t=>{
  const f=fixture(t,{running:true,copyFailure:true,uncertainCopy:true,restartFailure:true});
  assert.throws(()=>harvest(f.paths,f.runtime),error=>error.message==='gitlab-restart-failed'&&error.uncertain);
  assert(fs.existsSync(f.lock));assert(fs.existsSync(f.certificate));
  assert(fs.readdirSync(f.paths.seed).some(name=>name.startsWith('.harvest-')));
  assert(!fs.existsSync(path.join(f.paths.seed,'current')));
});
test('restore refuses absent authority, corruption, live writers and TLS leases before replacing data',t=>{
  const empty=fixture(t);restore(empty.paths,empty.runtime);assert.equal(empty.calls.length,0);
  fs.mkdirSync(path.join(empty.paths.seed,'srv'));assert.throws(()=>restore(empty.paths,empty.runtime),/legacy-seed/);
  for(const boundary of ['corruption','wrong-image','missing-image','running','certificate']){
    const f=fixture(t);harvest(f.paths,f.runtime);const source=manifest.current(f.paths.seed);f.calls.length=0;
    if(boundary==='corruption')fs.appendFileSync(path.join(source,'srv/gitlab/data/database'),'changed');
    if(boundary==='wrong-image')f.settings.wrongImage=true;
    if(boundary==='missing-image')delete process.env.GITLAB_IMAGE;
    if(boundary==='running')f.settings.running=true;
    if(boundary==='certificate')fs.mkdirSync(f.certificate);
    assert.throws(()=>restore(f.paths,f.runtime));assert(!f.calls.some(call=>call[0]==='rsync'));
    assert.equal(fs.readFileSync(path.join(f.paths.srv,'gitlab/data/database'),'utf8'),'fixture');
    assert(!fs.existsSync(path.join(f.paths.srv,'gitlab/data/.system-bootstrapper-restore-incomplete')));
  }
});
test('interrupted restore retains startup guards and permits only settled failure retry',t=>{
  for(const uncertainCopy of [false,true]){
    const f=fixture(t);harvest(f.paths,f.runtime);Object.assign(f.settings,{copyFailure:'ssl',uncertainCopy});
    assert.throws(()=>restore(f.paths,f.runtime),/external-command-failed/);
    const marker=path.join(f.paths.srv,'gitlab/data/.system-bootstrapper-restore-incomplete');assert(fs.existsSync(marker));
    assert.equal(fs.existsSync(f.lock),uncertainCopy);assert.equal(fs.existsSync(f.certificate),uncertainCopy);
    if(!uncertainCopy){f.settings.copyFailure=false;restore(f.paths,f.runtime);assert(!fs.existsSync(marker));}
  }
});
