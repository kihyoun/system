'use strict';
// Socket-free compatibility decisions and the real Nest/CLI inspection boundary.
const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {hostFacts,assess,version,logPolicy}=require('../../dist/modules/host-bootstrap/inspectionPolicy');
const {HostInspectionService}=require('../../dist/modules/host-bootstrap/inspection.service');
const {ProcessFailure}=require('../../dist/common/runtime/process');
const {inspectHost}=require('../../dist/modules/host-bootstrap/inspectionCli');
const root=path.resolve(__dirname,'../..'), image='example/mongo@sha256:'+'a'.repeat(64);
const facts=(signature='Ubuntu 7.0.0-30.30-generic 7.0.12',flags='avx sse2')=>hostFacts('7.0.0-30-generic',signature,'flags : '+flags,'x86_64',true);
const linux=(kernel='6.8.0')=>hostFacts(kernel,'','flags : avx','x86_64',false);
const codes=(facts,mongo='8.0.37')=>assess(facts,version(mongo)).map(item=>item.code);

test('Ubuntu upstream evidence, all CPUs and reviewed kernel/server boundaries fail closed',()=>{
  assert.equal(facts().upstreamKernel,'7.0.12');
  const matrix=[
    [facts(),'8.0.37',['kernel-mongodb-incompatible']],
    [facts(undefined,'sse2'),'8.0.37',['cpu-avx-missing','kernel-mongodb-incompatible']],
    [facts(),'7.0.48',[]], [facts(),'8.0.20',['kernel-mongodb-incompatible']],
    [hostFacts('6.8.0','','flags : avx sse2\nflags : sse2\n','x86_64',false),'8.0.37',['cpu-avx-missing']],
    ...[['6.18.99',[]],['6.19.0',['kernel-mongodb-incompatible']],['7.0.13',['kernel-mongodb-incompatible']],['7.0.14',[]],['7.1.0',[]]].map(([kernel,expected])=>[linux(kernel),'8.0.37',expected]),
    ...[['8.0.36',['mongodb-patch-required']],['8.0.37',[]],['8.3.15',['mongodb-patch-required']],['8.3.16',[]],['9.0.3',['mongodb-patch-required']],['9.0.4',[]],['8.1.0',['mongodb-version-unreviewed']]].map(([mongo,expected])=>[facts('Ubuntu 7.0.0-30.30-generic 7.0.14'),mongo,expected]),
    ...['','Ubuntu malformed','Ubuntu 6.8.0-20.20-generic 7.0.14','Ubuntu 7.0.0-29.29-generic 7.0.14'].map(signature=>[facts(signature),'8.0.37',['kernel-version-unknown']]),
    [{...facts(),architecture:'aarch64'},'8.0.37',['unsupported-architecture','kernel-mongodb-incompatible']],
  ];
  for(const [host,mongo,expected] of matrix) assert.deepEqual(codes(host,mongo),expected);
  for(const invalid of ['latest','8.0.37\n','8.0.99999999999999999999']) assert.throws(()=>version(invalid));
});

test('exact image probe diagnoses failures and cleans up only its own bounded container',async()=>{
  for(const [status,output,code] of [[0,'db version v8.0.37','image-probe-passed'],[1,'12257600 incompatible kernel','image-kernel-rejected'],[132,'Illegal instruction','image-illegal-instruction'],[127,'mongod executable not found','image-execution-failed'],[0,'unexpected wrapper output','image-version-unrecognized']]) {
    const calls=[];
    const service=new HostInspectionService({async run(binary,args,options){
      calls.push(args);assert.equal(binary,'docker');
      if(args.includes('run')) { options.output(Buffer.from(output)); if(status) throw new ProcessFailure(binary,status,null,false); return output; }
      if(args.includes('inspect')) return args.at(-1);
      return '';
    }});
    const result=await service.probe(image,10,{});assert.equal(result.code,code);
    if(!status && code==='image-probe-passed') assert.equal(result.mongodbVersion,'8.0.37');
    const invocation=calls[0];
    for(const arg of ['--read-only','--cap-drop','--memory','--cpus','--pids-limit','--log-driver']) assert(invocation.includes(arg));
    assert.equal(invocation[invocation.indexOf('--pull')+1],'never');assert.equal(invocation[invocation.indexOf('--network')+1],'none');
    assert.deepEqual(invocation.slice(-2),[image,'--version']);assert(!invocation.includes('--volume'));assert(!invocation.includes('--mount'));
    assert.deepEqual(calls.at(-1).slice(-3,-1),['rm','-f']);
  }
  for(const ownership of ['foreign','missing']) {
    const calls=[];const service=new HostInspectionService({async run(binary,args){calls.push(args);if(args.includes('inspect')) {if(ownership==='missing')throw new ProcessFailure(binary,1,null,false);return 'other-owner';}return 'db version v8.0.37';}});
    await service.probe(image,10,{});assert.equal(calls.length,2);assert(!calls.some(args=>args.includes('rm')));
    await assert.rejects(service.probe('mongo:latest',10,{}),/immutable/);
  }
  const calls=[];
  const waiting=new HostInspectionService({async run(binary,args,options){calls.push({args,options});if(args.includes('run'))return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new ProcessFailure(binary,null,'SIGTERM',true)),{once:true}));if(args.includes('inspect'))return args.at(-1);return '';}});
  assert.equal((await waiting.probe(image,1,{})).code,'image-probe-timeout');
  assert.equal(calls.at(-1).options.signal,undefined,'cleanup must survive probe cancellation');
  const abort=new AbortController();const pending=waiting.probe(image,10,{},abort.signal);abort.abort();await assert.rejects(pending,ProcessFailure);
  assert.deepEqual(calls.at(-1).args.slice(-3,-1),['rm','-f']);
});

