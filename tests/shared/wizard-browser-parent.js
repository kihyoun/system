'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-browser-parent-'));
try {
  for (const dir of ['tests', 'bin', '.wizard-browser-context']) fs.mkdirSync(path.join(root, dir));
  fs.copyFileSync(path.join(__dirname, '../ci-wizard-browser.sh'), path.join(root, 'tests/ci-wizard-browser.sh'));
  const trace = path.join(root, 'trace.jsonl');
  const revision = 'a'.repeat(40);
  const context = Buffer.from('verified public committed browser context');
  const checksum = crypto.createHash('sha256').update(context).digest('hex');
  fs.writeFileSync(path.join(root, '.wizard-browser-context/context.tar'), context);
  fs.writeFileSync(path.join(root, '.wizard-browser-context/revision'), revision+'\n');
  fs.writeFileSync(path.join(root, '.wizard-browser-context/sha256'), checksum+'\n');
  const mock = `#!${process.execPath}
const fs=require('fs'); const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');
const built=fs.existsSync('built'); const created=fs.existsSync('created');
const container='system-wizard-browser-21-90001'; const image='system-wizard-browser:ci-21-90001';
const containerId='c'.repeat(64); const imageId='sha256:'+'d'.repeat(64);
const owner=process.env.MOCK_OWNER==='foreign'?'999':'90001';
if(args[0]==='build') {fs.writeFileSync('received-context',fs.readFileSync(0));fs.writeFileSync('built','1');if(process.env.MOCK_BUILD_FAIL)process.exit(6);}
if(args.includes('create')) { const config=args[args.indexOf('--config')+1];fs.writeFileSync('client-config',fs.readFileSync(config+'/config.json'));fs.writeFileSync('created','1'); }
if(args[0]==='wait') { if(process.env.MOCK_WAIT_FAIL)process.exit(9); console.log(process.env.MOCK_CHILD_STATUS||'7'); }
if(args[0]==='logs' && process.env.MOCK_LOG_FAIL)process.exit(1);
if(args[0]==='cp') {
 if(process.env.MOCK_CP_FAIL)process.exit(1);
 if(!process.env.MOCK_NO_JUNIT)fs.writeFileSync('test-results/wizard-browser/junit.xml','<testsuite name="native-suite" tests="3"/>');
 fs.writeFileSync('test-results/wizard-browser/copied','failure screenshot');
}
if(args[0]==='container' && args[1]==='ls') {if(process.env.MOCK_OFFLINE)process.exit(1);if(created||process.env.MOCK_COLLISION)console.log(container);}
if(args[0]==='image' && args[1]==='ls') {if(process.env.MOCK_OFFLINE)process.exit(1);if(built||process.env.MOCK_COLLISION)console.log(image);}
if(args[0]==='inspect')console.log(containerId+'|21|'+owner+'|wizard-browser');
if(args[0]==='image' && args[1]==='inspect')console.log(imageId+'|21|'+owner+'|wizard-browser');
if(args[0]==='rm') {if(process.env.MOCK_REMOVE_FAIL)process.exit(1);fs.rmSync('created',{force:true});}
if(args[0]==='image' && args[1]==='rm') {if(process.env.MOCK_REMOVE_FAIL)process.exit(1);fs.rmSync('built',{force:true});}
`;
  fs.writeFileSync(path.join(root, 'bin/docker'), mock, {mode:0o755});
  // Exercise timeout and cancellation without consuming the real browser budget.
  const timeoutMock = `#!${process.execPath}
const {spawnSync}=require('child_process'); const fs=require('fs'); const args=process.argv.slice(2);
if(process.env.MOCK_DEADLINE && args.includes('wait'))process.exit(124);
if(process.env.MOCK_CANCEL && args.includes('wait')) { process.kill(process.ppid,'SIGTERM'); process.exit(0); }
const result=spawnSync('/usr/bin/timeout',args,{stdio:'inherit'});process.exit(result.status===null?1:result.status);
`;
  fs.writeFileSync(path.join(root, 'bin/timeout'), timeoutMock, {mode:0o755});
  const env = {...process.env, PATH:path.join(root, 'bin')+':'+process.env.PATH, CI_PROJECT_ID:'21', CI_JOB_ID:'90001', CI_COMMIT_SHA:revision};
  const run = (extra={}, args=[]) => {
    for (const name of ['built', 'created', 'trace.jsonl', 'test-results']) fs.rmSync(path.join(root, name), {recursive:true, force:true});
    return spawnSync('sh', [path.join(root, 'tests/ci-wizard-browser.sh'), ...args], {env:{...env,...extra}, encoding:'utf8', timeout:10000});
  };
  const calls = () => fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  let result = run(); assert.equal(result.status, 7, result.stderr);
  assert(fs.readFileSync(path.join(root, 'received-context')).equals(context));
  const create = calls().find(args => args.includes('create'));
  for (const [flag, value] of [['--network','none'], ['--memory','2g'], ['--cpus','2'], ['--pids-limit','512']]) assert.equal(create[create.indexOf(flag)+1], value);
  assert(create.includes('--init'));
  assert(!create.some(arg => ['-v','--volume','--mount','--privileged','--env','-e','--env-file','--network=host'].includes(arg)));
  assert.equal(fs.readFileSync(path.join(root, 'client-config'), 'utf8'), '{}\n');
  assert(calls().findIndex(args => args[0] === 'cp') < calls().findIndex(args => args[0] === 'rm'));
  assert(calls().some(args => args[0] === 'rm' && args[2] === 'c'.repeat(64)));
  assert(calls().some(args => args[0] === 'image' && args[1] === 'rm' && args[2] === 'sha256:'+'d'.repeat(64)));
  assert.equal(fs.readFileSync(path.join(root, 'test-results/wizard-browser/junit.xml'), 'utf8'), '<testsuite name="native-suite" tests="3"/>', 'preserve native JUnit');
  result = run({MOCK_CHILD_STATUS:'0'}); assert.equal(result.status, 0, result.stderr);
  result = run({MOCK_CHILD_STATUS:'7', MOCK_CP_FAIL:'1', MOCK_LOG_FAIL:'1', MOCK_REMOVE_FAIL:'1'}); assert.equal(result.status, 7, 'secondary failures preserve the suite failure');
  assert(fs.readFileSync(path.join(root, 'test-results/wizard-browser/junit.xml'), 'utf8').includes('<failure'));
  result = run({MOCK_CHILD_STATUS:'0', MOCK_REMOVE_FAIL:'1'}); assert.equal(result.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'test-results/wizard-browser/cleanup-on-exit.json'))).status, 'failed');
  result = run({MOCK_CHILD_STATUS:'0', MOCK_NO_JUNIT:'1'}); assert.equal(result.status, 1, 'success without report is unhealthy');
  result = run({MOCK_BUILD_FAIL:'1'}); assert.equal(result.status, 6); assert(!calls().some(args => args.includes('create')));
  result = run({MOCK_WAIT_FAIL:'1'}); assert.equal(result.status, 9); assert(calls().some(args => args[0] === 'cp'));
  result = run({MOCK_DEADLINE:'1'}); assert.equal(result.status, 124); assert(calls().some(args => args[0] === 'cp')); assert(calls().some(args => args[0] === 'rm'));
  result = run({MOCK_CANCEL:'1'}); assert.equal(result.status, 143); assert(calls().some(args => args[0] === 'rm')); assert(calls().some(args => args[0] === 'image' && args[1] === 'rm'));
  result = run({MOCK_OWNER:'foreign'}); assert.equal(result.status, 7); assert(!calls().some(args => args[0] === 'rm' || args[0] === 'image' && args[1] === 'rm'), 'owned names require matching labels before removal');
  result = run({MOCK_COLLISION:'1', MOCK_OWNER:'foreign'}); assert.equal(result.status, 1); assert(!calls().some(args => args[0] === 'build' || args[0] === 'rm' || args[0] === 'image' && args[1] === 'rm'), 'never build over or delete foreign resources');
  result = run({}, ['cleanup']); assert.equal(result.status, 0, 'absent resources are successful cleanup');
  result = run({MOCK_OFFLINE:'1'}, ['cleanup']); assert.equal(result.status, 1, 'daemon failure differs from absence');
  result = run({CI_COMMIT_SHA:'b'.repeat(40)}); assert.equal(result.status, 1); assert.equal(calls().length, 0, 'refuse stale context before Docker');
  fs.writeFileSync(path.join(root, '.wizard-browser-context/sha256'), '0'.repeat(64)+'\n');
  result = run(); assert.notEqual(result.status, 0); assert.equal(calls().length, 0);
  fs.writeFileSync(path.join(root, '.wizard-browser-context/sha256'), checksum+'\n'); fs.rmSync(path.join(root, '.wizard-browser-context/context.tar'));
  result = run(); assert.notEqual(result.status, 0); assert.equal(calls().length, 0);
  result = run({CI_JOB_ID:'../foreign'}); assert.equal(result.status, 2);
  const dockerfile = fs.readFileSync(path.join(__dirname, '../wizard-browser.Dockerfile'), 'utf8');
  assert(dockerfile.includes('playwright install-deps chromium') && dockerfile.includes('playwright install chromium'));
  assert(dockerfile.includes('ENV NODE_OPTIONS=--use-openssl-ca'));
  assert(dockerfile.includes('COPY bootstrapper/refresh-ca.sh /candidate/bootstrapper/'));
  assert(dockerfile.includes('COPY bootstrapper/ca/cacert-2026-10-20.crt bootstrapper/ca/provenance.json bootstrapper/ca/check.js /candidate/bootstrapper/ca/'));
  const refresh = 'sh /candidate/bootstrapper/refresh-ca.sh && node /candidate/bootstrapper/ca/check.js';
  assert(dockerfile.indexOf(refresh) < dockerfile.indexOf('npm ci'), 'refresh and validate trust before package downloads');
  const dependencies = dockerfile.indexOf('playwright install-deps chromium');
  const afterAptRefresh = dockerfile.indexOf(refresh, dependencies);
  assert(afterAptRefresh > dependencies && afterAptRefresh < dockerfile.indexOf('playwright install chromium'), 'restore reviewed trust after APT and before browser downloads');
  assert(dockerfile.includes('"test:ci"') && dockerfile.includes('--reporter=list,html,junit'));
  assert(!dockerfile.includes('--grep'), 'run the complete native suite');
  const parent = fs.readFileSync(path.join(__dirname, '../ci-wizard-browser.sh'), 'utf8');
  assert(parent.includes('timeout -k 10 480 docker build') && parent.includes('timeout -k 10 240 docker wait'), 'enforce finite build and suite deadlines');
  console.log('PASS: full offline browser child, verified stdin context, native reports/failures, bounded lifecycle, exact owned cleanup and collision/daemon refusal.');
} finally { fs.rmSync(root, {recursive:true, force:true}); }
