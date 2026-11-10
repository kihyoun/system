'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {run,prepared,sanitizeEvidence,runnerState,invoke}=require('../e2e/gitlab-upgrade');
const release=require('../../gitlab/security-release.json');
function fixture(){const events=[];const candidate={id:'a'.repeat(24),spec:{sourceRevision:'b'.repeat(40),gitlabUpgradeAcceptance:true,restore:{base:'/recovered-data/platform'},images:{gitlab:{id:'sha256:'+'c'.repeat(64)},runner:{id:'sha256:'+'8'.repeat(64)}},supportImages:{previousGitlab:{id:'sha256:'+'d'.repeat(64)},previousRunner:{id:'sha256:'+'7'.repeat(64)},helper:{id:'sha256:'+'6'.repeat(64)},previousHelper:{id:'sha256:'+'5'.repeat(64)}}},evidence:{},stage:async(name,action)=>{events.push(name);return action();},inner:async()=>{},events};const dependencies={recordIdentity:async()=>({private:'fixture-secret'}),invoke:async(_c,action,sha)=>{events.push(action);return action==='migrate'?{status:'promoted',toImage:release.toImage,checkpointSha256:'e'.repeat(64)}:{status:'restored-checkpoint',checkpointSha256:sha};},runnerState:async(_c,promoted)=>({imageId:'sha256:'+(promoted?'8':'7').repeat(64),version:promoted?release.runner.toVersion:release.runner.fromVersion,helperImageId:'sha256:'+(promoted?'6':'5').repeat(64),identity:{1:'fixture'}}),verifyTrust:async()=>events.push('CA-trust'),verifyServiceIdentity:async()=>events.push('identity'),verifyRegistryBlob:async()=>events.push('registry-ci')};return {candidate,dependencies};}
test('real migration adapter preserves old-data oracle, runs registry CI and restores the cold checkpoint',async()=>{const {candidate,dependencies}=fixture();await run(candidate,dependencies);assert(candidate.events.indexOf('migrate')<candidate.events.indexOf('registry-ci'));assert(candidate.events.indexOf('registry-ci')<candidate.events.indexOf('rollback'));assert.equal(candidate.events.filter(e=>e==='identity').length,2);assert.deepEqual(candidate.evidence.gitlabUpgrade,sanitizeEvidence(candidate.evidence.gitlabUpgrade));assert(candidate.evidence.gitlabUpgrade.rollbackVerified);assert(!JSON.stringify(candidate.evidence).includes('fixture-secret'));});
test('failed migration never advertises successful successor or proceeds to registry CI',async()=>{const {candidate,dependencies}=fixture();dependencies.invoke=async()=>{throw Error('migration-failed');};await assert.rejects(()=>run(candidate,dependencies),/migration-failed/);assert.equal(candidate.evidence.gitlabUpgrade,undefined);assert(!candidate.events.includes('registry-ci'));});
test('failed rollback fails acceptance and leaves rollback flag false',async()=>{const {candidate,dependencies}=fixture();const real=dependencies.invoke;dependencies.invoke=(c,a,s)=>a==='rollback'?Promise.reject(Error('restore-failed')):real(c,a,s);await assert.rejects(()=>run(candidate,dependencies),/restore-failed/);assert.equal(candidate.evidence.gitlabUpgrade.rollbackVerified,false);});
test('requires distinct declared baseline/target IDs and restored owned data',()=>{const {candidate}=fixture();assert.equal(prepared(candidate).options.persistentDir,'/recovered-data/platform');candidate.spec.supportImages.previousGitlab=candidate.spec.images.gitlab;assert.throws(()=>prepared(candidate),/distinct/);candidate.spec.restore=undefined;assert.throws(()=>prepared(candidate),/restored/);});
test('recovered reports retain only bounded source-owned migration evidence',()=>{const {candidate}=fixture();assert.equal(sanitizeEvidence({}),undefined);const proof={fromImage:release.fromImage,toImage:release.toImage,fromImageId:'sha256:'+'a'.repeat(64),toImageId:'sha256:'+'b'.repeat(64),checkpointVerified:true,migrationVerified:true,registryVerified:true,rollbackVerified:true,securityTrustVerified:true,private:'never-publish'};assert(!JSON.stringify(sanitizeEvidence(proof)).includes('never-publish'));});

