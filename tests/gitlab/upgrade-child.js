'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {Upgrade,atomic}=require('../../dist/modules/gitlab-upgrade/compatibility');
const {stat,activeGroup,worker}=require('../../dist/modules/gitlab-upgrade/child-process');
const options={sourceRevision:'a'.repeat(40),stateDir:'/state',persistentDir:'/operator/platform',checkpointDir:'/state/gitlab-upgrades/test',evidence:'/state/input.json',readyTimeoutSeconds:600};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(t){const state=fs.mkdtempSync(path.join(os.tmpdir(),'upgrade-child-'));t.after(()=>fs.rmSync(state,{recursive:true,force:true}));const lease=path.join(state,'.gitlab-upgrade-lock');fs.mkdirSync(lease);const owner={format:'system-gitlab-upgrade-lock-v1',operation:'a'.repeat(32)};atomic(path.join(lease,'upgrade-owner.json'),JSON.stringify(owner));const engine=new Upgrade(options);engine.state=state;engine.owner=owner;return {state,lease,engine};}
test('worker refuses a spawn failure even when the child reports status zero',async t=>{
  const previous=process.exitCode;t.after(()=>{process.exitCode=previous;});
  let output='';t.mock.method(process.stdout,'write',bytes=>{output+=bytes;return true;});t.mock.method(process.stderr,'write',bytes=>{output+=bytes;return true;});
  for(const [result,expected]of [[{status:0},0],[{status:23},23],[{status:null,signal:'SIGTERM'},1],
    ...['ENOBUFS','ENOENT','EACCES','ETIMEDOUT','PRIVATE_SECRET_CODE'].map(code=>[{status:0,error:Object.assign(Error('private-command-data'),{code}),stdout:'private-command-data',stderr:'private-command-data'},1])]){
    output='';
    await worker(async()=>({binary:'fixture',args:[]}),()=>result);
    assert.equal(process.exitCode,expected);
    assert(!output.includes('private-command-data')&&!output.includes('PRIVATE_SECRET_CODE'));
    if(expected!==0){const {workerFailureFacts}=require('../../dist/modules/gitlab-upgrade/command-failure-policy');const facts=workerFailureFacts('',output);assert(facts);
      assert.equal(facts.kind,result.error?({ENOBUFS:'output-limit',ENOENT:'spawn-not-found',EACCES:'spawn-permission',ETIMEDOUT:'timeout'}[result.error.code]||'native-error'):result.signal?'signal':'nonzero-exit');}
  }
});
test('process identity uses one stat snapshot even when the process exits before another read',t=>{
  const row='901 (copy ) worker) S 1 456 '+Array(16).fill('0').join(' ')+' 1234 0';let reads=0;
  t.mock.method(fs,'readFileSync',(filename,encoding)=>{assert.equal(filename,'/proc/901/stat');assert.equal(encoding,'utf8');if(++reads>1)throw Object.assign(Error('process exited'),{code:'ESRCH',syscall:'read'});return row;});
  assert.deepEqual(stat(901),{state:'S',group:456,start:'1234'});assert.equal(reads,1);
});
test('process group scan tolerates a process exiting between directory listing and stat read',t=>{
  t.mock.method(fs,'readdirSync',filename=>{assert.equal(filename,'/proc');return ['uptime','901','902'];});
  let missing='ESRCH',state='S';
  t.mock.method(fs,'readFileSync',filename=>{
    if(filename==='/proc/901/stat')throw Object.assign(Error('process exited'),{code:missing,syscall:'read'});
    assert.equal(filename,'/proc/902/stat');return '902 (worker) '+state+' 1 456 '+Array(16).fill('0').join(' ')+' 5678 0';
  });
  for(const code of ['ESRCH','ENOENT']){missing=code;state='S';assert.equal(stat(901),null);assert.equal(activeGroup(456),true);state='Z';assert.equal(activeGroup(456),false);}
});
test('process identity and group scans preserve unexpected stat errors',t=>{
  t.mock.method(fs,'readdirSync',filename=>{assert.equal(filename,'/proc');return ['901'];});
  let failure;t.mock.method(fs,'readFileSync',filename=>{assert.equal(filename,'/proc/901/stat');throw failure;});
  for(const code of ['EACCES','EPERM','EIO','ENOTDIR',undefined]){
    failure=Object.assign(Error('stat unavailable'),{code,syscall:'read'});
    assert.throws(()=>stat(901),error=>error===failure);assert.throws(()=>activeGroup(456),error=>error===failure);
  }
});
test('owned local subprocess timeout kills its complete group and suppresses private command output',t=>{
  const f=fixture(t);assert.throws(()=>f.engine.ownedRun(process.execPath,['-e','process.exit(7)'],{timeout:1000}),error=>error.exitCode===7&&error.message==='upgrade-command-native-nonzero-exit');assert.throws(()=>f.engine.ownedRun(process.execPath,['-e','console.log("never-publish-token");setInterval(()=>{},1000)'],{timeout:100}),error=>error.message==='upgrade-command-native-timeout'&&error.exitCode===124);
  const witness=JSON.parse(fs.readFileSync(path.join(f.lease,'child.json'),'utf8'));assert.equal(witness.phase,'completed');assert.equal(witness.exitCode,124);assert(!activeGroup(witness.group));assert(!JSON.stringify(witness).includes('never-publish-token'));
  for(const [binary,args,kind]of [[path.join(f.state,'private-missing-binary'),['private-argument'],'spawn-not-found'],[process.execPath,['-e','process.stdout.write("never-publish-token".repeat(600000))'],'output-limit']]){
    assert.throws(()=>f.engine.ownedRun(binary,args,{timeout:3000}),error=>{
      assert.equal(error.message,'upgrade-command-native-'+kind);assert.equal(error.failureKind,kind);
      for(const key of ['stdout','stderr','args','argv','env','output','input'])assert(!Object.hasOwn(error,key));
      assert(!JSON.stringify(error).includes('never-publish-token'));assert(!JSON.stringify(error).includes('private-argument'));assert(!JSON.stringify(error).includes('private-missing-binary'));return true;
    });
    const completed=JSON.parse(fs.readFileSync(path.join(f.lease,'child.json'),'utf8'));assert.equal(completed.phase,'completed');assert(!activeGroup(completed.group));
  }
});
test('journaled watchdog finishes local copy work even when the invoking helper is killed',async t=>{
  const f=fixture(t),done=path.join(f.state,'copy-completed');
  const program=function(modulePath,raw,state,done){
    const {Upgrade}=require(modulePath),engine=new Upgrade(JSON.parse(raw));engine.state=state;engine.owner={operation:'a'.repeat(32)};
    const job="setTimeout(()=>require('fs').writeFileSync(process.argv[1],'complete'),600)";
    engine.ownedRun(process.execPath,['-e',job,done],{timeout:3000});
  };
  const parent=spawn(process.execPath,['-e','('+program.toString()+')(...process.argv.slice(1))',require.resolve('../../dist/modules/gitlab-upgrade/compatibility'),JSON.stringify(options),f.state,done],{stdio:'ignore'});
  const exited=new Promise(resolve=>parent.once('exit',resolve));
  let witness;for(let i=0;i<100;i++){try{witness=JSON.parse(fs.readFileSync(path.join(f.lease,'child.json'),'utf8'));if(witness.phase==='running')break;}catch{}await pause(20);}
  assert.equal(witness?.phase,'running');assert(activeGroup(witness.group));parent.kill('SIGKILL');await exited;
  for(let i=0;i<150;i++){try{const record=JSON.parse(fs.readFileSync(path.join(f.lease,'child.json'),'utf8'));if(record.phase==='completed')break;}catch{}await pause(20);}
  assert.equal(fs.readFileSync(done,'utf8'),'complete');assert.equal(JSON.parse(fs.readFileSync(path.join(f.lease,'child.json'),'utf8')).phase,'completed');assert(!activeGroup(witness.group));
});
