'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {NativeHostAttachedProcess} = require('../../dist/modules/host/attached-process');

test('attached host process forwards termination and treats even a clean child exit as uncertain', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'host-attachment-'));
  const ready = path.join(directory, 'ready'), stopped = path.join(directory, 'stopped');
  const script = path.join(directory, 'child.cjs');
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  const previous = signals.map(signal => process.listenerCount(signal));
  fs.writeFileSync(script, `const fs=require('node:fs');
process.on('SIGTERM',()=>{fs.writeFileSync(process.argv[3],'SIGTERM');process.exit(0);});
fs.writeFileSync(process.argv[2],String(process.pid));
setInterval(()=>{},1000);
`);
  let completion, settled = false;
  try {
    completion = new NativeHostAttachedProcess().run(process.execPath, [script, ready, stopped], {...process.env})
      .finally(() => { settled = true; });
    const result = assert.rejects(completion, /host-storage-launch-outcome-uncertain/);
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(ready) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 10));
    assert(fs.existsSync(ready), 'child must install its signal handler before termination');
    process.emit('SIGTERM');
    await result;
    assert.equal(fs.readFileSync(stopped, 'utf8'), 'SIGTERM');
    assert.deepEqual(signals.map(signal => process.listenerCount(signal)), previous);
  } finally {
    if (!settled && fs.existsSync(ready)) {
      try { process.kill(Number(fs.readFileSync(ready, 'utf8')), 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (completion) await completion.catch(() => {});
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('missing attached command fails without retaining signal listeners', async () => {
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  const previous = signals.map(signal => process.listenerCount(signal));
  await assert.rejects(new NativeHostAttachedProcess().run('/missing/bootstrapper-command', [], {}), /outcome-uncertain/);
  assert.deepEqual(signals.map(signal => process.listenerCount(signal)), previous);
});


test('interrupted attachment cannot hang when its child ignores termination', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'host-attachment-ignore-'));
  const ready = path.join(directory, 'ready');
  const script = path.join(directory, 'child.cjs');
  const previous = process.listenerCount('SIGTERM');
  fs.writeFileSync(script, `process.on('SIGTERM',()=>{});
require('node:fs').writeFileSync(process.argv[2],String(process.pid));
setInterval(()=>{},1000);`);
  let completion, settled = false;
  try {
    completion = new NativeHostAttachedProcess(50).run(process.execPath, [script, ready], {...process.env})
      .finally(() => { settled = true; });
    const result = assert.rejects(completion, /outcome-uncertain/);
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(ready) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 10));
    assert(fs.existsSync(ready));
    process.emit('SIGTERM');
    await result;
    assert.equal(process.listenerCount('SIGTERM'), previous);
  } finally {
    if (!settled && fs.existsSync(ready)) {
      try { process.kill(Number(fs.readFileSync(ready, 'utf8')), 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (completion) await completion.catch(() => {});
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