test('preflight skips unsafe image execution, checks executable version and distinguishes planned host',async()=>{
  for(const [host,expected,count] of [[linux(),'image-version-mismatch',1],[facts(),'kernel-mongodb-incompatible',0]]) {
    const service=new HostInspectionService();let calls=0;service.facts=()=>host;
    service.probe=async()=>{calls++;return {code:'image-probe-passed',mongodbVersion:'8.0.36'};};
    const result=await service.preflight({mongodbVersion:'8.0.37',image},{});
    assert.equal(result.ok,false);assert(result.findings.some(row=>row.code===expected));assert.equal(calls,count);
  }
  const service=new HostInspectionService();service.facts=()=>facts();
  const planned=await service.preflight({mongodbVersion:'8.0.37',plannedKernel:'7.0.14'},{});
  assert.equal(planned.ok,true);assert.equal(planned.scope,'planned-kernel');
  for(const [options,env] of [[{plannedKernel:'7.0.14',image},{}],[{timeout:0},{}],[{timeout:121},{}],[{timeout:1.5},{}],[{}, {DOCKER_HOST:'tcp://remote'}],[{}, {DOCKER_CONTEXT:'other'}]])
    await assert.rejects(service.preflight({mongodbVersion:'8.0.37',...options},env));
});

test('bounded log policy inspects exact containers and rejects invalid selectors before any I/O',async()=>{
  assert.deepEqual(logPolicy(),{Type:'json-file',Config:{'max-size':'10m','max-file':'3'}});
  assert.deepEqual(logPolicy('64K','2').Config,{'max-size':'64k','max-file':'2'});
  for(const [size,count] of [['0m','3'],['-1','3'],['10m','0'],['10m','101'],['10m','1.5'],['10m\n','3'],['10m','3\n']]) assert.throws(()=>logPolicy(size,count));
  for(const [actual,matches] of [[logPolicy(),true],[{Type:'json-file',Config:{}},false],[{Type:'journald',Config:{}},false]]) {
    const calls=[];const service=new HostInspectionService({async run(binary,args){calls.push(args);return JSON.stringify(actual);}});
    assert.equal((await service.logging(['owned-app'],undefined,undefined,{})).ok,matches);
    assert.deepEqual(calls[0].slice(2,4),['container','inspect']);assert.equal(calls[0].at(-1),'owned-app');assert.equal(calls.length,1);
    await assert.rejects(service.logging(['--all'],undefined,undefined,{}));assert.equal(calls.length,1);
    assert.equal((await service.logging([],undefined,undefined,{})).ok,true);assert.equal(calls.length,1);
  }
});

test('Nest provider and public CLI preserve JSON, policy environment and diagnostic exit codes',async()=>{
  const {NestFactory}=require('../../node_modules/@nestjs/core');
  const {HostBootstrapModule}=require('../../dist/modules/host-bootstrap/hostBootstrap.module');
  const app=await NestFactory.createApplicationContext(HostBootstrapModule,{logger:false,abortOnError:false});
  try {assert(app.get(HostInspectionService) instanceof HostInspectionService);} finally {await app.close();}
  for(const [args,env,status] of [[[],{SYSTEM_LOG_MAX_SIZE:'64K',SYSTEM_LOG_MAX_FILES:'2'},0],[['--max-files','0'],{},2],[['--unknown'],{},2]]) {
    const result=spawnSync(process.execPath,['dist/cli/main.js','host-bootstrap','log-policy','--checkout',root,...args],{cwd:root,encoding:'utf8',env:{...process.env,...env}});
    assert.equal(result.status,status,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.ok,status===0);
    if(!status) assert.deepEqual(report.expected.Config,{'max-size':'64k','max-file':'2'});
  }
  const original=console.log,exit=process.exitCode,output=[];console.log=value=>output.push(JSON.parse(value));
  try {
    const service=new HostInspectionService({async run(){throw new Error('private-daemon-output');}});
    await inspectHost(service,'log-policy',['owned-app'],{});assert.equal(process.exitCode,2);assert(!JSON.stringify(output).includes('private-daemon-output'));
    service.facts=()=>facts();await inspectHost(service,'container-preflight',['--mongodb-version','8.0.37'],{});assert.equal(process.exitCode,1);assert.equal(output.at(-1).ok,false);
  } finally {console.log=original;process.exitCode=exit;}
});
