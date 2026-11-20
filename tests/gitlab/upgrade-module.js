'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os');
require('../../operations/node_modules/reflect-metadata');
const {NestFactory}=require('../../operations/node_modules/@nestjs/core');
const {GitLabUpgradeModule}=require('../../operations/dist/gitlab-upgrade/gitlab-upgrade.module');
const {GitLabUpgradeService}=require('../../operations/dist/gitlab-upgrade/gitlab-upgrade.service');
const {UpgradeGuardianService}=require('../../operations/dist/gitlab-upgrade/guardian.service');
const {parseContainer,parseCheckpoint,parseOwner,parseChild}=require('../../operations/dist/gitlab-upgrade/types');
const base={sourceRevision:'a'.repeat(40),evidence:'/state/evidence.json',stateDir:'/state',persistentDir:'/operator/platform',checkpointDir:'/state/gitlab-upgrades/test',readyTimeoutSeconds:600};
test('Nest creates independent upgrade sessions and validates options before executing injected commands',async(t)=>{
 const app=await NestFactory.createApplicationContext(GitLabUpgradeModule,{logger:false,abortOnError:false});
 try{
  let calls=0;const service=app.get(GitLabUpgradeService),dependencies={run:()=>{calls++;return 'fixture';}};
  const first=service.create(base,dependencies),second=service.create(base,dependencies);
  assert.equal(calls,0);assert.notEqual(first,second);assert.notEqual(first.held,second.held);
  first.operation='a'.repeat(32);first.owner={operation:first.operation};first.held.push('/fixture');
  assert.equal(second.owner,undefined);assert.deepEqual(second.held,[]);
  assert.equal(second.docker(['version']),'fixture');assert.equal(calls,1);
  for(const malformed of [null,[],{...base,sourceRevision:10},{...base,checkpointDir:'/state/gitlab-upgrades/../other'},{...base,readyTimeoutSeconds:'600'}])assert.throws(()=>service.create(malformed,dependencies));
  assert.equal(calls,1,'invalid input cannot invoke native work');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'upgrade-sync-idle-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const captured=[],session=service.create(base,{run:(binary,args,options)=>{captured.push({binary,args,options});return JSON.stringify({idle:true});}});
  const auth=path.join(dir,'sync-auth.env'),main=path.join(dir,'.docker.env');
  session.state=dir;session.config=main;
  fs.writeFileSync(auth,"export SYNC_AUTH_TOKEN='private-token'\nSYNC_IP=auth-host\n");
  fs.writeFileSync(main,'export SYNC_IP="configured-host"\n');
  session.syncIdle();
  assert.equal(captured[0].binary,process.execPath);
  assert.deepEqual(captured[0].args,[path.resolve(__dirname,'../../gitlab/upgrade.js'),'sync-status']);
  assert.equal(captured[0].options.env.SYNC_AUTH_TOKEN,'private-token');
  assert.equal(captured[0].options.env.SYNC_IP,'configured-host');
  assert.equal(captured[0].options.timeout,15000);
  assert(!captured[0].args.join(' ').includes('private-token'));
  for(const file of [auth,main]){
   const saved=fs.readFileSync(file,'utf8');
   for(const invalid of ['SYNC_IP=$(touch marker)\n','SYNC_IP=$HOSTNAME\n','SYNC_IP=x; echo injected\n']){
    fs.writeFileSync(file,invalid);assert.throws(()=>session.syncIdle(),/environment-/);
    assert.equal(captured.length,1,'invalid configuration must fail before launching status');
   }
   fs.writeFileSync(file,saved);
  }
  for(const response of [{idle:false},{idle:'true'},{}]){
   session.run=()=>JSON.stringify(response);
   assert.throws(()=>session.syncIdle(),/upgrade-sync-operation-running/);
  }
  fs.unlinkSync(auth);assert.throws(()=>session.syncIdle(),/ENOENT/);
 }finally{await app.close();}
});
test('guardian process port preserves the native watchdog contract and inherited runner/GitLab owner',async()=>{
 const app=await NestFactory.createApplicationContext(GitLabUpgradeModule,{logger:false,abortOnError:false});
 try{
  const calls=[],port={run:(binary,args,options)=>{calls.push({binary,args,options});return 'done';}};
  const guardian=new UpgradeGuardianService(port),session=app.get(GitLabUpgradeService).create(base);
  assert.equal(guardian.ownedRun(session,'fixture',['arg']), 'done');assert.equal(calls[0].binary,'fixture');
  session.owner={operation:'b'.repeat(32)};session.operation=session.owner.operation;
  guardian.ownedRun(session,'fixture',['arg'],{timeout:1000,input:'private-input',env:{TEST:'private'}});
  assert.equal(calls[1].binary,process.execPath);assert.equal(calls[1].args[1],'watchdog');assert.equal(calls[1].options.detached,true);assert.equal(calls[1].options.timeout,6000);
  assert(!calls[1].args.join(' ').includes('private'));assert.equal(JSON.parse(calls[1].options.input).timeout,1000);
  session.run=port.run;session.runnerPool('start');
  assert.equal(calls.at(-1).options.env.SYSTEM_GITLAB_UPGRADE_OPERATION,session.operation);
  assert.equal(calls.at(-1).options.env.SYSTEM_CONFIG_DIR,base.stateDir);
  session.start('fixture',true);
  assert.equal(calls.at(-1).options.env.SYSTEM_GITLAB_UPGRADE_OPERATION,session.operation);
 }finally{await app.close();}
});
test('persisted/transport shape failures stop before domain use',()=>{
 for(const value of [null,[],{State:{Running:'true'}},{Image:1},{Mounts:[null]},{HostConfig:{RestartPolicy:{MaximumRetryCount:'3'}}}])assert.throws(()=>parseContainer(JSON.stringify([value])));
 for(const value of [null,{plan:null},{plan:{},entries:[null]},{plan:{runner:{configurations:[null]}},entries:[]}])assert.throws(()=>parseCheckpoint(JSON.stringify(value)));
 assert.throws(()=>parseOwner({format:'system-gitlab-upgrade-lock-v1',operation:'a'.repeat(32),pid:'1'}));
 assert.throws(()=>parseChild({format:'system-gitlab-upgrade-child-v1',operation:'a'.repeat(32),group:'1'}));
});
test('legacy executable validates CLI usage through the typed entry without opening maintenance',()=>{
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../gitlab/upgrade.js'),'promote'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/GitLab upgrade stopped/);assert(!result.stderr.includes('at '));
});
