'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeql-parent-'));
try {
  for (const directory of ['tests', 'bin', '.codeql-context']) fs.mkdirSync(path.join(root, directory));
  fs.copyFileSync(path.join(__dirname, '../ci-codeql.sh'), path.join(root, 'tests/ci-codeql.sh'));
  const context = Buffer.from('committed public scan context'), revision = 'a'.repeat(40);
  const checksum = crypto.createHash('sha256').update(context).digest('hex');
  fs.writeFileSync(path.join(root, '.codeql-context/context.tar'), context);
  fs.writeFileSync(path.join(root, '.codeql-context/revision'), revision);
  fs.writeFileSync(path.join(root, '.codeql-context/sha256'), checksum);
  fs.writeFileSync(path.join(root, '.codeql-context/manifest.json'), JSON.stringify({revision}));
  const trace = path.join(root, 'trace.jsonl');
  fs.writeFileSync(path.join(root, 'bin/docker'), `#!${process.execPath}
const fs=require('node:fs');let a=process.argv.slice(2);if(a[0]==='--config')a=a.slice(2);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(a)+'\\n');
if(a[0]==='build')fs.writeFileSync('received-context',fs.readFileSync(0));
if(a[0]==='wait')console.log(process.env.MOCK_STATUS||'0');
if(a[0]==='logs')console.log('public source scan');
if(a[0]==='cp' && !process.env.MOCK_MISSING)fs.writeFileSync(a[2],'{}');
if(a[0]==='cp' && process.env.MOCK_MISSING)process.exitCode=1;
if(a[0]==='container' && a[1]==='ls'){
 if(process.env.MOCK_OFFLINE)process.exit(1);
 console.log('system-codeql-21-90001');
}
if(a[0]==='image' && a[1]==='ls')console.log('system-codeql:ci-21-90001');
if(a[0]==='inspect'||(a[0]==='image'&&a[1]==='inspect'))console.log('sha256:owned '+(process.env.MOCK_FOREIGN?'foreign':'21:90001'));
if(process.env.MOCK_REMOVE_FAIL&&(a[0]==='rm'||(a[0]==='image'&&a[1]==='rm')))process.exitCode=1;
`, {mode: 0o755});
  const env = {...process.env, PATH: path.join(root, 'bin') + ':' + process.env.PATH,
    CI_PROJECT_ID: '21', CI_JOB_ID: '90001', CI_COMMIT_SHA: revision};
  const invoke = extra => spawnSync('sh', [path.join(root, 'tests/ci-codeql.sh')],
    {env: {...env, ...extra}, encoding: 'utf8', timeout: 10000});
  assert.equal(invoke({}).status, 0);
  assert(fs.readFileSync(path.join(root, 'received-context')).equals(context));
  const calls = fs.readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const create = calls.find(args => args[0] === 'create');
  for (const [flag, value] of [['--network', 'none'], ['--memory', '6g'], ['--cpus', '2'],
    ['--pids-limit', '256'], ['--user', '1000:1000'], ['--cap-drop', 'ALL']])
    assert.equal(create[create.indexOf(flag) + 1], value);
  assert(!create.some(arg => ['--mount', '-v', '--volume', '--privileged', '--env', '-e'].includes(arg)));
  assert(calls.findIndex(args => args[0] === 'cp') < calls.findIndex(args => args[0] === 'rm'));
  assert.equal(invoke({MOCK_STATUS: '7'}).status, 7, 'Preserve failed scan exit.');
  assert.equal(invoke({MOCK_MISSING: '1'}).status, 1, 'Success requires retained evidence.');
  assert.equal(invoke({MOCK_REMOVE_FAIL: '1'}).status, 1, 'Cleanup failure fails a successful scan.');
  assert.equal(invoke({MOCK_STATUS: '7', MOCK_REMOVE_FAIL: '1'}).status, 7);
  fs.writeFileSync(trace, '');
  assert.equal(invoke({MOCK_FOREIGN: '1'}).status, 1);
  assert(!fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    .some(args => args[0] === 'rm' || (args[0] === 'image' && args[1] === 'rm')), 'Never remove foreign resources.');
  fs.writeFileSync(trace, '');
  assert.equal(invoke({CI_COMMIT_SHA: 'b'.repeat(40)}).status, 1);
  assert.equal(fs.readFileSync(trace, 'utf8'), '', 'Stale context fails before Docker.');
  fs.writeFileSync(path.join(root, '.codeql-context/sha256'), '0'.repeat(64));
  assert.notEqual(invoke({}).status, 0);
  assert.equal(fs.readFileSync(trace, 'utf8'), '', 'Damaged context fails before Docker.');
  console.log('PASS: CodeQL parent verifies source, isolates bounded child, retains evidence and refuses foreign cleanup.');
} finally { fs.rmSync(root, {recursive: true, force: true}); }
