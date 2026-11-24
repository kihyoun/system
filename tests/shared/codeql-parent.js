const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {CodeqlParentService}=require('../../dist/modules/ci/codeqlParent.service');
const {ProcessFailure}=require('../../dist/common/runtime/process');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codeql-parent-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const context=path.join(root,'.codeql-context');fs.mkdirSync(context);
 const bytes=Buffer.from('source archive');
 fs.writeFileSync(path.join(context,'context.tar'),bytes);
 fs.writeFileSync(path.join(context,'sha256'),crypto.createHash('sha256').update(bytes).digest('hex'));
 fs.writeFileSync(path.join(context,'revision'),'a'.repeat(40));
 fs.writeFileSync(path.join(context,'manifest.json'),'{}');
 return {root,env:{CI_PROJECT_ID:'1',CI_JOB_ID:'2',CI_COMMIT_SHA:'a'.repeat(40)}};
}
test('static scanner keeps isolated child, file stdin and owned cleanup',async t=>{
 const {root,env}=fixture(t),calls=[];
 const adapter={async run(binary,args,options){calls.push({binary,args,options});
  if(args[0]==='wait')return '0\n';
  if(args[1]==='ls')return args[0]==='container'?'system-codeql-1-2':'system-codeql:ci-1-2';
  if(args[1]==='inspect')return JSON.stringify([{Id:'b'.repeat(64),Config:{Labels:{'org.system-bootstrapper.codeql-job':'1:2'}}}]);
  return '';
 }};
 await new CodeqlParentService(adapter).execute(root,env);
 const build=calls.find(c=>c.args.includes('build'));
 assert.equal(build.options.inputFile,path.join(root,'.codeql-context/context.tar'));
 const create=calls.find(c=>c.args.includes('create')).args;
 assert.equal(create[create.indexOf('--network')+1],'none');
 for(const [flag,value]of [['--memory','6g'],['--memory-swap','6g'],['--cpus','2'],['--pids-limit','256'],['--user','1000:1000'],['--cap-drop','ALL'],['--security-opt','no-new-privileges']]) {
  assert.equal(create[create.indexOf(flag)+1],value);
 }
 assert.equal(create.includes('/var/run/docker.sock'),false);
 for(const phase of ['create','start']) {
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'test-results/codeql/startup-'+phase+'.json'))),{phase,outcome:'passed',status:0,signal:null,uncertain:false});
 }
 assert.equal(calls.filter(c=>c.args[1]==='rm').length,2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'test-results/codeql/cleanup-on-exit.json'))).status,'passed');
});
test('create/start failures retain redacted private diagnostics and the original process outcome before scan evidence', async t => {
  for (const phase of ['create', 'start']) {
    await t.test(phase, async t => {
      const {root, env} = fixture(t), calls = [];
      env.ACCESS_TOKEN = 'private-startup-token';
      env.REGISTRY_PASSWORD = 'private/password';
      env.SYNC_PASS = 'private-sync-password';
      const failure = phase === 'create'
        ? new ProcessFailure('docker', 125, null, false)
        : new ProcessFailure('docker', null, 'SIGTERM', true);
      const adapter = {async run(binary, args, options) {
        calls.push({args, options});

        if (phase === 'create' ? args.includes('create') : args[0] === 'start') {
          options.output(Buffer.from('OCI startup refused: ' + env.ACCESS_TOKEN + '\n' +
            encodeURIComponent(env.REGISTRY_PASSWORD) + '\n' + env.SYNC_PASS + '\nhttps://operator:private@registry.example.invalid/\n'));
          throw failure;
        }

        if (args[1] === 'ls') {
          return args[0] === 'container' ? 'system-codeql-1-2' : 'system-codeql:ci-1-2';
        }

        if (args[1] === 'inspect') {
          return JSON.stringify([{Id:'b'.repeat(64),Config:{Labels:{'org.system-bootstrapper.codeql-job':'1:2'}}}]);
        }

        return '';
      }};
      await assert.rejects(new CodeqlParentService(adapter).execute(root, env), error => error === failure);
      const report = path.join(root, 'test-results/codeql');
      const diagnostic = fs.readFileSync(path.join(report, 'startup-' + phase + '.log'), 'utf8');
      assert.match(diagnostic, /OCI startup refused/);
      assert.match(diagnostic, /registry.example.invalid/);

      for (const secret of [env.ACCESS_TOKEN, env.REGISTRY_PASSWORD, encodeURIComponent(env.REGISTRY_PASSWORD), env.SYNC_PASS, 'operator:private']) {
        assert(!diagnostic.includes(secret));
      }

      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(report, 'startup-' + phase + '.json'))), {
        phase, outcome:'failed', status:failure.status, signal:failure.signal, uncertain:failure.uncertain,
      });
      assert.equal(fs.statSync(path.join(report, 'startup-' + phase + '.log')).mode & 0o077, 0);
      assert.equal(fs.statSync(path.join(report, 'startup-' + phase + '.json')).mode & 0o077, 0);
      assert.equal(calls.find(call => phase === 'create' ? call.args.includes('create') : call.args[0] === 'start').options.timeout, 120000);
      assert.equal(calls.some(call => call.args[0] === 'wait' || call.args[0] === 'cp'), false);
      assert.equal(fs.existsSync(path.join(report, 'scan.log')), false);
      assert.equal(calls.filter(call => call.args[1] === 'rm').length, 2);
      assert.equal(JSON.parse(fs.readFileSync(path.join(report, 'cleanup-on-exit.json'))).status, 'passed');
    });
  }
});
test('bounded startup diagnostics redact a credential prefix at the capture boundary', async t => {
  const {root, env} = fixture(t), secret = 'private-boundary-credential';
  env.ACCESS_TOKEN = secret;
  const failure = new ProcessFailure('docker', 125, null, false);
  const adapter = {async run(binary, args, options) {
    if (args.includes('create')) {
      options.output(Buffer.alloc(16 * 1024 - 5, 'x'));
      options.output(Buffer.from(secret));
      throw failure;
    }

    return '';
  }};
  await assert.rejects(new CodeqlParentService(adapter).execute(root, env), error => error === failure);
  const log = fs.readFileSync(path.join(root, 'test-results/codeql/startup-create.log'));
  assert(log.length <= 16 * 1024);
  assert(!log.toString().includes(secret.slice(0, 5)));
});
test('diagnostic write failure cannot replace the primary startup failure or skip cleanup', async t => {
  const {root, env} = fixture(t), failure = new ProcessFailure('docker', 125, null, false), calls = [];
  const originalWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (filename, ...args) => {
    if (filename === path.join(root, 'test-results/codeql/startup-start.log')) {
      throw Error('diagnostic-write-refused');
    }

    return originalWrite(filename, ...args);
  });
  const adapter = {async run(binary, args) {
    calls.push(args);

    if (args[0] === 'start') {
      throw failure;
    }

    return '';
  }};
  await assert.rejects(new CodeqlParentService(adapter).execute(root, env), error => error === failure);
  assert.equal(calls.filter(args => args[1] === 'ls').length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'test-results/codeql/startup-start.json'))).status, 125);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'test-results/codeql/cleanup-on-exit.json'))).status, 'passed');
});
test('archive mismatch refuses Docker execution',async t=>{
 const {root,env}=fixture(t);fs.appendFileSync(path.join(root,'.codeql-context/context.tar'),'changed');
 let calls=0;
 await assert.rejects(new CodeqlParentService({async run(){calls++;return '';}}).execute(root,env),/checksum-mismatch/);
 assert.equal(calls,0);
});
test('scanner build failure exports compiler diagnostics without private parent tokens',async t=>{
 const {root,env}=fixture(t),failure=Error('compiler-exit-two');env.ACCESS_TOKEN='private-scanner-token';
 const previous=console.error;console.error=()=>{};t.after(()=>{console.error=previous;});
 const adapter={async run(binary,args,options){if(args.includes('build')){
  options.output(Buffer.from('Cannot find module ./credentials.service\nprivate-scanner-token\n'));throw failure;
 }return '';}};
 await assert.rejects(new CodeqlParentService(adapter).execute(root,env),e=>e===failure);
 const log=fs.readFileSync(path.join(root,'test-results/codeql/build.log'),'utf8');
 assert.match(log,/Cannot find module/);assert.equal(log.includes('private-scanner-token'),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'test-results/codeql/cleanup-on-exit.json'))).status,'passed');
});
test('wait failure preserves original error and still collects evidence and cleans',async t=>{
 const {root,env}=fixture(t),calls=[],failure=Error('daemon-disconnected');
 const adapter={async run(binary,args,options){calls.push({args,options});if(args[0]==='wait')throw failure;return '';}};
 await assert.rejects(new CodeqlParentService(adapter).execute(root,env),e=>e===failure);
 assert.equal(calls.filter(c=>c.args[0]==='cp').length,3);
 assert.equal(calls.filter(c=>c.args[1]==='ls').length,2);
 assert.ok(calls.filter(c=>c.args[0]==='cp').every(c=>c.options.signal===undefined));
});
test('cleanup refuses resources with a foreign ownership label',async t=>{
 const {root,env}=fixture(t),calls=[];
 const adapter={async run(binary,args){calls.push(args);
  if(args[1]==='ls')return args[0]==='container'?'system-codeql-1-2':'';
  if(args[1]==='inspect')return JSON.stringify([{Id:'b'.repeat(64),Config:{Labels:{'org.system-bootstrapper.codeql-job':'different'}}}]);return '';
 }};
 await assert.rejects(new CodeqlParentService(adapter).execute(root,env,true),/owner-mismatch/);
 assert.equal(calls.some(args=>args[1]==='rm'),false);
});
test('successful scan cannot hide missing evidence or cleanup failure',async t=>{
 for(const failedCommand of ['cp','cleanup']) {
  const {root,env}=fixture(t);let started=false;
  const adapter={async run(binary,args){
   if(args[0]==='start')started=true;
   if(args[0]==='wait')return '0';
   if(args[0]==='cp'&&failedCommand==='cp')throw Error('missing-evidence');
   if(args[1]==='ls'&&started&&failedCommand==='cleanup')throw Error('cleanup-unavailable');
   return '';
  }};
  await assert.rejects(new CodeqlParentService(adapter).execute(root,env),/missing-evidence|cleanup-unavailable/);
 }
});
