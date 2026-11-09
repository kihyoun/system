'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const child=require('node:child_process');
const workflow=require('../../sync/dist/BackupWorkflow');
const native=require('../../system/coordinated-backup');
function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync-backup-'));
  const previous=process.env.SYSTEM_CONFIG_DIR;process.env.SYSTEM_CONFIG_DIR=root;
  try {run(root);} finally {if(previous===undefined)delete process.env.SYSTEM_CONFIG_DIR;else process.env.SYSTEM_CONFIG_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
}
test('ready exports cannot download until native helper cleanup is witnessed; ZIP tamper is rejected',()=>fixture(root=>{
  const id='a'.repeat(32),operation=native.directory(root,id);fs.mkdirSync(operation,{recursive:true});
  const payload=Buffer.from('fixture ZIP');fs.writeFileSync(path.join(operation,'bootstrapper.zip'),payload);
  const status={id,state:'ready',configuration:{status:'ready',sha256:crypto.createHash('sha256').update(payload).digest('hex')}};
  native.writeStatus(operation,status);
  assert.equal(workflow.backupWorkflowStatus(id).state,'interrupted');
  assert.throws(()=>workflow.backupWorkflowDownload(id),/configuration-backup-unavailable/);
  native.writeStatus(operation,{...status,helperCompletedAt:new Date().toISOString()});
  assert.equal(workflow.backupWorkflowDownload(id).filename,path.join(operation,'bootstrapper.zip'));
  fs.appendFileSync(path.join(operation,'bootstrapper.zip'),'tamper');
  assert.throws(()=>workflow.backupWorkflowDownload(id),/configuration-backup-checksum-mismatch/);
  assert.throws(()=>workflow.backupWorkflowStatus('../outside'),/invalid-backup-operation/);
}));
test('one active operation excludes another start; lost completion remains interrupted without false success',()=>fixture(root=>{
  const original=child.execFile;let finish,done=0;
  child.execFile=(command,args,options,callback)=>{assert.equal(command,process.execPath);assert.deepEqual(args.slice(-2),['launch','harvest']);assert.match(options.env.SYSTEM_COORDINATED_BACKUP,/^[a-f0-9]{32}$/);finish=callback;};
  try {
    const status=workflow.startBackupWorkflow(()=>done++);
    assert.equal(status.state,'working');assert.equal(status.phase,'preflight');
    assert.throws(()=>workflow.startBackupWorkflow(),/storage-operation-busy/);
    finish(Error('private stderr must not leak'));
    assert.equal(done,1);
    const result=workflow.backupWorkflowStatus(status.id);
    assert.equal(result.state,'interrupted');assert.equal(result.configuration.status,'unavailable');
    assert.ok(!JSON.stringify(result).includes('private stderr'));
  } finally {child.execFile=original;}
  fs.mkdirSync(path.join(root,'.storage-operation-lock'));
  assert.throws(()=>workflow.startBackupWorkflow(),/storage-operation-busy/);
}));
