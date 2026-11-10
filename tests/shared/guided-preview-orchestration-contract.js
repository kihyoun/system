'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const {scenario}=require('../e2e/candidate');
const {Candidate}=require('./disposable-candidate');
const prepared=require('../e2e/prepare-images');
const image='sha256:'+'a'.repeat(64);
const example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
function spec(){return {example,daemonImage:'docker@'+image,images:Object.fromEntries(['candidate','wizard','gitlab','runner','nginx'].map(role=>[role,{id:image,archive:'/images/'+role+'.tar'}]))};}
test('one original platform runs guided acceptance once and transfers its existing authority into cold recovery',async()=>{
  const events=[],ownership={},candidate={spec:{fullAcceptance:true,guidedPreviewAcceptance:true,recoveryAcceptance:true,acmeRenewalAcceptance:true},
    start:async()=>events.push('start'),smoke:async()=>events.push('smoke'),platform:async()=>events.push('platform')};
  class Authority{constructor(original){assert.equal(original,candidate);events.push('authority-created');}async start(){events.push('authority-started');}}
  await scenario(candidate,()=>'/private/report',ownership,{LocalAcme:Authority,
    prepareGuided:async(current,authority)=>{assert.equal(current,candidate);assert.equal(authority,ownership.acme);events.push('prepare');},
    guided:async current=>{assert.equal(current.url,'https://sync.candidate.test');assert.equal(current.gitlabUrl,'https://gitlab.candidate.test');events.push('guided');},
    recovery:async(current,directory,options)=>{assert.equal(current,candidate);assert.equal(options.acme,ownership.acme);assert.equal(ownership.acmeHandedToRecovery,true);events.push('recovery');}});
  assert.deepEqual(events,['start','smoke','platform','authority-created','authority-started','prepare','guided','recovery']);
});
test('an incomplete guided spec refuses before any Docker or platform action',async()=>{
  for(const key of ['fullAcceptance','recoveryAcceptance','acmeRenewalAcceptance']){
    const candidate={spec:{fullAcceptance:true,guidedPreviewAcceptance:true,recoveryAcceptance:true,acmeRenewalAcceptance:true,[key]:false},start:async()=>assert.fail('started incomplete spec')};
    await assert.rejects(scenario(candidate,()=>'',{}),/complete-owned-platform/);
  }
});
test('preparation failure leaves authority ownership with the caller for bounded cleanup',async()=>{
  const ownership={},candidate={spec:{fullAcceptance:true,guidedPreviewAcceptance:true,recoveryAcceptance:true,acmeRenewalAcceptance:true},start:async()=>{},smoke:async()=>{},platform:async()=>{}};
  class Authority{async start(){}}
  await assert.rejects(scenario(candidate,()=>'',ownership,{LocalAcme:Authority,prepareGuided:async()=>{throw Error('trust-failed');},
    guided:async()=>assert.fail('ran failed setup'),recovery:async()=>assert.fail('ran failed recovery')}),/trust-failed/);
  assert(ownership.acme instanceof Authority);assert.notEqual(ownership.acmeHandedToRecovery,true);
});
test('owned HTTPS preflight uses its real bounded transport budget while ordinary requests stay short',async()=>{
  const inputs=[],calls=[];const candidate=new Candidate({...spec(),guidedPreviewAcceptance:true},{now:()=>0,docker:(args,options)=>{
    calls.push({args,options});if(args.includes('{{json .NetworkSettings.Networks}}'))return JSON.stringify({bridge:{Gateway:'172.17.0.1'}});
    inputs.push(JSON.parse(options.input));return JSON.stringify({status:200,body:'{}'});
  }});candidate.daemon='owned-daemon';
  await candidate.request('https://sync.candidate.test/projects/wizard/preview-setup/preflight',{method:'POST',body:'{}'});
  assert.equal(inputs.at(-1).timeoutMilliseconds,300000);assert.equal(calls.at(-1).options.timeout,310000);
  await candidate.request('https://sync.candidate.test/projects/wizard/preview-setup',{});
  assert.equal(inputs.at(-1).timeoutMilliseconds,10000);assert.equal(calls.at(-1).options.timeout,20000);
  await assert.rejects(async()=>candidate.request('https://unrelated.example.test/preflight',{}),/unowned/);
});
test('terminal guided failures do not consume a readiness timeout and cleanup keeps a separate bounded budget',async()=>{
  let clock=0;const candidate=new Candidate(spec(),{now:()=>clock,sleep:async()=>assert.fail('retried terminal failure'),docker:(_args,options)=>{assert(options.timeout<=180000);return 'ok';}});
  await assert.rejects(candidate.wait(async()=>{throw Object.assign(Error('failed-check'),{noRetry:true});},900000),/failed-check/);
  clock=candidate.deadline+1;candidate.canceled=true;
  assert.equal(await candidate.stage('guided-preview-native-review-stop',()=>candidate.call(['version'])),'ok');
  assert.equal(candidate.cleanupDeadline,undefined);await assert.rejects(candidate.call(['version']),/overall-timeout/);
});
test('full candidate inputs bind actual CI identity and native exact-host Review/Beta settings',()=>{
  const env={CI_PROJECT_ID:'12',CI_PIPELINE_ID:'34',CI_JOB_ID:'56'};
  assert.deepEqual(prepared.ciIdentity(env),{projectId:12,pipelineId:34,candidateJobId:56});
  for(const key of Object.keys(env))assert.throws(()=>prepared.ciIdentity({...env,[key]:'0'}));
  const desired=prepared.guidedSettings('https://github.com/example/wizard.git',env);
  assert(desired.review.enabled&&desired.beta.enabled);assert.equal(desired.wizard.project,'guided-wizard-12-56');
  assert.throws(()=>prepared.guidedSettings('http://private.invalid/wizard.git',env));
});
