'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'ci-parent-'));
try {
  fs.mkdirSync(path.join(root,'tests'));
  fs.mkdirSync(path.join(root,'bin'));
  fs.copyFileSync(path.join(__dirname,'../ci-isolated.sh'),path.join(root,'tests/ci-isolated.sh'));
  const trace = path.join(root,'trace.jsonl');
  const mock = `#!${process.execPath}
const fs=require('fs'); const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');
if(args[0]==='wait') console.log('7');
if(args[0]==='cp') fs.writeFileSync('test-results/copied','report');
`;
  fs.writeFileSync(path.join(root,'bin/docker'),mock,{mode:0o755});
  const env = {...process.env,PATH:path.join(root,'bin')+':'+process.env.PATH,CI_PROJECT_ID:'21',CI_JOB_ID:'90001'};
  const result = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'gitlab'],{env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,7,'the outer job must propagate a failed candidate exit');
  const calls = fs.readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const create = calls.find(args=>args[0]==='create');
  assert(create.includes('--network') && create.includes('none'));
  assert(!create.some(arg=>['-v','--volume','--mount','--privileged','--env','-e'].includes(arg)));
  assert(calls.findIndex(args=>args[0]==='cp') < calls.findIndex(args=>args[0]==='rm'),'copy failure artifacts before cleanup');
  assert(calls.some(args=>args[0]==='rm' && args.includes('system-tests-21-90001')));
  assert(calls.some(args=>args[0]==='image' && args.includes('system-component-tests:ci-21-90001')));
  assert(fs.existsSync(path.join(root,'test-results/copied')));
  const invalid = spawnSync('sh',[path.join(root,'tests/ci-isolated.sh'),'gitlab'],{env:{...env,CI_JOB_ID:'../foreign'},encoding:'utf8'});
  assert.equal(invalid.status,2,'unsafe resource identifiers must be refused');
  console.log('PASS: failed child gates parent, artifacts precede exact resource cleanup, child gets no host access, invalid IDs refused.');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
