'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
require('../../operations/node_modules/reflect-metadata');
const {NestFactory}=require('../../operations/node_modules/@nestjs/core');
const {GitLabUpgradeModule}=require('../../operations/dist/gitlab-upgrade/gitlab-upgrade.module');
const {GitLabUpgradeService}=require('../../operations/dist/gitlab-upgrade/gitlab-upgrade.service');
const {UpgradeGuardianService}=require('../../operations/dist/gitlab-upgrade/guardian.service');
const {parseContainer,parseCheckpoint,parseOwner,parseChild}=require('../../operations/dist/gitlab-upgrade/types');
const base={sourceRevision:'a'.repeat(40),evidence:'/state/evidence.json',stateDir:'/state',persistentDir:'/operator/platform',checkpointDir:'/state/gitlab-upgrades/test',readyTimeoutSeconds:600};
test('Nest creates independent upgrade sessions and validates options before executing injected commands',async()=>{
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
  session.run=port.run;session.runnerPool('start.sh');
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
