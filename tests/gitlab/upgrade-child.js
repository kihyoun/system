'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {Upgrade,atomic}=require('../../gitlab/upgrade');
const {activeGroup}=require('../../gitlab/upgrade-child');
const options={sourceRevision:'a'.repeat(40),stateDir:'/state',persistentDir:'/operator/platform',checkpointDir:'/state/gitlab-upgrades/test',evidence:'/state/input.json',readyTimeoutSeconds:600};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(t){const state=fs.mkdtempSync(path.join(os.tmpdir(),'upgrade-child-'));t.after(()=>fs.rmSync(state,{recursive:true,force:true}));const lease=path.join(state,'.gitlab-upgrade-lock');fs.mkdirSync(lease);const owner={format:'system-gitlab-upgrade-lock-v1',operation:'a'.repeat(32)};atomic(path.join(lease,'upgrade-owner.json'),JSON.stringify(owner));const engine=new Upgrade(options);engine.state=state;engine.owner=owner;return {state,lease,engine};}
test('owned local subprocess timeout kills its complete group and suppresses private command output',t=>{
  const f=fixture(t);assert.throws(()=>f.engine.ownedRun(process.execPath,['-e','console.log("never-publish-token");setInterval(()=>{},1000)'],{timeout:100}),error=>error.message==='upgrade-operation-failed');
  const witness=JSON.parse(fs.readFileSync(path.join(f.lease,'child.json'),'utf8'));assert.equal(witness.phase,'completed');assert.equal(witness.exitCode,1);assert(!activeGroup(witness.group));assert(!JSON.stringify(witness).includes('never-publish-token'));
});
test('journaled watchdog finishes local copy work even when the invoking helper is killed',async t=>{
  const f=fixture(t),done=path.join(f.state,'copy-completed');
  const program=function(modulePath,raw,state,done){
    const {Upgrade}=require(modulePath),engine=new Upgrade(JSON.parse(raw));engine.state=state;engine.owner={operation:'a'.repeat(32)};
    const job="setTimeout(()=>require('fs').writeFileSync(process.argv[1],'complete'),600)";
    engine.ownedRun(process.execPath,['-e',job,done],{timeout:3000});
  };
  const parent=spawn(process.execPath,['-e','('+program.toString()+')(...process.argv.slice(1))',require.resolve('../../gitlab/upgrade'),JSON.stringify(options),f.state,done],{stdio:'ignore'});
  const exited=new Promise(resolve=>parent.once('exit',resolve));
  let witness;for(let i=0;i<100;i++){try{witness=JSON.parse(fs.readFileSync(path.join(f.lease,'child.json'),'utf8'));if(witness.phase==='running')break;}catch{}await pause(20);}
  assert.equal(witness?.phase,'running');assert(activeGroup(witness.group));parent.kill('SIGKILL');await exited;
  for(let i=0;i<150;i++){try{const record=JSON.parse(fs.readFileSync(path.join(f.lease,'child.json'),'utf8'));if(record.phase==='completed')break;}catch{}await pause(20);}
  assert.equal(fs.readFileSync(done,'utf8'),'complete');assert.equal(JSON.parse(fs.readFileSync(path.join(f.lease,'child.json'),'utf8')).phase,'completed');assert(!activeGroup(witness.group));
});
