'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {LifecycleService}=require('../../dist/modules/lifecycle/lifecycle.service');
const {RootPasswordService}=require('../../dist/modules/lifecycle/root-password.service');
const {RunnerComposeService}=require('../../dist/modules/lifecycle/runner-compose.service');
const {RunnerLifecycleService}=require('../../dist/modules/lifecycle/runner.service');
const {ManagedChildProcess}=require('../../dist/common/runtime/managed-child');
const {NativeProcessRunner,ProcessFailure}=require('../../dist/common/runtime/process');
const {LiteralConfiguration}=require('../../dist/modules/projects-routing/ports');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'typed-lifecycle-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const folder of ['config/system/.projects.env','state','config/gitlab','wizard','config/gitlab-runner','gitlabConfig','gitlabData','syncTemplates'])fs.mkdirSync(path.join(root,folder),{recursive:true});
 const config='SYNC_ENABLE=true\nWIZARD_ENABLE=true\nGITLAB_HOST=gitlab.example.test\nGITLAB_REGISTRY_DOMAIN_MODE=0\nGITLAB_REGISTRY_URL=http://registry.example.test\nGITLAB_EXTERNAL_URL=http://gitlab.example.test\nGITLAB_RUNNER_SCALE=1\nPERSISTENT_DIR=' + path.join(root,'data') + '\nGITLAB_RUNNER_TOKEN=glrt-fixture\n';
 fs.writeFileSync(path.join(root,'config/system/.docker.env'),config);fs.writeFileSync(path.join(root,'state/.docker.env'),config);fs.writeFileSync(path.join(root,'config/system/.seed.env'),'SEED_DIR=/seed\n');fs.writeFileSync(path.join(root,'state/sync-auth.env'),'SYNC_USER=generated\nSYNC_PASS=private\n');
 fs.writeFileSync(path.join(root,'config/gitlab/.docker.env'),'GITLAB_IP=127.0.0.2\n');fs.writeFileSync(path.join(root,'.docker.env'),'BOOTSTRAPPER_IP=127.0.0.1\n');fs.writeFileSync(path.join(root,'wizard/.docker.env'),'WIZARD_IP=127.0.0.3\n');fs.writeFileSync(path.join(root,'config/gitlab/gitlab.rb'),'external_url "${GITLAB_EXTERNAL_URL}"\n');
 fs.mkdirSync(path.join(root,'templates/nginx'),{recursive:true});fs.writeFileSync(path.join(root,'templates/nginx/default.sync.template'),'server { listen 80; }\n');
 fs.writeFileSync(path.join(root,'config/gitlab/security-release.json'),JSON.stringify({runner:{helperImage:'helper@sha256:'+'a'.repeat(64)}}));
 const read = fs.readFileSync;
 t.mock.method(fs,'readFileSync',(file,...args)=>file==='/proc/self/mountinfo' ? '1 0 0:1 / '+path.join(root,'state')+' rw - tmpfs tmpfs rw\n' : read(file,...args));
 fs.copyFileSync(path.resolve(__dirname,'../../config/gitlab-runner/docker-compose.yml'),path.join(root,'config/gitlab-runner/docker-compose.yml'));
 const calls=[],children={async run(binary,args,options){calls.push({binary,args,options});return args[0]==='inspect'?'127.0.0.2\n':'';}};
 const configuration=new LiteralConfiguration(),routing={run(value){calls.push({route:value.action});}},runners={async runPools(context,action){calls.push({runner:action});}};
 const context={root,state:path.join(root,'state'),environment:{...process.env,SYSTEM_CONFIG_DIR:path.join(root,'state')}};
 const recovery={async recover(options){calls.push({recovery:options});return {state:'available'};}};
 const rootPassword=new RootPasswordService(),publicSettings={publishMounted(state,directory){assert.equal(state,context.state);assert.equal(directory,'/wizard-public');assert(fs.existsSync(path.join(state,'.storage-operation-lock/startup-owner.json')));assert(fs.lstatSync(path.join(root,'config/system/.docker.env')).isSymbolicLink());calls.push({settings:'published'});}};
 const paths=Object.fromEntries(['gitlabConfig','gitlabData','syncTemplates'].map(name=>[name,path.join(root,name)]));
 return {root,calls,children,configuration,routing,runners,recovery,context,service:new LifecycleService(children,configuration,routing,runners,recovery,rootPassword,publicSettings,paths)};
}
test('runner failure leaves Wizard startup available, while registry recovery failure prevents downstream writers',async t=>{
 const f=fixture(t);f.runners.runPools=async()=>{f.calls.push({runner:'failed'});throw Error('registration failed');};
 await f.service.intermediate(f.context,true);
 assert(f.calls.find(call=>call.route==='proxies'));assert(f.calls.find(call=>call.args?.at(-1)==='wizard'));assert(f.calls.find(call=>call.recovery?.checkout===f.root));
 f.calls.length=0;f.recovery.recover=async()=>{throw Error('recovery failed');};
 await assert.rejects(f.service.intermediate(f.context,true),/recovery failed/);assert(!f.calls.some(call=>call.route==='proxies'||call.args?.at(-1)==='wizard'));
 const snapshot=path.join(f.root,'state/image.env'),compose=path.join(f.root,'config/system/docker-compose.yml');
 fs.writeFileSync(snapshot,'WIZARD_IMAGE=mutable\n');f.calls.length=0;
 await assert.rejects(f.service.applyWizardImage(f.context,snapshot,compose),/immutable/);assert.equal(f.calls.length,0);
 const image='wizard@sha256:'+'a'.repeat(64);
 fs.writeFileSync(snapshot,`WIZARD_IMAGE=${image}\nPRIVATE_SETTING='not-in-arguments'\n`);
 await f.service.applyWizardImage(f.context,snapshot,compose);
 assert.equal(f.calls[0].binary,'docker');assert.deepEqual(f.calls[0].args.slice(-6),['up','--no-deps','--pull','never','-d','wizard']);
 assert.equal(f.calls[0].options.env.WIZARD_IMAGE,image);assert(!f.calls[0].args.includes('not-in-arguments'));
});
test('startup orders mounted state and public settings before writers, settles lease before unlimited prebuilt Sync, then stops',async t=>{
 const f=fixture(t),original=f.children.run;
 f.children.run=async(binary,args,options)=>{
  if(args[1]==='api'){assert.equal(options.timeout,null);assert.equal(options.inherit,true);assert(!fs.existsSync(path.join(f.context.state,'.storage-operation-lock')));assert.equal(options.env.SYNC_PASS,'private');}
  return original(binary,args,options);
 };
 await f.service.run('start',f.context);
 const calls=f.calls.map(call=>call.args?.[1]==='api'?'api':call.args?.[0]||call.route||call.runner||call.settings);
 assert.equal(calls[0],'published');assert(calls.indexOf('api')>calls.indexOf('start'));assert(fs.existsSync(path.join(f.context.state,'.configuration-initialized')));assert(calls.includes('stop-proxies'));
 assert(!f.calls.some(call=>call.binary==='npm'||call.binary==='bash'));
});
test('interrupted startup retains barrier; completed startup failure can retry',async t=>{
 for(const uncertain of [false,true]){
  const f=fixture(t);f.children.run=async()=>{throw new ProcessFailure('fixture',uncertain?null:1,null,uncertain);};
  await assert.rejects(f.service.run('start',f.context));assert.equal(fs.existsSync(path.join(f.context.state,'.storage-operation-lock')),uncertain);
 }
});
test('shutdown attempts remaining owned services and reports a partial failure',async t=>{
 const f=fixture(t);f.runners.runPools=async()=>{throw Error('runner stop');};await assert.rejects(f.service.intermediate(f.context,false),AggregateError);
 assert(f.calls.some(call=>call.route==='stop-proxies'));assert(f.calls.some(call=>call.args?.at(-1)==='gitlab'));
});
test('runner lifecycle preserves registrations on stop, isolates pool definitions, and verifies existing registrations without tokens in argv',async t=>{
 const f=fixture(t),native=f.children.run;
 f.children.run=async(binary,args,options)=>{
  if(args.includes('cat'))return '[[runners]]\n  url = "http://172.1.2.3/"\n  network_mode = "system_gitlab"\n';
  return native(binary,args,options);
 };
 const service=new RunnerLifecycleService(f.children,f.configuration,{},new RunnerComposeService());
 await service.runPools(f.context,'start');assert(f.calls.some(call=>call.args?.includes('verify')));assert(!JSON.stringify(f.calls.map(call=>call.args)).includes('glrt-fixture'));
 for(const token of ['glrt-fixture','legacy-fixture']){
  f.calls.length=0;
  f.children.run=async(binary,args,options)=>{if(args.includes('grep'))throw new ProcessFailure('docker',1,null,false);return native(binary,args,options);};
  await service.register({...f.context,environment:{...f.context.environment,GITLAB_RUNNER_TOKEN:token,GITLAB_HOST:'gitlab.example.test',GITLAB_REGISTRY_HOST:'registry.example.test'}},'runner_docker_1','runner-docker');
  const registration=f.calls.find(call=>call.args.includes('register'));
  const variable=token.startsWith('glrt-')?'CI_SERVER_TOKEN':'REGISTRATION_TOKEN';
  assert.deepEqual(registration.args.slice(0,6),['exec','--env',variable,'runner_docker_1','gitlab-runner','register']);
  assert.equal(registration.options.env[variable],token);assert.equal(registration.options.input,undefined);
  assert.equal(registration.args.includes('--tag-list'),!token.startsWith('glrt-'));
  assert(!JSON.stringify(f.calls.map(call=>call.args)).includes(token));
  assert.equal(f.context.environment[variable],undefined,'private registration env must not mutate the caller');
 }
 f.children.run=native;
 f.calls.length=0;await service.runPools(f.context,'stop');assert(f.calls.some(call=>call.args?.includes('down')));assert(!f.calls.some(call=>call.args?.includes('unregister')||call.args?.includes('verify')));
 fs.writeFileSync(path.join(f.root,'config/system/.projects.env/.wizard.env'),'PROJECT_NAME=wizard\nPROJECT_TEMPLATE=wizard\nGITLAB_RUNNER_SCALE=1\n');
 for(const action of ['start','stop','register','unregister']){f.calls.length=0;await service.runPools(f.context,action,'projects');assert.equal(f.calls.length,0,'managed Wizard never gets a second project runner pool');}
});
test('managed foreground child has no time limit and cancellation kills only its owned process group',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'managed-child-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const runner=new ManagedChildProcess(),controller=new AbortController(),pidfile=path.join(root,'pid');
 const code=`const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000);`;
 const operation=runner.run(process.execPath,['-e',code,pidfile],{cwd:root,env:process.env,timeout:null,signal:controller.signal});
 const failed=assert.rejects(operation,error=>error instanceof ProcessFailure&&error.uncertain);
 for(let count=0;count<200&&!fs.existsSync(pidfile);count++)await new Promise(resolve=>setTimeout(resolve,10));
 assert(fs.existsSync(pidfile));const pid=Number(fs.readFileSync(pidfile));controller.abort();await failed;
 for(let count=0;count<100;count++){try{if(fs.readFileSync('/proc/'+pid+'/stat','utf8').split(' ')[2]==='Z')break;}catch{break;}await new Promise(resolve=>setTimeout(resolve,10));}
 try{assert.equal(fs.readFileSync('/proc/'+pid+'/stat','utf8').split(' ')[2],'Z');}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
 assert.equal(await runner.run(process.execPath,['-e','setTimeout(()=>process.stdout.write("ready"),150)'],{cwd:root,env:process.env,timeout:null}),'ready');
});

