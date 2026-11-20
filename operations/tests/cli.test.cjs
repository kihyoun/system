const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const cli = path.resolve(__dirname, '../dist/cli.js');

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: '/', env: { PATH: '', HOME: '/nonexistent', NO_COLOR: '' },
    encoding: 'utf8', timeout: 10000,
  });
}

test('help and version work without host tools, configuration or services', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: system-bootstrapper/);
  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, require('../package.json').version + '\n');
});

test('bare startup greets the user without starting an operation', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /You build it\. You own it\./);
  assert.ok(!result.stdout.includes('\x1b'));
});

test('unknown arguments fail without invoking an external command', () => {
  const result = run(['harvest', '--unexpected']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /unknown-command-use-help/);
});

test('host commands require explicit source and image before any native command', () => {
  for (const args of [['harvest'], ['restore', '--checkout', '/source'], ['harvest', '--checkout', 'relative', '--image', 'pin']]) {
    const result=run(args); assert.equal(result.status,1); assert.equal(result.stdout,'');
    assert.match(result.stderr,/explicit-host-checkout-required|accepted-controller-image-required/);
  }
  const {parseHostArguments}=require('../dist/cli.js');
  assert.deepEqual(parseHostArguments(['restore','--checkout','/source','--image','pin','--check-only','--configuration-backup','/backup.zip']),{
    checkout:'/source',image:'pin',persistenceEnv:'/etc/system-bootstrapper/persistence.env',configurationBackup:'/backup.zip',checkOnly:true,forward:[]
  });
  assert.throws(()=>parseHostArguments(['harvest','--image','one','--image','two']),/duplicate-option/);
});
