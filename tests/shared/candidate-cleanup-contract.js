'use strict';
const assert=require('assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {cleanupAll}=require('../e2e/candidate');
const {acmeAcceptance}=require('../e2e/prepare-images');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-cleanup-order-'));
const authority='a'.repeat(24),dns='b'.repeat(24),initializer='c'.repeat(24),heavy='f'.repeat(24);
function receipt(id,fullAcceptance,resources) {
  const target=path.join(directory,id);fs.mkdirSync(target,{recursive:true});
  fs.writeFileSync(path.join(target,'results.json'),JSON.stringify({runId:id,fullAcceptance,resources}));
}
try {
  const host=['bootstrapper/certbot-with-volume-lock.sh','bootstrapper/install-volume-certificate.sh','bootstrapper/rebind-renewal.py'];
  assert.equal(acmeAcceptance(host,()=>false),false);
  assert.equal(acmeAcceptance(host,()=>true),true);
  assert.throws(()=>acmeAcceptance(host.slice(0,2),()=>true),/complete pinned authority/);
  assert.throws(()=>acmeAcceptance(host,name=>!name.endsWith('pebble.minica.pem')),/complete pinned authority/);
  receipt(authority,false,[{kind:'network'},{kind:'volume'},{kind:'container'}]);
  receipt(dns,false,[{kind:'container'}]);receipt(initializer,false,[{kind:'container'}]);
  receipt(heavy,true,[{kind:'network'},{kind:'volume'},{kind:'container'}]);
  let order=[],fail;
  const recover=report=>({cleanup(){order.push(report.runId);return report.runId!==fail;},report(target){assert.equal(path.basename(target),report.runId);}});
  assert(cleanupAll(directory,{recover}));
  assert.deepEqual(order,[heavy,dns,initializer,authority],'Lexically first authority must outlive every client and daemon.');
  order=[];fail=heavy;assert.equal(cleanupAll(directory,{recover}),false);assert.deepEqual(order,[heavy]);
  order=[];fail=dns;assert.equal(cleanupAll(directory,{recover}),false);assert.deepEqual(order,[heavy,dns,initializer]);
  order=[];fail=undefined;
  fs.writeFileSync(path.join(directory,initializer,'results.json'),'{malformed');
  assert.equal(cleanupAll(directory,{recover}),false);assert.deepEqual(order,[heavy],'Malformed ownership input preserves fixture dependencies.');
  fs.rmSync(path.join(directory,initializer),{recursive:true});
  fs.symlinkSync(path.join(directory,heavy),path.join(directory,initializer),'dir');order=[];
  assert.equal(cleanupAll(directory,{recover}),false);assert.deepEqual(order,[heavy]);
  assert(cleanupAll(path.join(directory,'absent'),{recover}));
  console.log('PASS candidate cleanup order, failure dependencies, malformed receipts and symlink refusal');
}finally {fs.rmSync(directory,{recursive:true,force:true});}
