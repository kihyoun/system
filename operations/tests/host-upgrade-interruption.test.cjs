const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PublicUpgradePlanService } = require('../dist/host/public-upgrade-plan.service');
const { UpgradeLifecycleService } = require('../dist/host/upgrade-lifecycle.service');

test('interrupted plan is retryable but passed preflight is preserved', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-interruption-'));
  try {
    const service = new PublicUpgradePlanService({});
    const attemptId = 'a'.repeat(32);
    const filename = path.join(directory, 'preflight.json');
    const save = (phase) =>
      fs.writeFileSync(
        filename,
        JSON.stringify({ format: 'system-public-upgrade-preflight-v1', attemptId, phase }),
        { mode: 0o600 },
      );
    service.interrupt(directory, attemptId);
    const {readPrivateInput}=require('../dist/host/private-input');
    const privatePath=path.join(directory,'private.json'),replacement=path.join(directory,'replacement.json');
    fs.writeFileSync(privatePath,'original',{mode:0o600});fs.writeFileSync(replacement,'replacement',{mode:0o600});
    const originalStat=fs.fstatSync;
    fs.fstatSync=function(descriptor,...args){const stat=originalStat.call(fs,descriptor,...args);fs.renameSync(replacement,privatePath);return stat;};
    try{assert.equal(readPrivateInput(privatePath).toString(),'original');}finally{fs.fstatSync=originalStat;}
    fs.chmodSync(privatePath,0o644);assert.throws(()=>readPrivateInput(privatePath),/mode-0600/);
    fs.chmodSync(privatePath,0o600);assert.throws(()=>readPrivateInput(privatePath,2),/too-large/);
    fs.symlinkSync(privatePath,replacement);assert.throws(()=>readPrivateInput(replacement));fs.unlinkSync(replacement);
    fs.linkSync(privatePath,replacement);assert.throws(()=>readPrivateInput(privatePath),/regular/);fs.unlinkSync(replacement);
    save('checking');
    service.interrupt(directory, 'b'.repeat(32));
    assert.equal(JSON.parse(fs.readFileSync(filename)).phase, 'checking');
    service.interrupt(directory, attemptId);
    assert.equal(JSON.parse(fs.readFileSync(filename)).phase, 'failed');
    save('passed');
    service.interrupt(directory, attemptId);
    assert.equal(JSON.parse(fs.readFileSync(filename)).phase, 'passed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('interrupted apply retains durable inspection state and cannot overwrite completion', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-interruption-'));
  try {
    const service = new UpgradeLifecycleService();
    assert.equal(service.interrupt(directory), null);
    service.transition(directory, 'retaining-previous-images');
    assert.equal(service.interrupt(directory).phase, 'needs-inspection');
    assert.equal(service.interrupt(directory).phase, 'needs-inspection');
    fs.writeFileSync(
      path.join(directory, 'operation.json'),
      JSON.stringify({ format: 'system-public-upgrade-operation-v1', phase: 'completed' }),
      { mode: 0o600 },
    );
    assert.equal(service.interrupt(directory).phase, 'completed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('native callback worker handles separate attempts without retaining request identity', async () => {
  const { spawn } = require('node:child_process');
  const readline = require('node:readline');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-worker-'));
  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, '../dist/host/public-upgrade-plan-entry.js'), '--worker'],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const closed = new Promise((resolve) => child.on('close', resolve));
  try {
    const file = path.join(directory, 'preflight.json');
    for (const attemptId of ['a'.repeat(32), 'b'.repeat(32)]) {
      fs.writeFileSync(
        file,
        JSON.stringify({
          format: 'system-public-upgrade-preflight-v1',
          phase: 'checking',
          attemptId,
        }),
        { mode: 0o600 },
      );
      child.stdin.write(JSON.stringify({ operation: 'interrupt', directory, attemptId }) + '\n');
      const line = await Promise.race([
        lines.next(),
        new Promise((_, reject) => setTimeout(() => reject(Error('worker timeout')), 5000).unref()),
      ]);
      assert.equal(JSON.parse(line.value).complete, true);
      assert.equal(JSON.parse(fs.readFileSync(file)).phase, 'failed');
      assert.equal(child.exitCode, null);
    }
  } finally {
    child.stdin.end();
    await closed;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
