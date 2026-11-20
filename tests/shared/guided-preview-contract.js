'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const adapter=require('../e2e/guided-preview');
const {Operator,readInput}=require('../e2e/guided-preview-live');
const image='sha256:'+'a'.repeat(64),commit='b'.repeat(40);
const desired={version:2,namespace:'team',wizard:{mode:'existing',project:'wizard',origin:''},
 review:{enabled:false,host:'',ssl:'',sslKey:''},beta:{enabled:true,host:'beta.example.test',ssl:'/ssl/beta/fullchain.pem',sslKey:'/ssl/beta/privkey.pem'}};
async function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'guided-preview-contract-'));try{return await run(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
function input(root){return {version:2,syncUrl:'https://sync.example.test',gitlabUrl:'https://gitlab.example.test',controllerImageId:image,settings:desired,reportPath:path.join(root,'report.json'),timeBudgetMilliseconds:3600000};}
test('long native waits renew Sync authentication before writes and retry expired read tokens only once',async()=>{
  let clock=0,logins=0,expiredRead=true;
  const requests=[];
  const sync=adapter.syncSession({url:'https://sync.example.test',secrets:{user:'fixture',password:'memory-only'},now:()=>clock,
    request:async(url,options)=>{
      requests.push({url,method:options.method,authorization:options.headers.Authorization});
      if(url.endsWith('/login'))return {status:200,body:JSON.stringify({accessToken:'fixture-'+(++logins)})};
      if(url.endsWith('/jobs/1')&&expiredRead){expiredRead=false;return {status:403,body:'expired'};}
      return {status:200,body:'{"state":"running"}'};
    }});
  await sync('/status');clock+=16*60000;
  await sync('/apply',{confirmed:true});
  assert.equal(logins,2);
  assert.equal(requests.filter(row=>row.url.endsWith('/apply')).length,1);
  assert.equal(requests.find(row=>row.url.endsWith('/apply')).authorization,'Bearer fixture-2');
  await sync('/jobs/1');assert.equal(logins,3);
  assert.deepEqual(requests.filter(row=>row.url.endsWith('/jobs/1')).map(row=>row.authorization),['Bearer fixture-2','Bearer fixture-3']);
});
test('Sync authentication failures never replay a mutation and read reauthentication stays bounded',async()=>{
  for(const status of [401,403]) {
    let logins=0,writes=0,reads=0;
    const sync=adapter.syncSession({url:'https://sync.example.test',secrets:{user:'fixture',password:'memory-only'},request:async(url,options)=>{
      if(url.endsWith('/login'))return {status:200,body:JSON.stringify({accessToken:'fixture-'+(++logins)})};
      if(options.method==='POST')writes++;else reads++;
      return {status,body:'private diagnostic must not leak'};
    }});
    await assert.rejects(()=>sync('/apply',{confirmed:true}),/guided-preview-sync-request-failed/);
    assert.equal(writes,1);assert.equal(logins,1);
    await assert.rejects(()=>sync('/jobs/1'),error=>error.message==='guided-preview-sync-request-failed');
    assert.equal(reads,2);assert.equal(logins,2);assert.equal(writes,1);
  }
});
test('Production identity proof compares both exact saved bytes and running immutable image',()=>{
  const before={mainSha256:'a'.repeat(64),runningImage:image};adapter.unchanged(before,{...before});
  assert.throws(()=>adapter.unchanged(before,{...before,mainSha256:'b'.repeat(64)}),/production-changed/);
  assert.throws(()=>adapter.unchanged(before,{...before,runningImage:'sha256:'+'c'.repeat(64)}),/production-changed/);
});
test('unexpected selected controller fails before reading credentials or making setup requests',async()=>{
  await fixture(async root=>{
    let commands=0;
    const operator=new Operator(input(root),{command:()=>{commands++;return {status:0,stdout:JSON.stringify([{Image:'sha256:'+'d'.repeat(64),State:{Running:true}}])};}});
    await assert.rejects(()=>operator.prepare(),/exact-accepted-controller-failed/);assert.equal(commands,1);assert.equal(operator.secrets,undefined);
  });
});
test('native transport keeps request credentials on stdin and does not expose subprocess diagnostics',async()=>{
  await fixture(async root=>{
    let captured;
    const operator=new Operator(input(root),{command:(command,args,options)=>{captured={command,args,options};return {status:0,stdout:JSON.stringify({status:200,body:'{}'})};}});
    await operator.request('https://gitlab.example.test/api/v4/user',{headers:{'PRIVATE-TOKEN':'test-secret-value',Host:'foreign.example.test'}});
    assert.equal(captured.command,'docker');assert.equal(captured.args[0],'--host=unix:///var/run/docker.sock');
    assert.ok(!captured.args.join(' ').includes('test-secret-value'));assert.ok(captured.options.input.includes('test-secret-value'));
    assert.ok(!captured.options.input.includes('foreign.example.test'));
    operator.command=()=>({status:1,stderr:'test-secret-value raw unsafe failure'});
    await assert.rejects(()=>operator.inner(['inspect','system_bootstrapper_1']),error=>!error.message.includes('test-secret-value')&&error.message==='guided-preview-native-command-failed');
  });
});
test('only synchronous native preflight receives a longer HTTP budget and the global deadline still caps it',async()=>fixture(async root=>{
  let clock=0,captured;
  const operator=new Operator({...input(root),timeBudgetMilliseconds:600000},{now:()=>clock,
    command:(_command,_args,options)=>{captured=options;return {status:0,stdout:'{"status":200,"body":"{}"}'};}});
  await operator.request(operator.url+'/projects/wizard/preview-setup/preflight',{method:'POST'});
  assert.equal(JSON.parse(captured.input).timeoutMilliseconds,300000);assert.equal(captured.timeout,310000);
  await operator.request(operator.url+'/projects/wizard/preview-setup/apply',{method:'POST'});
  assert.equal(JSON.parse(captured.input).timeoutMilliseconds,20000);assert.equal(captured.timeout,30000);
  clock=operator.deadline-7000;
  await operator.request(operator.url+'/projects/wizard/preview-setup/preflight',{method:'POST'});
  assert.equal(JSON.parse(captured.input).timeoutMilliseconds,6000);assert.equal(captured.timeout,7000);
  clock=operator.deadline;
  await assert.rejects(()=>operator.request(operator.url+'/status'),/overall-timeout/);
}));
test('operator URLs must match the selected controller TLS configuration before credentials are retained',async()=>fixture(async root=>{
  let commands=0;
  const operator=new Operator(input(root),{command:()=>({status:0,stdout:JSON.stringify(++commands===1?[{Image:image,State:{Running:true}}]:
    {user:'fixture',password:'memory-only',gitlab:'https://gitlab.example.test',sync:'different.example.test',syncMode:'2',syncEnabled:'true'})})});
  await assert.rejects(()=>operator.prepare(),/exact-accepted-controller-failed/);
  assert.equal(commands,2);assert.equal(operator.secrets,undefined);
}));
const lifecycleFixture=require('./guided-preview-fixture');
test('new native failure classifications remain fixed and do not copy test or package error text',()=>{
  const diagnostics=require('./job-diagnostics'),marker='private-fixture-token';
  for(const [trace,code] of [
    ['ERROR: unable to select packages: docker-cli-compose breaks: world[docker-cli-compose=5.6.1-r0]','package-version-unavailable'],
    ['npm error code EUSAGE','npm-command-failed'],['Tests 2 failed | 19 passed','javascript-test-failed'],
    ['src/App.tsx: error TS2322: invalid','typecheck-failed'],["browserType.launch: Executable doesn't exist at /private/path",'browser-check-failed']]){
    const classified=diagnostics.classify(trace+' '+marker);assert(classified.codes.includes(code));
    assert(!JSON.stringify(classified).includes(marker));
  }
});
test('native failure details recognize only exact source-owned phases, files and suites',()=>{
  const diagnostics=require('./job-diagnostics');
  const file='wizard-src-components-docs-docs';
  const trace=[
    '2026-11-20T12:00:00.123456Z 00O \x1b[32m> vitest run\x1b[0m\x1b[0K',
    '2026-11-20T12:00:01.000Z 00E FAIL  src/components/docs/Docs.test.tsx > Docs reader > searches all chapters and lets readers clear or open a result',
    'FAIL src/components/docs/Docs.test.tsx',
    'FAIL src/components/docs/Docs.test.tsx > Docs reader',
    '#17 12.340 > node scripts/compile-docs-locales.mjs --check && node --test tests/offline/docs-locales.test.cjs',
    'not ok 1 - German docs compiler rejects stale, missing, summarized or technically changed translations',
    '> npm run build:config-export && node --test tests/offline/export-configuration.test.cjs',
    '✖ offline adapter executes actual Wizard models and writes a signed private backup without browser or network (246.738ms)',
    '> node --test tests/offline/delivery-recipe.test.cjs',
    '✖ failed owned-resource cleanup fails the otherwise successful build (1.2s)',
    'ERROR: Job failed: exit code 1'
  ].join('\n');
  const classified=diagnostics.classify(trace);
  assert.deepEqual(classified,{commands:[],codes:['javascript-test-failed'],
    phases:['unit-tests','docs-check','configuration-export','delivery-tests'],
    testFiles:[file],testSuites:['wizard-suite-offline-docs-locales',
      'wizard-suite-offline-export-configuration','wizard-suite-offline-delivery-recipe'],exitCode:1});
  assert.deepEqual(diagnostics.sanitize(classified),classified);
  for(const duration of ['0ms','246ms','12.125ms','2s'])
    assert.deepEqual(diagnostics.classify('✖ German docs compiler rejects stale, missing, summarized or technically changed translations ('+duration+')').testSuites,
      ['wizard-suite-offline-docs-locales']);
});
test('unknown files and commands are ignored while known file suffixes never enter retained IDs',()=>{
  const diagnostics=require('./job-diagnostics'),marker='private-fixture-token',url='https://'+marker+'@example.test';
  const lines=[marker,url,'> vitest run '+marker,'> vitest run && curl '+url,
    '$ echo "FAIL src/components/docs/Docs.test.tsx"',
    'PASS src/components/docs/Docs.test.tsx',
    'FAIL src/private.test.tsx > '+marker,
    'FAIL src/components/docs/Docs.test.tsx.private > '+marker,
    'FAIL src/components/docs/Docs.test.tsx '+marker,
    'not ok 1 - '+marker,
    'not ok 1 - German docs compiler rejects stale, missing, summarized or technically changed translations '+marker,
    'ok 1 - German docs compiler rejects stale, missing, summarized or technically changed translations',
    '✔ German docs compiler rejects stale, missing, summarized or technically changed translations (1ms)',
    '✖ '+marker+' (246ms)',
    '✖ offline adapter executes actual Wizard models and writes a signed private backup without browser or network (246ms) '+url];
  for(const line of lines) {
    const classified=diagnostics.classify(line);
    assert.equal(classified.phases,undefined);assert.equal(classified.testFiles,undefined);assert.equal(classified.testSuites,undefined);
    assert(!JSON.stringify(classified).includes(marker));assert(!JSON.stringify(classified).includes(url));
  }
  for(const suffix of [marker,url,'parameterized test case 42 > '+marker]) {
    const classified=diagnostics.classify('FAIL src/components/docs/Docs.test.tsx > '+suffix);
    assert.deepEqual(classified,{commands:[],codes:['javascript-test-failed'],testFiles:['wizard-src-components-docs-docs']});
    assert(!JSON.stringify(classified).includes(marker));assert(!JSON.stringify(classified).includes(url));
  }
  assert.deepEqual(diagnostics.sanitize({phases:['unit-tests',marker,url],testFiles:['wizard-src-docs-model',marker,url],
    testSuites:['wizard-suite-offline-docs-locales',marker,url],trace:marker}),
    {phases:['unit-tests'],testFiles:['wizard-src-docs-model'],testSuites:['wizard-suite-offline-docs-locales']});
});
test('test timeout classifications require an exact known failed test block and never retain durations',()=>{
  const diagnostics=require('./job-diagnostics');
  const fail='FAIL src/components/form-wizard/I18n.test.tsx > language changes preserve edited configuration, token visibility and generated output';
  for(const detail of ['Error: Test timed out in 5000ms.','Error: Hook timed out in 10000ms.']) {
    const classified=diagnostics.classify(fail+'\n'+detail);
    assert(classified.codes.includes('javascript-test-timeout'));
    assert.deepEqual(diagnostics.sanitize(classified),classified);
    assert(!JSON.stringify(classified).includes('5000'));assert(!JSON.stringify(classified).includes('10000'));
  }
  const tap="not ok 1 - coordinated export binds completed generation to exact ENV bytes through ordinary ZIP exporter\n  ---\n  failureType: 'testTimeoutFailure'\n  error: 'test timed out after 5000ms'";
  assert(diagnostics.classify(tap).codes.includes('javascript-test-timeout'));
  for(const trace of ['Error: Test timed out in 5000ms.',fail+'\nAssertionError: mismatch',
    'FAIL src/private.test.tsx > unknown\nError: Test timed out in 5000ms.',
    fail+'\nError: Test timed out in 5000ms. private-fixture-token',
    fail+'\n'+Array(12).fill('unrelated').join('\n')+'\nError: Test timed out in 5000ms.'])
    assert(!diagnostics.classify(trace).codes.includes('javascript-test-timeout'));
});
test('actual trace transports stream a bounded suffix from long jobs while other response limits stay enforced',async()=>{
  const {EventEmitter}=require('node:events'),vm=require('node:vm');
  const {Candidate}=require('./disposable-candidate'),recovery=require('../e2e/recovery');
  const {requestScript}=require('../e2e/guided-preview-live');
  const marker='private-fixture-trace-text',ending='\nAssertionError: '+marker+'\nERROR: Job failed: exit code 1\n';
  const body='x'.repeat(600000)+ending,retained=[];
  let responseBody=body;
  const execute=(script,input)=>new Promise((resolve,reject)=>{
    const stdin=new EventEmitter();let failed=false;
    const runtime={stdin,stdout:{write:value=>resolve(value)}};
    Object.defineProperty(runtime,'exitCode',{set:value=>{if(value)reject(Error('private-transport-failed'));}});
    const transport={request:(...args)=>{
      const callback=args.at(-1),request=new EventEmitter();
      request.destroy=()=>{failed=true;request.emit('error',Error(marker));};
      request.end=()=>{
        const response=new EventEmitter();response.statusCode=200;response.headers={};response.socket={getPeerCertificate:()=>({serialNumber:'AA'})};
        callback(response);
        for(let offset=0;offset<responseBody.length&&!failed;offset+=16384)response.emit('data',Buffer.from(responseBody.slice(offset,offset+16384)));
        if(!failed)response.emit('end');
      };
      return request;
    }};
    vm.runInNewContext(script,{process:runtime,URL,AbortSignal,Buffer:{concat:Buffer.concat,from:value=>{
      const buffer=Buffer.from(value);retained.push(buffer.length);assert(buffer.length<=65536);return buffer;
    }},require:name=>['http','https','node:https'].includes(name)?transport:name==='fs'?{readFileSync:()=>Buffer.from('fixture-ca')}:require(name)});
    stdin.emit('data',typeof input==='string'?input:JSON.stringify(input));stdin.emit('end');
  });
  const candidate={inner:async(args,options)=>args[0]==='inspect'?JSON.stringify({bridge:{Gateway:'172.17.0.1'}}):execute(args.at(-1),options.input)};
  const route='/api/v4/projects/2/jobs/310/trace';
  for(const read of [
    path=>Candidate.prototype.httpFromCandidate.call(candidate,'http://gitlab.candidate.test'+path,{method:'GET'}),
    path=>recovery.tlsProbe(candidate,'gitlab.candidate.test',path,{method:'GET'}),
    async path=>JSON.parse(await execute(requestScript,{url:'https://gitlab.example.test'+path,options:{method:'GET'},timeoutMilliseconds:10000}))]){
    retained.length=0;responseBody=body;
    const response=await read(route);assert.equal(Buffer.byteLength(response.body),65536);assert(response.body.endsWith(ending));
    assert(retained.length>1&&Math.max(...retained)<=65536);
    assert.deepEqual(require('./job-diagnostics').classify(response.body),{commands:[],codes:['javascript-test-failed'],exitCode:1});
    responseBody='x'.repeat(8000001);
    await assert.rejects(()=>read('/api/v4/projects/2/jobs/310'),/transport-failed/);
    await assert.rejects(()=>read('/api/v4/projects/2/jobs/not-numeric/trace'),/transport-failed/);
  }
});test('operator tool is read-only and accepts explicit shared-source settings',async()=>fixture(async root=>{
  const filename=path.join(root,'input.json');fs.writeFileSync(filename,JSON.stringify(input(root)),{mode:0o600});
  assert.equal(readInput(filename).settings.version,2);
  await assert.rejects(()=>require('../e2e/guided-preview-live').main(['--apply',filename]),/check-only/);
  fs.chmodSync(filename,0o644);assert.throws(()=>readInput(filename),/private-regular-input/);
}));
test('disposable fixture cannot be selected on an operator platform',()=>{
  assert.throws(()=>adapter.settings({id:'a'.repeat(24),spec:{operatorAcceptance:true,guidedPreviewAcceptance:true,guidedPreviewSettings:desired}}),/owned-disposable/);
});