test('runner transition reads actual binary/helper/image/manager identities and rejects mismatches',async()=>{
 const {candidate}=fixture();let badVersion=false,badHelper=false,badIdentity=false;
 candidate.inner=async args=>{
  if(args[0]==='inspect')return JSON.stringify([{Image:candidate.spec.images.runner.id,State:{Running:true}}]);
  if(args[0]==='image')return JSON.stringify([{Id:badHelper?candidate.spec.supportImages.previousHelper.id:candidate.spec.supportImages.helper.id}]);
  if(args.at(-1)==='--version')return 'Version:      '+(badVersion?'19.4.0':release.runner.toVersion);
  if(args.at(-1)==='/etc/gitlab-runner/config.toml')return '[runners.docker]\n helper_image = "candidate-helper:target"\n';
  return JSON.stringify({1:(badIdentity?'b':'a').repeat(64)});
 };
 const proof=await runnerState(candidate,true);assert.equal(proof.version,release.runner.toVersion);
 badVersion=true;await assert.rejects(()=>runnerState(candidate,true),/transition/);badVersion=false;
 badHelper=true;await assert.rejects(()=>runnerState(candidate,true),/transition/);badHelper=false;
 badIdentity=true;await assert.rejects(()=>runnerState(candidate,true,proof),/identity/);
});

test('native migration and rollback calls receive their complete readiness and invocation budgets',async()=>{
  const {candidate}=fixture(),calls=[];
  candidate.spec.images.runner={id:'sha256:'+'8'.repeat(64)};
  candidate.spec.supportImages.previousRunner={id:'sha256:'+'7'.repeat(64)};
  candidate.spec.supportImages.helper={id:'sha256:'+'6'.repeat(64)};
  candidate.spec.supportImages.previousHelper={id:'sha256:'+'5'.repeat(64)};
  candidate.inner=async(args,options)=>{
    const input=JSON.parse(options.input);
    assert.deepEqual(args.slice(0,5),['exec','-i','system_bootstrapper_1','node','-e']);
    assert.equal(input.options.readyTimeoutSeconds,900);
    assert.equal(input.options.sourceRevision,candidate.spec.sourceRevision);
    assert.equal(input.options.persistentDir,candidate.spec.restore.base);
    assert.equal(options.timeout,1200000);
    assert(options.timeout>input.options.readyTimeoutSeconds*1000,
      'the native readiness window needs transport/checkpoint/startup headroom');
    calls.push(input);
    return JSON.stringify({status:input.action==='migrate'?'promoted':'restored-checkpoint'});
  };
  assert.equal((await invoke(candidate,'migrate')).status,'promoted');
  const checkpoint='e'.repeat(64);
  assert.equal((await invoke(candidate,'rollback',checkpoint)).status,'restored-checkpoint');
  assert.deepEqual(calls.map(input=>input.action),['migrate','rollback']);
  assert.equal(calls[1].checkpointSha256,checkpoint);
});

test('platform job retains preparation, independent cleanup and artifact reserve around the candidate deadline',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const ci=fs.readFileSync(path.join(__dirname,'../../.gitlab-ci.yml'),'utf8');
  const job=ci.match(/^test:platform-candidate:\n(?:[ \t]+.*\n|[ \t]*\n)*/m)?.[0];
  assert(job,'the actual platform job must exist');
  const duration=key=>{
    const match=job.match(new RegExp('\\b'+key+': ([1-9][0-9]*)([ms])\\s*$','m'));
    assert(match,'missing finite platform '+key);
    return Number(match[1])*(match[2]==='m'?60000:1000);
  };
  const {Candidate}=require('./disposable-candidate');
  const example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
  const id='sha256:'+'a'.repeat(64),archive=path.resolve('fixture.tar');
  const candidate=new Candidate({example,gitlabUpgradeAcceptance:true,guidedPreviewAcceptance:true,
    daemonImage:'docker:29-dind@'+id,
    images:Object.fromEntries(['candidate','wizard','gitlab','runner','nginx'].map(role=>[role,{id,archive}]))},
    {now:()=>0});
  const script=duration('RUNNER_SCRIPT_TIMEOUT'),cleanup=duration('RUNNER_AFTER_SCRIPT_TIMEOUT'),total=duration('timeout');
  assert.equal(candidate.deadline,75*60000);
  assert.equal(script,80*60000);assert.equal(cleanup,2*60000);assert.equal(total,85*60000);
  assert.equal((ci.match(/RUNNER_SCRIPT_TIMEOUT: 80m/g)||[]).length,1,'the larger script reserve belongs only to the full platform gate');
  assert.equal((ci.match(/timeout: 85m/g)||[]).length,1,'other CI jobs keep their own deadlines');
  assert(script>=candidate.deadline+5*60000,'preparation/publication must fit outside the shared lifecycle');
  assert(total>=script+cleanup+3*60000,'independent cleanup and artifact collection need job time');
  assert.match(job,/after_script:\n\s+- sh tests\/ci-platform\.sh cleanup/);
  assert.match(job,/allow_failure: false/);
});
