'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const os=require('os');
const {Candidate,configuration,signature,recover,LABEL}=require('./disposable-candidate');
// Git's committed LF bytes are the signed contract; Windows checkout conversion
// must not lead this fixture to rewrite or relax the Cube validator.
let example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
try {signature(example);} catch {
  example=require('child_process').execFileSync('git',['-c','core.autocrlf=false','show','HEAD:system/.docker.env.example'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'});
}
const hash='a'.repeat(64);
const spec={daemonImage:'docker:29-dind@sha256:'+hash,example,images:Object.fromEntries(
  ['candidate','wizard','gitlab','runner','nginx'].map(name=>[name,{id:'sha256:'+hash,archive:path.resolve(name+'.tar')}]))};
const config=configuration(example,{root:'root-secret',user:'test-user',password:'sync-secret'});
signature(config); assert.equal(config.slice(0,1184),example.slice(0,1184));
assert(config.includes('https://www.system-bootstrapper.com'));
assert.throws(()=>configuration(example.replace('https://www.system-bootstrapper.com','http://www.system-bootstrapper.com'),{}));
assert.throws(()=>new Candidate({...spec,daemonImage:'docker:latest'}));
assert.throws(()=>new Candidate({...spec,images:{}}));

function fixture() {
  const commands=[]; const records=new Map(); let instance; let clock=0; let failRemoval=false; let offline=false;
  const run=(args,options)=>{
    commands.push({args,options});
    if(offline) throw new Error('secret-daemon-message');
    const [kind,verb]=args;
    if(['network','volume'].includes(kind) && verb==='create' || kind==='create') {
      const actualKind=kind==='create'?'container':kind;
      const id=actualKind==='volume'?instance.name: (actualKind==='network'?'b':'c').repeat(64);
      records.set(id,{kind:actualKind,Id:id,Name:actualKind==='container'?'/'+instance.name:instance.name,Labels:{[LABEL]:instance.id}}); return id;
    }
    if(verb==='ls') return [...records.values()].filter(x=>x.kind===kind).map(x=>JSON.stringify(kind==='volume'?{Name:x.Name}:{ID:x.Id.slice(0,12),Name:x.Name,Names:x.Name.replace(/^\//,'')})).join('\n');
    if(verb==='inspect') return JSON.stringify([[...records.values()].find(x=>x.kind===kind && (x.Id===args[2] || x.Name===args[2] || x.Name==='/'+args[2]))]);
    if(verb==='rm') {if(failRemoval) throw new Error('remove failed'); records.delete(args.at(-1));return '';}
    if(kind==='inspect') return JSON.stringify({'80/tcp':[{HostIp:'127.0.0.1',HostPort:'49152'}]});
    if(kind==='exec' && args.includes('inspect') && args.includes('{{.Id}}')) return 'sha256:'+hash;
    return '';
  };
  instance=new Candidate(spec,{docker:run,now:()=>clock,sleep:async ms=>{clock+=ms;},request:async(url,options)=>{
    if(url.endsWith('/login')) {assert.equal(JSON.parse(options.body).password,instance.secrets.password);return {status:200,body:'{"accessToken":"private-token"}'};}
    if(url.endsWith('/config/main')) {assert.equal(options.headers.Authorization,'Bearer private-token');return {status:200,body:JSON.stringify({data:configuration(example,instance.secrets)})};}
    return {status:200,body:'<html>candidate</html>'};
  }});
  return {instance,commands,records,failRemoval:()=>{failRemoval=true;},offline:()=>{offline=true;}};
}
(async()=>{
  const test=fixture(); await test.instance.start(); await test.instance.smoke();
  const creation=test.commands.find(x=>x.args[0]==='create').args;
  assert(creation.includes('--privileged')); assert(creation.includes('127.0.0.1::80'));
  assert(!creation.some(x=>x.includes('docker.sock:') || x.includes('source=/var/run'))); assert(!creation.includes('--network=host'));
  assert(test.commands.find(x=>x.args[0]==='network' && x.args[1]==='create').args.includes('--internal'));
  assert.equal(test.commands.filter(x=>x.args[0]==='cp').length,5);
  assert(test.commands.some(x=>x.args.includes('COMPOSE_COMPATIBILITY=1')));
  assert.equal(test.instance.cleanup(),true); assert.equal(test.records.size,0);
  assert(test.commands.some(x=>x.args[0]==='container' && x.args[1]==='ls' && x.args.includes('--all')));
  assert.equal(test.instance.cleanup(),true); // confirmed absent resources
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-report-'));
  try {
    test.instance.report(output);
    const report=fs.readFileSync(path.join(output,'results.json'),'utf8');
    for(const secret of [...Object.values(test.instance.secrets),'private-token','secret-daemon-message']) assert(!report.includes(secret));
    assert(fs.readFileSync(path.join(output,'junit.xml'),'utf8').includes('authenticated-fetch'));
  } finally {fs.rmSync(output,{recursive:true,force:true});}
  const foreign=fixture(); await foreign.instance.start();
  foreign.records.get(foreign.instance.daemon).Labels[LABEL]='another-run';
  assert.equal(foreign.instance.cleanup(),false); assert.equal(foreign.records.size,3);
  assert.throws(()=>recover({runId:'bad',resources:[]}));
  const recovered=recover({runId:test.instance.id,resources:test.instance.resources,results:[{name:'authenticated-fetch',status:'failed',private:'must-not-copy'}]},()=>{throw new Error('offline');});
  assert.equal(recovered.cleanup(),false);
  assert.deepEqual(recovered.results[0],{name:'authenticated-fetch',status:'failed'});
  const failure=fixture(); await failure.instance.start(); failure.failRemoval(); assert.equal(failure.instance.cleanup(),false);
  const broken=fixture(); await broken.instance.start(); broken.offline(); assert.equal(broken.instance.cleanup(),false);
  const pending=fixture(); await pending.instance.start();
  pending.instance.resources.at(-1).id=null; // server created it, response/receipt ID was interrupted
  assert.equal(pending.instance.cleanup(),true); assert.equal(pending.records.size,0);
  const foreignPending=fixture(); await foreignPending.instance.start();
  foreignPending.instance.resources.at(-1).id=null;
  foreignPending.records.get(foreignPending.instance.daemon).Labels[LABEL]='foreign';
  assert.equal(foreignPending.instance.cleanup(),false); assert.equal(foreignPending.records.size,3);
  const badImage=fixture();
  const base=badImage.instance.exec;
  badImage.instance.exec=(args,options)=>args.includes('{{.Id}}')?'sha256:'+'d'.repeat(64):base(args,options);
  await assert.rejects(()=>badImage.instance.start(),/image-identity-mismatch/);
  assert.equal(badImage.instance.cleanup(),true);
  const denied=fixture(); await denied.instance.start(); denied.instance.spec={...spec,readinessMilliseconds:1000};
  denied.instance.request=async()=>({status:403,body:'private-error'});
  await assert.rejects(()=>denied.instance.smoke(),/readiness-timeout/); assert.equal(denied.instance.cleanup(),true);
  const badFetch=fixture(); await badFetch.instance.start(); const request=badFetch.instance.request;
  badFetch.instance.request=async(url,options)=>url.endsWith('/config/main')?{status:200,body:'{"data":"wrong Cube"}'}:request(url,options);
  await assert.rejects(()=>badFetch.instance.smoke(),/invalid-cube-signature/); assert.equal(badFetch.instance.cleanup(),true);
  const timed=fixture(); await assert.rejects(()=>timed.instance.wait(()=>false,2000),/readiness-timeout/);
  const canceled=fixture(); canceled.instance.canceled=true; await assert.rejects(()=>canceled.instance.start());

  // Actual child exit during a partial write must leave the old receipt intact.
  // process.exit bypasses finally, unlike an ordinary injected JS exception.
  const journal=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-journal-'));
  try {
    test.instance.report(journal);
    const filename=path.join(journal,'results.json');
    const previous=fs.readFileSync(filename,'utf8');
    const child="const fs=require('fs');const {atomicReplace}=require(process.argv[1]);atomicReplace(process.argv[2],'new receipt',{...fs,writeFileSync(fd){fs.writeFileSync(fd,'{');process.exit(23);}});";
    assert.throws(()=>require('child_process').execFileSync(process.execPath,['-e',child,require.resolve('./disposable-candidate'),filename],{stdio:'pipe'}),error=>error.status===23);
    assert.equal(fs.readFileSync(filename,'utf8'),previous);
    assert.equal(JSON.parse(fs.readFileSync(filename,'utf8')).runId,test.instance.id);
    assert(fs.readdirSync(journal).some(name=>name.endsWith('.tmp')));

    // The server has created the daemon but persisting its full ID fails.
    // The previous complete checkpoint still contains its unique pending name.
    const interrupted=fixture(); let failedCheckpoint=false;
    interrupted.instance.checkpoint=instance=>{
      const shouldFail=instance.resources.some(item=>item.kind==='container' && item.id!==null);
      const io=shouldFail ? {...fs,writeFileSync(fd){failedCheckpoint=true;fs.writeFileSync(fd,'{');throw new Error('disk-full');}} : fs;
      instance.report(journal,io);
    };
    await assert.rejects(()=>interrupted.instance.start(),/disk-full/);
    assert(failedCheckpoint); assert.equal(interrupted.records.size,3);
    const receipt=JSON.parse(fs.readFileSync(filename,'utf8'));
    assert.equal(receipt.runId,interrupted.instance.id);
    assert.equal(receipt.resources.at(-1).kind,'container'); assert.equal(receipt.resources.at(-1).id,null);
    const resumed=recover(receipt,interrupted.instance.exec);
    assert.equal(resumed.cleanup(),true); assert.equal(interrupted.records.size,0);
  } finally {fs.rmSync(journal,{recursive:true,force:true});}

  // Linux persistence order includes the entire report-directory ancestry,
  // including existing parents, plus each renamed receipt.
  // Injected IO keeps this deterministic on Windows without filesystem writes.
  const durableRoot=path.resolve(os.tmpdir(),'candidate-virtual-root');
  const firstDirectory=path.join(durableRoot,'new');
  const reportDirectory=path.join(firstDirectory,'e2e','run');
  const events=[]; let nextDescriptor=0;
  const handles=new Map();
  const orderedIo={
    mkdirSync(directory){events.push(['mkdir',directory]);return firstDirectory;},
    openSync(filename,flags){const fd=++nextDescriptor;handles.set(fd,{filename,flags});events.push(['open',filename,flags]);return fd;},
    writeFileSync(fd){events.push(['write',handles.get(fd).filename]);},
    fsyncSync(fd){events.push(['sync',handles.get(fd).filename]);},
    closeSync(fd){events.push(['close',handles.get(fd).filename]);},
    renameSync(from,to){events.push(['rename',from,to]);},
    unlinkSync(){throw Object.assign(new Error('absent'),{code:'ENOENT'});}
  };
  test.instance.report(reportDirectory,orderedIo,'linux');
  const directories=[];
  for(let current=reportDirectory;;current=path.dirname(current)) {
    directories.push(current); if(current===path.dirname(current)) break;
  }
  const expectedFirstFile=1+directories.length*3;
  assert.deepEqual(events.slice(1,expectedFirstFile),directories.flatMap(directory=>[
    ['open',directory,'r'],['sync',directory],['close',directory]
  ]));
  // Explicitly assert each complete atomic replacement, independent of random
  // temporary names: data -> file fsync/close -> rename -> directory fsync/close.
  const firstFile=events.findIndex(event=>event[0]==='open' && event[2]==='wx');
  assert.equal(firstFile,expectedFirstFile);
  for(const offset of [firstFile,firstFile+8]) {
    const filename=events[offset][1];
    const target=events[offset+4][2];
    assert.deepEqual(events.slice(offset,offset+8),[
      ['open',filename,'wx'],['write',filename],['sync',filename],['close',filename],
      ['rename',filename,target],['open',reportDirectory,'r'],['sync',reportDirectory],['close',reportDirectory]
    ]);
  }
  assert.equal(events[firstFile+4][2],path.join(reportDirectory,'results.json'));
  assert.equal(events[firstFile+12][2],path.join(reportDirectory,'junit.xml'));
  const failedSync=fixture(); let dockerActions=0;
  failedSync.instance.exec=()=>{dockerActions++;throw new Error('must-not-create');};
  failedSync.instance.checkpoint=instance=>instance.report(reportDirectory,
    {...orderedIo,fsyncSync(){throw new Error('directory-sync-failed');}},'linux');
  await assert.rejects(()=>failedSync.instance.start(),/directory-sync-failed/);
  assert.equal(dockerActions,0,'An undurable directory checkpoint must precede no Docker creation');
  const failedRenameSync=fixture();
  failedRenameSync.instance.exec=()=>{dockerActions++;throw new Error('must-not-create');};
  failedRenameSync.instance.checkpoint=instance=>instance.report(reportDirectory,
    {...orderedIo,mkdirSync(){return undefined;},fsyncSync(fd){
      if(handles.get(fd).flags==='r' && events.at(-2)?.[0]==='rename') throw new Error('rename-directory-sync-failed');
    }},'linux');
  await assert.rejects(()=>failedRenameSync.instance.start(),/rename-directory-sync-failed/);
  assert.equal(dockerActions,0,'A failed post-rename directory sync must block Docker creation');
  const retryOffset=events.length;
  test.instance.report(reportDirectory,{...orderedIo,mkdirSync(){events.push(['mkdir-existing']);return undefined;}},'linux');
  assert.deepEqual(events.slice(retryOffset+1,retryOffset+expectedFirstFile),directories.flatMap(directory=>[
    ['open',directory,'r'],['sync',directory],['close',directory]
  ]),'Retry must synchronize existing ancestors left by an interrupted directory creation');
  const windowsEvents=[];
  test.instance.report(reportDirectory,{...orderedIo,openSync(filename,flags){
    windowsEvents.push(flags); return orderedIo.openSync(filename,flags);
  }},'win32');
  assert.deepEqual(windowsEvents,['wx','wx'],'Windows must not pretend to fsync directory entries');

  // A macrotask-delivered signal after a successful synchronous copy must be
  // processed BEFORE the following load, not after all five image operations.
  const signaled=fixture(); const transport=signaled.instance.exec;
  const signalHandler=()=>{signaled.instance.canceled=true;};
  process.once('SIGTERM',signalHandler);
  signaled.instance.exec=(args,options)=>{
    const result=transport(args,options);
    if(args[0]==='cp') setImmediate(()=>process.emit('SIGTERM'));
    return result;
  };
  try {
    await assert.rejects(()=>signaled.instance.start(),/canceled-or-overall-timeout/);
    assert.equal(signaled.instance.canceled,true);
    assert.equal(signaled.commands.filter(item=>item.args[0]==='cp').length,1);
    assert.equal(signaled.commands.filter(item=>item.args.includes('load')).length,0);
    assert.equal(signaled.instance.cleanup(),true); assert.equal(signaled.records.size,0);
  } finally {process.removeListener('SIGTERM',signalHandler);}
  console.log('Disposable candidate offline contracts passed; no Docker or live HTTP used.');
})().catch(error=>{console.error(error);process.exitCode=1;});
