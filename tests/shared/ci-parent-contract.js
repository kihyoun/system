'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'ci-parent-'));
try {
  fs.mkdirSync(path.join(root,'tests'));
  fs.mkdirSync(path.join(root,'bin'));
  fs.copyFileSync(path.join(__dirname,'../ci-isolated.sh'),path.join(root,'tests/ci-isolated.sh'));
  const trace = path.join(root,'trace.jsonl');
  const context = Buffer.from('only committed source and validated snapshot');
  const revision = 'a'.repeat(40);
  fs.mkdirSync(path.join(root,'.test-context'));
  fs.writeFileSync(path.join(root,'.test-context/context.tar'),context);
  fs.writeFileSync(path.join(root,'.test-context/revision'),revision+'\n');
  const hash=crypto.createHash('sha256').update(context).digest('hex');
  fs.writeFileSync(path.join(root,'.test-context/sha256'),hash+'\n');
  const mock = `#!${process.execPath}
const fs=require('fs'); const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');
if(args[0]==='build') fs.writeFileSync('received-context',fs.readFileSync(0));
if(args[0]==='wait') console.log(process.env.MOCK_CHILD_STATUS || '7');
if(args[0]==='cp') fs.writeFileSync('test-results/copied','report');
if(args[0]==='container' && args[1]==='ls') {
 if(process.env.MOCK_CLEANUP==='offline') process.exit(1);
 if(process.env.MOCK_CLEANUP!=='absent') console.log('system-tests-21-90001');
}
if(args[0]==='image' && args[1]==='ls') {
 if(process.env.MOCK_CLEANUP==='offline') process.exit(1);
 if(process.env.MOCK_CLEANUP!=='absent') console.log('system-component-tests:ci-21-90001');
}
if(process.env.MOCK_CLEANUP==='remove-failed' && (args[0]==='rm' || (args[0]==='image' && args[1]==='rm'))) process.exit(1);
`;
  fs.writeFileSync(path.join(root,'bin/docker'),mock,{mode:0o755});
  const env = {...process.env,PATH:path.join(root,'bin')+':'+process.env.PATH,CI_PROJECT_ID:'21',CI_JOB_ID:'90001',CI_COMMIT_SHA:revision};
  const result = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'gitlab'],{env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,7,'the outer job must propagate a failed candidate exit');
  assert(fs.readFileSync(path.join(root,'received-context')).equals(context),'build only the verified archive through stdin');
  const calls = fs.readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const create = calls.find(args=>args[0]==='create');
  assert(create.includes('--network') && create.includes('none'));
  assert(!create.some(arg=>['-v','--volume','--mount','--privileged','--env','-e'].includes(arg)));
  assert(calls.findIndex(args=>args[0]==='cp') < calls.findIndex(args=>args[0]==='rm'),'copy failure artifacts before cleanup');
  assert(calls.some(args=>args[0]==='rm' && args.includes('system-tests-21-90001')));
  assert(calls.some(args=>args[0]==='image' && args.includes('system-component-tests:ci-21-90001')));
  assert(fs.existsSync(path.join(root,'test-results/copied')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'test-results/cleanup/on-exit.json'))).status,'passed');
  const failedCleanup = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'gitlab'],{env:{...env,MOCK_CHILD_STATUS:'0',MOCK_CLEANUP:'remove-failed'},encoding:'utf8',timeout:5000});
  assert.equal(failedCleanup.status,1,'successful tests must not hide failed cleanup');
  assert(failedCleanup.stderr.includes('cleanup failed'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'test-results/cleanup/on-exit.json'))).status,'failed');
  const primaryFailure = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'gitlab'],{env:{...env,MOCK_CHILD_STATUS:'7',MOCK_CLEANUP:'remove-failed'},encoding:'utf8',timeout:5000});
  assert.equal(primaryFailure.status,7,'cleanup must preserve the original test failure');
  const absent = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'gitlab'],{env:{...env,MOCK_CHILD_STATUS:'0',MOCK_CLEANUP:'absent'},encoding:'utf8',timeout:5000});
  assert.equal(absent.status,0,'already absent resources are successful idempotent cleanup');
  const offline = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'cleanup'],{env:{...env,MOCK_CLEANUP:'offline'},encoding:'utf8',timeout:5000});
  assert.equal(offline.status,1,'daemon failure must differ from absent resources');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'test-results/cleanup/after-script.json'))).status,'failed');
  assert(fs.existsSync(path.join(root,'test-results/cleanup/on-exit.json')),'retain the separate primary cleanup record');
  fs.writeFileSync(trace,'');
  const stale = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'gitlab'],{env:{...env,CI_COMMIT_SHA:'b'.repeat(40)},encoding:'utf8'});
  assert.equal(stale.status,1);
  assert(stale.stderr.includes('stale'));
  assert.equal(fs.readFileSync(trace,'utf8'),'','refuse stale artifacts before contacting Docker');
  fs.writeFileSync(path.join(root,'.test-context/sha256'),'0'.repeat(64)+'\n');
  const damaged = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'gitlab'],{env,encoding:'utf8'});
  assert.equal(damaged.status,1,'refuse a damaged context archive');
  assert.equal(fs.readFileSync(trace,'utf8'),'');
  fs.writeFileSync(path.join(root,'.test-context/sha256'),hash+'\n');
  fs.unlinkSync(path.join(root,'.test-context/context.tar'));
  const missing = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'gitlab'],{env,encoding:'utf8'});
  assert.notEqual(missing.status,0,'refuse a missing context archive');
  assert.equal(fs.readFileSync(trace,'utf8'),'','never fall back to the checkout when an artifact is missing');
  const invalid = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'gitlab'],{env:{...env,CI_JOB_ID:'../foreign'},encoding:'utf8'});
  assert.equal(invalid.status,2,'unsafe resource identifiers must be refused');
  console.log('PASS: verified context only, stale/damaged artifacts fail closed, primary failure preserved, absent resources distinguished and cleanup failures visible.');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