test('nested runner lifecycle requires identical upgrade owners and a live ancestor identity',t=>{
 const f=fixture(t),{inheritedUpgrade}=require('../../dist/modules/lifecycle/upgrade-lease');
 const operation='b'.repeat(32),owner={format:'system-gitlab-upgrade-lock-v1',operation,pid:process.pid,start:fs.readFileSync('/proc/self/stat','utf8').split(' ').at(21)};
 const files=['.gitlab-upgrade-lock','.storage-operation-lock','.projects.env/.wizard.env.environments.lock'].map(name=>{const directory=path.join(f.context.state,name);fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'upgrade-owner.json');fs.writeFileSync(file,JSON.stringify(owner));return file;});
 assert.equal(inheritedUpgrade(f.context.state,operation),true);assert.equal(inheritedUpgrade(f.context.state,undefined),false);assert.throws(()=>inheritedUpgrade(f.context.state,'c'.repeat(32)));
 for(const patch of [{operation:'c'.repeat(32)},{start:'0'},{pid:99999999},{format:'other'}]){for(const file of files)fs.writeFileSync(file,JSON.stringify({...owner,...patch}));assert.throws(()=>inheritedUpgrade(f.context.state,operation));}
 for(const file of files)fs.writeFileSync(file,JSON.stringify(owner));fs.writeFileSync(files[1],JSON.stringify({...owner,pid:process.ppid}));assert.throws(()=>inheritedUpgrade(f.context.state,operation));
});
test('verified upgrade children stay in the supervisor process group',async()=>{
 const runner=new ManagedChildProcess();
 const group=fs.readFileSync('/proc/self/stat','utf8').slice(fs.readFileSync('/proc/self/stat','utf8').lastIndexOf(')')+2).split(' ')[2];
 const value=await runner.run(process.execPath,['-e','const fs=require("node:fs");const s=fs.readFileSync("/proc/self/stat","utf8");process.stdout.write(s.slice(s.lastIndexOf(")")+2).split(" ")[2]);'],{cwd:process.cwd(),env:process.env,timeout:5000,inheritGroup:true});
 assert.equal(value,group);
});

