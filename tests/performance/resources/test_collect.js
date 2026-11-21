'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ResourceCollectorService,quantity,pair,number,summary,role,runnerSettings}=require('../../../operations/dist/resources/collector.service');
const {ObservationProcess,ObservationFailure}=require('../../../operations/dist/resources/process');
const {ResourceBenchmarkService,inputManifest}=require('../../../operations/dist/resources/benchmark.service');
const {WindowsResourceService}=require('../../../operations/dist/resources/windows.service');
const root=path.resolve(__dirname,'../../..');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function directory(t){const value=fs.mkdtempSync(path.join(os.tmpdir(),'resources-offline-'));t.after(()=>fs.rmSync(value,{recursive:true,force:true}));return value;}
class FixtureCollector extends ResourceCollectorService{
 linux(){return {memoryUsedFromAvailableBytes:100};}cgroup(){return null;}
 async run(args,metric){const identity='a'.repeat(64);assert(!args.includes('sh'));
  if(metric==='docker-info')return JSON.stringify({serverVersion:'29.8.0',architecture:'x86_64',logicalCpus:4,memoryTotalBytes:1024,cgroupVersion:'2',private:'SECRET'});
  if(metric==='docker-inventory')return identity+'\n'+'b'.repeat(64);
  if(metric==='docker-stats')return JSON.stringify({ID:identity,Name:'PRIVATE',MemUsage:'2MiB / 1GiB',CPUPerc:'20.2%',NetIO:'1kB / 2kB',BlockIO:'0B / 0B',PIDs:'4'});
  if(metric==='container-inspect')return JSON.stringify({name:'/system_gitlab-runner_SECRET',pid:12,imageConfigDigest:'sha256:'+'c'.repeat(64),running:true,oomKilled:false,memoryLimitBytes:0,memorySwapLimitBytes:-1,nanoCpuLimit:0,restartCount:0,exitCode:0,env:['TOKEN=SECRET']});
  if(metric==='runner-concurrency')return 'concurrent = 2\nlimit = 1\nrequest_concurrency = 3\ntoken = "SECRET"\n';
  throw Error(metric);
 }
}
test('passive metrics retain sanitized schema, inventory bounds, literal units and incomplete coverage',async()=>{
 const {NestFactory}=require('../../../operations/node_modules/@nestjs/core'),{ResourcesModule}=require('../../../operations/dist/resources/resources.module');
 const app=await NestFactory.createApplicationContext(ResourcesModule,{logger:false});assert(app.get(ResourceCollectorService));await app.close();
 assert.equal(quantity('1.5GiB'),1610612736);assert.deepEqual(pair('1kB / 2KiB'),[1000,2048]);
 for(const value of ['NaN','Infinity','-1','SECRET','0x10',null,{},'']){assert.equal(number(value),null);assert.equal(quantity(value),null);}
 assert.equal(role('runner-TOKEN-project-4-concurrent-0'),'ci-job');assert.deepEqual(runnerSettings('token="SECRET"\nconcurrent=4\nlimit=-1'),{concurrent:[4],limit:[],request_concurrency:[]});
 const sample=await new FixtureCollector(undefined,12,1).sample(),text=JSON.stringify(sample);
 for(const secret of ['SECRET','PRIVATE','TOKEN','a'.repeat(64),'system_gitlab'])assert(!text.includes(secret));
 assert(sample.inventoryTruncated);assert(sample.startedAt<=sample.completedAt);const row=sample.containers[0];assert(row.memorySwapUnlimited);assert.equal(row.memorySwapLimitBytes,null);assert.deepEqual(row.runnerConcurrency.concurrent,[2]);assert.equal(row.dockerCli.memoryUsageExcludingCacheBytesApprox,2097152);assert.equal(summary([sample]).productionSizingReady,false);
 const complete=structuredClone(sample);sample.containers.push({role:'runner-manager',dockerCli:{memoryUsageExcludingCacheBytesApprox:null}});
 const result=summary([sample,complete]);assert.equal(result.sampledRoleWorkingSetMaximumBytesApprox['runner-manager'],null);assert.deepEqual(result.roleMemoryCoverage['runner-manager'],{containerObservations:3,measuredObservations:2,incompleteSamples:1});
});
test('bounded command transport redacts errors, bounds both streams and kills only owned descendants on timeout/cancellation',async t=>{
 const transport=new ObservationProcess(),subject=new ResourceCollectorService(transport),folder=directory(t);
 subject.deadline=performance.now()+3000;assert.equal(await subject.run(['/nonexistent/SECRET'],'fixture'),null);assert.deepEqual(subject.unavailable,['fixture:command-unavailable']);subject.deadline=0;assert.equal(await subject.run(['never-start'],'expired'),null);assert(subject.unavailable.includes('expired:sample-budget'));
 assert.equal(await transport.run([process.execPath,'-e','console.log("metric");console.error("SECRET")'],3000),'metric\n');
 for(const stream of ['stdout','stderr','combined']){const program=stream==='combined'?'process.stdout.write("x".repeat(1100000));process.stderr.write("x".repeat(1100000));setInterval(()=>{},1000)':`process.${stream}.write('x'.repeat(2100000));setInterval(()=>{},1000)`;await assert.rejects(transport.run([process.execPath,'-e',program],3000),error=>error instanceof ObservationFailure&&error.reason==='output-limit');}
 for(const cancel of [false,true]){
  const marker=path.join(folder,cancel?'cancelled-survived':'timeout-survived'),pidfile=marker+'.pid';
  const child=marker+'.child.cjs',parent=marker+'.parent.cjs';
  fs.writeFileSync(child,"setTimeout(()=>require('node:fs').writeFileSync(process.argv[2],'survived'),1200)");
  fs.writeFileSync(parent,"const child=require('node:child_process').spawn(process.execPath,[process.argv[2],process.argv[3]],{stdio:'ignore'});require('node:fs').writeFileSync(process.argv[4],String(child.pid));setInterval(()=>{},1000)");
  const abort=new AbortController(),started=performance.now();const operation=transport.run([process.execPath,parent,child,marker,pidfile],cancel?3000:250,abort.signal),failure=assert.rejects(operation,error=>error.reason===(cancel?'cancelled':'command-timeout'));
  if(cancel){for(let i=0;i<100&&!fs.existsSync(pidfile);i++)await wait(10);assert(fs.existsSync(pidfile));abort.abort();}
  await failure;assert(performance.now()-started<2000);await wait(1250);assert(!fs.existsSync(marker));
 }
});
test('local cgroup reads require matching daemon identity and reject unrelated PID namespace',t=>{
 const folder=directory(t),proc=path.join(folder,'proc'),groups=path.join(folder,'cgroups');fs.mkdirSync(path.join(proc,'1'),{recursive:true});fs.mkdirSync(groups);fs.writeFileSync(path.join(proc,'1/cgroup'),'0::/unrelated\n');
 const collector=new ResourceCollectorService(undefined,12,32,proc,groups);assert.equal(collector.cgroup(1,'a'.repeat(64)),null);
 const relative='docker-'+'a'.repeat(64);fs.mkdirSync(path.join(groups,relative));fs.writeFileSync(path.join(proc,'1/cgroup'),'0::/'+relative+'\n');fs.writeFileSync(path.join(groups,relative,'memory.current'),'123');assert.equal(collector.cgroup(1,'a'.repeat(64)).memoryCurrentBytes,123);assert.equal(collector.cgroup(0,'a'.repeat(64)),null);
});
test('Windows orchestration refuses stopped WSL and reports allowlisted physical metrics without starting workloads',async()=>{
 const linux=await new FixtureCollector(undefined,12,1).sample(),calls=[];
 const transport={async run(args){calls.push(args);assert(!args.includes('python3'));if(args[0]==='wsl.exe'){
  if(args.includes('--list'))return 'Ubuntu\n';if(args.includes('wslpath'))return '/work/operations/dist/resources/entry.js';return JSON.stringify({schemaVersion:1,samples:[linux]});
 }const command=args.at(-1);assert(command.includes('Get-CimInstance'));
 if(command.includes('Win32_OperatingSystem'))return JSON.stringify({TotalVisibleMemorySize:100,FreePhysicalMemory:30,SECRET:'private'});
 if(command.includes('Win32_ComputerSystem'))return '{"NumberOfLogicalProcessors":4}';
 if(command.includes('Win32_PerfFormattedData'))return '{"PercentProcessorTime":12}';
 if(command.includes('Win32_PageFileUsage'))return '[{"AllocatedBaseSize":8,"CurrentUsage":2,"PeakUsage":3}]';
 return '{"Size":1000,"FreeSpace":300}';
 }};
 const options={samples:1,interval:1,budget:3,maxContainers:1,distribution:'Ubuntu',backingVolume:'E:',linuxNode:'/prepared/node'};
 const result=await new WindowsResourceService(transport).collect(options);assert.equal(result.samples[0].windows.memory.totalBytes,102400);assert.equal(result.samples[0].windows.physicalVolumes.length,2);assert(!JSON.stringify(result).includes('SECRET'));assert(calls.some(args=>args.includes('/prepared/node')));
 let invoked=0;await assert.rejects(new WindowsResourceService({run:async()=>{invoked++;return 'Other';}}).collect(options),/not-running/);assert.equal(invoked,1);
});
test('native benchmark validates reviewed runtime inputs before work and cleans only operation-owned resources',async t=>{
 const folder=directory(t),base={case:'react',templates:path.join(root,'project-bootstrap/templates'),sourceRevision:'a'.repeat(40),output:path.join(folder,'plan'),execute:false};let calls=[],operation='';
 const transport={async run(args,timeout,signal,output){calls.push(args);assert.deepEqual(args.slice(0,2),['docker','--host=unix:///var/run/docker.sock']);assert(timeout<=240000);if(args.includes('create')&&args.includes('buildx')){operation=args[args.indexOf('--name')+1].slice('resource-'.length);return '';}
 if(args.includes('build')&&args.includes('buildx')){output?.(Buffer.from('fixture build\n'));return '';}
 if(args.includes('inspect'))return JSON.stringify({Id:'b'.repeat(64),Config:{Labels:{'system.resource.benchmark.operation':operation}}});
 if(args[2]==='create')return 'b'.repeat(64);if(args[2]==='image'&&args[3]==='ls')return 'image';return '';}};
 const collector={sample:async()=>new FixtureCollector(undefined,12,1).sample()},service=new ResourceBenchmarkService(transport,collector);
 const plan=await service.execute(base);assert.equal(calls.length,0);assert(plan.publicRuntimeInputs.some(input=>input.path.endsWith('project-ci.cjs')));assert(!JSON.stringify(plan).includes('refresh-ca.sh'));
 await assert.rejects(service.execute({...base,execute:true,leaseDeadline:Date.now()/1000+120},{}),/lease-required/);assert.equal(calls.length,0);
 await assert.rejects(service.execute({...base,execute:true,leaseDeadline:Date.now()/1000+120},{SYSTEM_RESOURCE_BENCHMARK_APPROVED:'1',DOCKER_HOST:'remote'}),/native-local/);
 const result=await service.execute({...base,output:path.join(folder,'execute'),execute:true,leaseDeadline:Date.now()/1000+120},{SYSTEM_RESOURCE_BENCHMARK_APPROVED:'1'});assert.equal(result.success,true);assert.equal(result.cleanup,'passed');assert.equal(calls.filter(args=>args.includes('build')&&args.includes('buildx')).length,2);assert(calls.some(args=>args[2]==='rm'&&args.at(-1)==='b'.repeat(64)));assert(!calls.some(args=>args.includes('prune')));const evidence=JSON.parse(fs.readFileSync(path.join(folder,'execute/evidence.json')));assert.equal(evidence.builds.length,2);assert.equal(evidence.staticHttpSmoke,true);
 calls=[];
 const foreign=new ResourceBenchmarkService({run:async(args,...rest)=>args.includes('inspect')?JSON.stringify({Id:'b'.repeat(64),Config:{Labels:{'system.resource.benchmark.operation':'foreign'}}}):transport.run(args,...rest)},collector);
 await assert.rejects(foreign.execute({...base,output:path.join(folder,'foreign'),execute:true,leaseDeadline:Date.now()/1000+120},{SYSTEM_RESOURCE_BENCHMARK_APPROVED:'1'}),/ownership-changed/);
 assert(!calls.some(args=>args[2]==='image'&&args[3]==='rm'),'foreign images must remain untouched');
 assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'foreign/evidence.json'))).cleanup,'failed');
 let buildSettled=false;
 const interrupted=new ResourceBenchmarkService({async run(args,timeout,signal){
  if(args.includes('build')&&args.includes('buildx'))return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{buildSettled=true;reject(new ObservationFailure('cancelled'));},{once:true}));
  if(args.includes('rm')||args.includes('ls'))assert(buildSettled,'owned build must settle before cleanup');
  return '';
 }},{sample:async()=>{throw Error('fixture-sampler-failed');}});
 await assert.rejects(interrupted.execute({...base,output:path.join(folder,'interrupted'),execute:true,leaseDeadline:Date.now()/1000+120},{SYSTEM_RESOURCE_BENCHMARK_APPROVED:'1'}),/sampler-failed/);assert(buildSettled);
 const input=path.join(folder,'input');fs.mkdirSync(input);fs.writeFileSync(path.join(input,'.env'),'PRIVATE');assert.throws(()=>inputManifest(input),/private/);fs.unlinkSync(path.join(input,'.env'));fs.symlinkSync('/etc/passwd',path.join(input,'link'));assert.throws(()=>inputManifest(input),/type-refused/);
});
