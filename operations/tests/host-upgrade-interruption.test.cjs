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
