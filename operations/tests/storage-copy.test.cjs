'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {harvest,restore}=require('../dist/storage/copy');
const {ProcessFailure}=require('../dist/runtime/process');
const manifest=require('../dist/storage/manifest');
function fixture(t,{running=false,copyFailure=false,restartFailure=false}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'storage-copy-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const paths=Object.fromEntries(['seed','srv','ssl','certbot'].map(name=>[name,path.join(root,name)]));paths.gitlab='fixture';
  for(const name of Object.values(paths).filter(name=>name!==paths.gitlab))fs.mkdirSync(name);
  fs.mkdirSync(path.join(paths.srv,'gitlab/data'),{recursive:true});
  fs.writeFileSync(path.join(paths.srv,'gitlab/data/database'),'fixture');
  const calls=[];let clock=0;
  const runtime={monotonicSeconds:()=>clock,wait:()=>clock++,log:()=>{},process:{run(binary,args) {
    calls.push([binary,...args]);let stdout='';
    if(binary==='rsync') {
      if(copyFailure)throw new ProcessFailure('rsync',null,'SIGTERM',true);
      const source=args.at(-2),destination=args.at(-1);
      fs.cpSync(source,destination,{recursive:true,filter:file=>!file.endsWith('.system-bootstrapper-certificate-lock')});
    } else if(args[0]==='inspect') {
      if(args[2]==='{{.State.Running}}')stdout=String(running);
      else if(args[2]==='{{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}}')stdout='false 0 false';
      else if(args[2]==='{{.Image}}')stdout='sha256:'+'a'.repeat(64);
      else if(args[2]==='{{.Config.Image}}')stdout='gitlab:fixture';
    } else if(args[0]==='image')stdout='sha256:'+'a'.repeat(64);
    else if(args[0]==='exec'&&args.includes('SVWAIT=90'))stdout='harvest-quiesce-exit:0';
    else if(args[0]==='stop')running=false;
    else if(args[0]==='start'&&restartFailure)throw new ProcessFailure('docker',1,null,false);
    return {stdout,stderr:'',status:0};
  }}};
  return {paths,runtime,calls};
}
test('Harvest publishes verified cold payload and restarts a previously running GitLab',t=>{
  const f=fixture(t,{running:true});harvest(f.paths,f.runtime);
  const source=manifest.current(f.paths.seed);assert.equal(manifest.verify(source).consistency,'gitlab-stopped');
  assert.equal(fs.readFileSync(path.join(source,'srv/gitlab/data/database'),'utf8'),'fixture');
  assert(f.calls.some(call=>call[1]==='start'));assert(!fs.existsSync(path.join(f.paths.seed,'.operation-lock')));
});
test('uncertain copy plus restart failure retains certificate, Seed and stage barriers',t=>{
  const f=fixture(t,{running:true,copyFailure:true,restartFailure:true});
  assert.throws(()=>harvest(f.paths,f.runtime),error=>error.message==='gitlab-restart-failed'&&error.uncertain);
  assert(fs.existsSync(path.join(f.paths.seed,'.operation-lock')));
  assert(fs.existsSync(path.join(f.paths.certbot,'.system-bootstrapper-certificate-lock')));
  assert(fs.readdirSync(f.paths.seed).some(name=>name.startsWith('.harvest-')));
  assert(!fs.existsSync(path.join(f.paths.seed,'current')));
});
test('manifest tampering blocks restore before copying or marking live data',t=>{
  const f=fixture(t);harvest(f.paths,f.runtime);const source=manifest.current(f.paths.seed);
  fs.appendFileSync(path.join(source,'srv/gitlab/data/database'),'changed');f.calls.length=0;
  assert.throws(()=>restore(f.paths,f.runtime),/payload does not match/);
  assert(!f.calls.some(call=>call[0]==='rsync'));
  assert(!fs.existsSync(path.join(f.paths.srv,'gitlab/data/.system-bootstrapper-restore-incomplete')));
});
test('interrupted restore keeps durable incomplete marker and operation barriers',t=>{
  const f=fixture(t);harvest(f.paths,f.runtime);
  const delegate=f.runtime.process.run;f.runtime.process.run=(binary,args)=>{
    if(binary==='rsync')throw new ProcessFailure('rsync',null,'SIGKILL',true);
    return delegate(binary,args);
  };
  assert.throws(()=>restore(f.paths,f.runtime),/external-command-failed/);
  assert(fs.existsSync(path.join(f.paths.srv,'gitlab/data/.system-bootstrapper-restore-incomplete')));
  assert(fs.existsSync(path.join(f.paths.seed,'.operation-lock')));
  assert(fs.existsSync(path.join(f.paths.certbot,'.system-bootstrapper-certificate-lock')));
});
