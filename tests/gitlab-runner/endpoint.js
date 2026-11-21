const assert = require('assert');
const {stableEndpoint} = require('../../dist/modules/lifecycle/runner.service');
const config = '[[runners]]\n  url = "http://172.19.0.2/"\n  clone_url = "http://172.19.0.2/"\n  token = "glrt-test-only"\n  [runners.docker]\n    network_mode = "system_gitlab"\n';
const updated = stableEndpoint(config);
assert(updated.includes('url = "http://gitlab/"'));
assert(updated.includes('clone_url = "http://gitlab/"'));
assert(updated.includes('token = "glrt-test-only"'));
assert.equal(stableEndpoint(updated), updated);
assert.equal(stableEndpoint(config.replace(/172.19.0.2/g, 'external.example.com')), config.replace(/172.19.0.2/g, 'external.example.com'));
assert.equal(stableEndpoint(config.replace('system_gitlab', 'unmanaged')), config.replace('system_gitlab', 'unmanaged'));
console.log('Managed runner endpoint migration preserves tokens, external URLs and unrelated networks.');

const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {RunnerComposeService}=require('../../dist/modules/lifecycle/runner-compose.service');
const {RunnerLifecycleService}=require('../../dist/modules/lifecycle/runner.service');
const {ProcessFailure}=require('../../dist/common/runtime/process');
(async()=>{
 for(const failure of ['', 'copy', 'rename', 'cancel']){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'runner-endpoint-test-'));
  const target=path.join(directory,'config.toml'),calls=[];fs.writeFileSync(target,config,{mode:0o600});
  const context={root:path.resolve(__dirname,'../..'),state:directory,environment:process.env};
  const child={async run(binary,args,options){
   calls.push({binary,args,options});assert.equal(binary,'docker');assert(!args.includes('sh'));
   const map=remote=>path.join(directory,path.basename(remote));
   if(args.includes('cat'))return fs.readFileSync(target,'utf8');
   if(args[0]==='cp'){
    assert.equal(fs.statSync(args[1]).mode&0o777,0o600);
    assert.equal(fs.statSync(path.dirname(args[1])).mode&0o777,0o700);
    fs.copyFileSync(args[1],map(args[2].split(':')[1]));
    if(failure==='copy')throw new ProcessFailure('docker',1,null,false);
    if(failure==='cancel')throw new ProcessFailure('docker',null,'SIGTERM',true);
   }else if(args.includes('mv')){
    if(failure==='rename')throw new ProcessFailure('docker',1,null,false);
    fs.renameSync(map(args.at(-2)),map(args.at(-1)));
   }else if(args.includes('rm'))fs.rmSync(map(args.at(-1)),{force:true});
   else throw Error('Unexpected transport');
   return '';
  }};
  const service=new RunnerLifecycleService(child,{}, {},new RunnerComposeService());
  try {
   if(failure)await assert.rejects(service.refreshEndpoint(context,'runner_docker_1'),ProcessFailure);
   else await service.refreshEndpoint(context,'runner_docker_1');
   assert.equal(fs.readFileSync(target,'utf8'),failure?config:updated);
   assert.equal(fs.statSync(target).mode&0o777,0o600);
   const copy=calls.find(call=>call.args[0]==='cp');assert(!fs.existsSync(copy.args[1]));
   assert(!JSON.stringify(calls.map(call=>call.args)).includes('glrt-test-only'));
   assert.equal(fs.readdirSync(directory).filter(name=>name.startsWith('config.toml.endpoint-')).length,failure==='cancel'?1:0);
   if(!failure){calls.length=0;await service.refreshEndpoint(context,'runner_docker_1');assert.equal(calls.length,1);}
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
 console.log('Native endpoint replacement preserves private modes, tokens and prior bytes on failure; cancellation retains its owned remote temporary file.');
})().catch(error=>{console.error(error);process.exitCode=1;});
