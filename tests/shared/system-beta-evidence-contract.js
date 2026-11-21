'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const evidence=require('../../dist/modules/release/guided-preview-evidence');
const legacy=require('./guided-preview-fixture');
const {proof,results}=require('./system-beta-evidence-fixture');
test('v2 retains explicit fixture authorization boundary and native lifecycle facts',()=>{
  assert.deepEqual(evidence.validate(proof(),results),proof());
});
test('v1 historical evidence remains readable and unknown versions fail closed',()=>{
  assert.deepEqual(evidence.validate(legacy.proof(),legacy.stages.map(name=>({name,status:'passed'}))),legacy.proof());
  assert.throws(()=>evidence.validate({...proof(),version:3},results));assert.equal(evidence.sanitize({version:3}),undefined);
});
test('missing or forged v2 facts never become completed native pipeline evidence',()=>{
  const mutations=[p=>delete p.fixtureNamespace,p=>p.candidate.pipelineEvidence='native',p=>p.verifier.mode='native',p=>p.verifier.negativeGatesPassed=false,
    p=>p.setup.noBuildStarted=false,p=>p.setup.reviewEnabled=true,p=>p.setup.sourceCommit='0'.repeat(40),p=>p.beta.tlsVerified=false,
    p=>p.beta.imageOwnershipVerified=false,p=>p.beta.helperRemoved=false,p=>p.beta.leaseReleased=false,p=>p.beta.networkRemoved=false,
    p=>p.beta.stoppedThroughPipelineId=99,p=>p.beta.stopped.jobId=999,p=>p.beta.fixtureStopJobId=p.beta.fixtureDeployJobId,
    p=>p.beta.deployment.imageDigest='sha256:'+'0'.repeat(64),p=>p.temporaryCredentialRevoked=false,p=>p.credentialCleanupUncertain=true,
    p=>p.productionRetained.runningImage='sha256:'+'0'.repeat(64)];
  for(const mutate of mutations){const p=proof();mutate(p);assert.throws(()=>evidence.validate(p,results));}
  for(const stage of results)assert.throws(()=>evidence.validate(proof(),results.filter(row=>row!==stage)));
});
test('publisher sanitizer drops private paths, tokens, traces and native job claims',()=>{
  const p=proof();p.token='secret';p.candidate.registryUrl='private';p.candidate.jobs=[{id:1,status:'success'}];p.beta.trace='private';
  assert.deepEqual(evidence.sanitize(p),proof());
});
module.exports={proof,results};
