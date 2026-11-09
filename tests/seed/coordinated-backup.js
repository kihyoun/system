'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const backup=require('../../system/coordinated-backup');
const seedOperation=require('../../system/seed-operation');
const logo=fs.readFileSync(path.join(__dirname,'../../sync/src/Helper.ts'),'utf8').match(/return `([\s\S]*?)`;/)[1];
function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'coordinated-backup-'));
  try {
    const state=path.join(root,'state'),seed=path.join(root,'seed'),certbot=path.join(root,'certbot'),id='a'.repeat(32);
    for(const dir of [state,seed,certbot,path.join(state,'.projects.env'),backup.directory(state,id)]) fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(state,'.docker.env'),logo+"\nGITLAB_IMAGE='gitlab/test:1'\n");
    fs.writeFileSync(path.join(state,'.projects.env/.wizard.env'),logo+"\nPROJECT_NAME='wizard'\n");
    const publish=generation=>{
      const snapshot=path.join(seed,'snapshots',generation);fs.mkdirSync(snapshot,{recursive:true});
      fs.writeFileSync(path.join(snapshot,'manifest.json'),JSON.stringify({format:'system-bootstrapper-seed-v2',consistency:'gitlab-stopped',completedAt:'2026-01-01T00:00:00.000Z',gitlabImage:'gitlab/test:1',gitlabImageId:'sha256:'+'b'.repeat(64)}));
      if(fs.existsSync(path.join(seed,'current')))fs.unlinkSync(path.join(seed,'current'));
      fs.symlinkSync('snapshots/'+generation,path.join(seed,'current'));
    };
    publish('old');run({state,seed,certbot,id,publish});
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
test('native lease spans exact capture, Harvest and export; prior generations retained',()=>fixture(options=>{
  const held=new seedOperation.StorageLease(options.state,{operation:'harvest'});
  try {
    const result=backup.runWorkflow({...options,harvest:token=>{
      assert.equal(fs.readFileSync(path.join(options.certbot,'.system-bootstrapper-certificate-lock/coordinated-owner'),'utf8'),token);
      assert.throws(()=>new seedOperation.StorageLease(options.state,{}),/storage-operation-busy/);
      options.publish('new');
    },exporter:(input,output)=>{
      const captured=JSON.parse(fs.readFileSync(input));
      assert.equal(captured.seedAssociation.generation,'new');
      assert.deepEqual(captured.seedAssociation.configurationFiles,backup.checksums(backup.capture(options.state)));
      assert.ok(fs.existsSync(path.join(options.certbot,'.system-bootstrapper-certificate-lock')));
      fs.writeFileSync(output,'fixture ZIP');
    }});
    assert.equal(result.state,'ready');assert.equal(result.seed.status,'completed');
    assert.ok(fs.existsSync(path.join(options.seed,'snapshots/old/manifest.json')));
    assert.ok(!fs.existsSync(path.join(options.certbot,'.system-bootstrapper-certificate-lock')));
    assert.ok(!fs.existsSync(path.join(backup.directory(options.state,options.id),'configuration-input.json')));
  } finally {held.release(true);}
}));
test('Harvest failure preserves prior current and never attempts export',()=>fixture(options=>{
  assert.throws(()=>backup.runWorkflow({...options,harvest:()=>{throw Error('seed-copy-failed');},exporter:()=>assert.fail('must not export')}),/seed-copy-failed/);
  assert.equal(backup.completed(options.seed).generation,'old');
  assert.equal(JSON.parse(fs.readFileSync(path.join(backup.directory(options.state,options.id),'status.json'))).state,'failed');
}));
for(const failure of ['export','changed','resumption'])test(failure+' failure reports partial and retains completed Seed',()=>fixture(options=>{
  assert.throws(()=>backup.runWorkflow({...options,harvest:()=>{
    options.publish('new');
    if(failure==='changed')fs.appendFileSync(path.join(options.state,'.docker.env'),"CHANGED='yes'\n");
    if(failure==='resumption')throw Error('seed-copy-failed');
  },exporter:()=>{throw Error('configuration-export-failed');}}));
  const result=JSON.parse(fs.readFileSync(path.join(backup.directory(options.state,options.id),'status.json')));
  assert.equal(result.state,'partial');assert.equal(result.configuration.status,'unavailable');assert.equal(result.seed.generation,'new');
  assert.equal(result.seed.status,failure==='resumption'?'completed-resumption-unconfirmed':'completed');
  assert.ok(fs.existsSync(path.join(options.seed,'snapshots/old/manifest.json')));
}));
test('uncertain child preserves TLS lease and reports no matching ZIP',()=>fixture(options=>{
  assert.throws(()=>backup.runWorkflow({...options,harvest:()=>{const error=Error('seed-copy-failed');error.uncertain=true;throw error;},exporter:()=>assert.fail()}));
  assert.ok(fs.existsSync(path.join(options.certbot,'.system-bootstrapper-certificate-lock')));
}));
test('renewal lease conflicts fail before Harvest without removing another owner',()=>fixture(options=>{
  fs.mkdirSync(path.join(options.certbot,'.system-bootstrapper-certificate-lock'));
  assert.throws(()=>backup.runWorkflow({...options,harvest:()=>assert.fail(),exporter:()=>assert.fail()}),/certificate-operation-busy/);
  assert.ok(fs.existsSync(path.join(options.certbot,'.system-bootstrapper-certificate-lock')));
}));
test('TLS cleanup failure cannot leave a ready pair claim',()=>fixture(options=>{
  assert.throws(()=>backup.runWorkflow({...options,harvest:()=>options.publish('new'),exporter:(input,output)=>{
    fs.writeFileSync(output,'fixture ZIP');
    fs.writeFileSync(path.join(options.certbot,'.system-bootstrapper-certificate-lock/other-owner'),'must not remove');
  }}),/certificate-lease-cleanup-failed/);
  const result=JSON.parse(fs.readFileSync(path.join(backup.directory(options.state,options.id),'status.json')));
  assert.equal(result.state,'partial');assert.equal(result.configuration.status,'unavailable');
}));
test('stopped helper with unreleased global lease cannot publish ready after interruption',()=>fixture(options=>{
  const root=backup.directory(options.state,options.id);
  backup.writeStatus(root,{id:options.id,state:'ready',configuration:{status:'ready'}});
  fs.mkdirSync(path.join(options.state,'.storage-operation-lock'));
  backup.helperCompleted(options.state,options.id);
  const result=JSON.parse(fs.readFileSync(path.join(root,'status.json')));
  assert.equal(result.state,'interrupted');assert.equal(result.configuration.status,'unavailable');
  assert.equal(result.error,'storage-lease-release-unconfirmed');
}));
test('native capture exports validated portable preview intent without server IDs or evidence',()=>fixture(options=>{
  const intent={version:1,namespace:'team',wizard:{mode:'import',project:'wizard-source',origin:'https://github.com/example/wizard.git'},
    review:{enabled:true,host:'review.example.test',ssl:'/ssl/review/fullchain.pem',sslKey:'/ssl/review/privkey.pem'},
    beta:{enabled:false,host:'',ssl:'',sslKey:''}};
  fs.writeFileSync(path.join(options.state,'preview-setup.json'),JSON.stringify({settings:intent,operation:'server-only',projects:{wizard:{id:991}},pipeline:{id:992},token:'must-not-copy'}));
  const input=backup.capture(options.state);
  assert.deepEqual(input.previewSetup,intent);
  assert.ok(!JSON.stringify(input).includes('server-only'));
  assert.ok(!JSON.stringify(input).includes('must-not-copy'));
  fs.writeFileSync(path.join(options.state,'preview-setup.json'),JSON.stringify({settings:{...intent,projects:{id:991}}}));
  assert.throws(()=>backup.capture(options.state));
}));