test('native runner entry reuses only the verified parent upgrade lease and leaves every barrier intact',t=>{
 const f=fixture(t),operation='d'.repeat(32),owner={format:'system-gitlab-upgrade-lock-v1',operation,pid:process.pid,start:fs.readFileSync('/proc/self/stat','utf8').split(' ').at(21)};
 const files=['.gitlab-upgrade-lock','.storage-operation-lock','.projects.env/.wizard.env.environments.lock'].map(name=>{const directory=path.join(f.context.state,name);fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'upgrade-owner.json');fs.writeFileSync(file,JSON.stringify(owner));return file;});
 for(const file of ['docker-compose.yml'])fs.copyFileSync(path.resolve(__dirname,'../../config/gitlab-runner',file),path.join(f.root,'config/gitlab-runner',file));
 fs.mkdirSync(path.join(f.root,'bin'));const marker=path.join(f.root,'called');fs.writeFileSync(path.join(f.root,'bin/docker'),'#!/bin/sh\nprintf called > "$MARKER"\n',{mode:0o755});
 const env={...f.context.environment,PATH:path.join(f.root,'bin')+':'+process.env.PATH,MARKER:marker,SYSTEM_GITLAB_UPGRADE_OPERATION:operation,GITLAB_RUNNER_SCALE:'0',PERSISTENT_DIR:path.join(f.root,'data')};
 const invoke=(extra,action='runner-pool')=>require('node:child_process').spawnSync(process.execPath,[path.resolve(__dirname,'../../dist/cli/main.js'),'lifecycle',action,f.root,'down','runner'],{env:{...env,...extra},encoding:'utf8',timeout:5000});
 const good=invoke({});assert.equal(good.status,0,good.stderr);assert(fs.existsSync(marker));for(const file of files)assert.deepEqual(JSON.parse(fs.readFileSync(file)),owner);
 const main=path.join(f.root,'config/system/.docker.env');if(fs.existsSync(main))fs.unlinkSync(main);
 const gitlab=invoke({},'gitlab-start');assert.equal(gitlab.status,0,gitlab.stderr);
 const foreignGitlab=invoke({SYSTEM_GITLAB_UPGRADE_OPERATION:'e'.repeat(32)},'gitlab-start');assert.notEqual(foreignGitlab.status,0);for(const file of files)assert.deepEqual(JSON.parse(fs.readFileSync(file)),owner);
 fs.unlinkSync(marker);const bad=invoke({SYSTEM_GITLAB_UPGRADE_OPERATION:'e'.repeat(32)});assert.notEqual(bad.status,0);assert(!fs.existsSync(marker));for(const file of files)assert.deepEqual(JSON.parse(fs.readFileSync(file)),owner);
});

test('an independently killed native child is uncertain even without caller cancellation',async()=>{
 const runner=new ManagedChildProcess();
 await assert.rejects(runner.run(process.execPath,['-e','process.kill(process.pid,"SIGKILL")'],{cwd:process.cwd(),env:process.env,timeout:5000}),error=>error instanceof ProcessFailure&&error.uncertain&&error.signal==='SIGKILL');
});

test('GitLab startup preserves verified upgrade supervision and isolates ordinary commands', async t => {
 for (const supervisedGroup of [undefined, false, true]) {
  const f = fixture(t);
  await f.service.gitlab({...f.context, supervisedGroup}, true);
  const commands = f.calls.filter(call => call.binary);
  assert(commands.some(call => call.binary === 'docker' && call.args.includes('compose')));
  assert.equal(fs.statSync(path.join(f.root,'gitlabConfig/bootstrapper_initial_root_password')).mode & 0o777,0o600);
  assert(!commands.some(call => call.binary === process.execPath));
  for (const call of commands) assert.equal(call.options.inheritGroup, supervisedGroup === true);
 }
});
