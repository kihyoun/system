const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {RuntimeInspectionService,inspectServiceRows,failedStoppedController}=require('../dist/host/runtime-inspection');
const {HostInstallService}=require('../dist/host/install');
const config={GITLAB_RUNNER_SCALE:'0',WIZARD_ENABLE:'false'};
test('stopped controller requires exact quiescent identity and no active execs',()=>{
 const row={Name:'/system_bootstrapper_1',Id:'owned',State:{Status:'exited',ExitCode:1,Pid:0,Running:false,Paused:false,Restarting:false,Dead:false,OOMKilled:false},ExecIDs:null,HostConfig:{RestartPolicy:{Name:'no'}}};
 failedStoppedController(row,'owned');
 for(const changed of [{Id:'other'},{ExecIDs:['active']},{State:{...row.State,ExitCode:137}},{State:{...row.State,Running:true}},{HostConfig:{RestartPolicy:{Name:'always'}}}])assert.throws(()=>failedStoppedController({...row,...changed},'owned'));
});
test('service inspection rejects duplicate identities and unhealthy services',()=>{
 const rows=['bootstrapper','web','gitlab'].map(name=>({Name:`/system_${name}_1`,State:{Running:true}}));
 assert.equal(Object.keys(inspectServiceRows(config,rows)).length,3);
 assert.throws(()=>inspectServiceRows(config,[...rows,rows[0]]),/expected-services/);
 assert.throws(()=>inspectServiceRows(config,[...rows.slice(0,2),{...rows[2],State:{Running:true,Health:{Status:'starting'}}}]),/service-not-healthy/);
});
function fixture(t){
 const mount=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-mount-')),root=path.join(mount,'platform');t.after(()=>fs.rmSync(mount,{recursive:true,force:true}));
 for(const sub of ['config','logs','data'])fs.mkdirSync(path.join(root,'gitlab',sub),{recursive:true});
 const selected={...config,_root:root,PERSISTENT_MOUNT:mount};
 const rows={system_gitlab_1:{Mounts:[['config','/etc/gitlab'],['logs','/var/log/gitlab'],['data','/var/opt/gitlab']].map(([source,destination])=>({Type:'bind',Source:path.join(root,'gitlab',source),Destination:destination}))}};
 const host=new HostInstallService({run(binary,args){return {stdout:binary==='docker'?JSON.stringify([{Options:{type:'none',o:'bind',device:path.join(root,'gitlab/logs')}}]):'8:1',stderr:''};}});
 return {selected,rows,service:new RuntimeInspectionService(host),root,mount};
}
test('missing GitLab data mount cannot be masked by other persistent mounts',t=>{
 const {selected,rows,service}=fixture(t);rows.system_gitlab_1.Mounts.pop();assert.throws(()=>service.mounts(selected,rows),/essential-persistent-mount-missing/);
});
test('named volume cannot redirect essential mount within selected data root',t=>{
 const {selected,rows,service}=fixture(t);Object.assign(rows.system_gitlab_1.Mounts[0],{Type:'volume',Name:'misdirected'});assert.throws(()=>service.mounts(selected,rows),/essential-persistent-mount-is-misdirected/);
});
test('mount verification rejects duplicate targets, outside data and tmpfs replacement',t=>{
 const {selected,rows,service,mount}=fixture(t);assert.equal(service.mounts(selected,rows),3);
 rows.system_gitlab_1.Mounts.push({...rows.system_gitlab_1.Mounts[0]});assert.throws(()=>service.mounts(selected,rows),/duplicate-service/);rows.system_gitlab_1.Mounts.pop();
 rows.system_gitlab_1.Mounts.push({Type:'bind',Source:mount,Destination:'/extra'});assert.throws(()=>service.mounts(selected,rows),/escapes-selected-data/);rows.system_gitlab_1.Mounts.pop();
 rows.system_gitlab_1.Mounts[0].Type='tmpfs';assert.throws(()=>service.mounts(selected,rows),/essential-data-mounted-as-tmpfs/);
});

// Runtime verification moved from the Python fixture to the shared native service.
const {RuntimeVerificationService}=require('../dist/host-bootstrap/runtime-verification.service');
const {HostInitializeService}=require('../dist/host-bootstrap/initialize.service');
const {writePrivate}=require('../dist/host/install');
function verificationFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-proof-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const main=path.join(root,'configuration/.docker.env');fs.mkdirSync(path.dirname(main),{recursive:true});fs.copyFileSync(path.join(__dirname,'../../system/.docker.env.example'),main);
 const selected={_root:root,_main:main,GITLAB_RUNNER_SCALE:'1',GITLAB_HOST:'gitlab.example.invalid',GITLAB_DOMAIN_MODE:'2',GITLAB_REGISTRY_HOST:'registry.example.invalid',GITLAB_REGISTRY_DOMAIN_MODE:'2',WIZARD_ENABLE:'true',WIZARD_HOST:'wizard.example.invalid',WIZARD_DOMAIN_MODE:'2',SYNC_ENABLE:'true',SYNC_HOST:'sync.example.invalid',SYNC_DOMAIN_MODE:'2',SYNC_USER:'fixture',SYNC_PASS:'synthetic-private'};
 const identity=path.join(root,'runners/runner/1/config/.runner_system_id');fs.mkdirSync(path.dirname(identity),{recursive:true});fs.writeFileSync(identity,'synthetic-manager\n');
 const token=path.join(root,'api-token');fs.writeFileSync(token,'synthetic-private-token',{mode:0o600});
 const services={system_wizard_1:{NetworkSettings:{Networks:{default:{IPAddress:'172.19.0.3'}}}}};
 return {root,selected,token,services,baseline:{startedAt:new Date().toISOString()}};
}
test('Cube signature and immutable saved byte baseline reject mutation',t=>{
 const f=verificationFixture(t),service=new RuntimeVerificationService(),baseline={configurationFiles:service.files(f.selected),expectedRunnerCount:1,runnerManagerIdentitySha256:{},imageMode:'public-images-v1'};
 service.assertBaseline(f.selected,baseline);
 const original=fs.readFileSync(f.selected._main);fs.writeFileSync(f.selected._main,Buffer.concat([original,Buffer.from('\nchanged')]));assert.throws(()=>service.assertBaseline(f.selected,baseline),/configuration-changed/);
 const broken=Buffer.from(original);broken[807]=32;fs.writeFileSync(f.selected._main,broken);baseline.configurationFiles=service.files(f.selected);assert.throws(()=>service.assertBaseline(f.selected,baseline),/cube-signature/);
});
test('runner contact verification distinguishes absent token, stale, fresh, offline and unrelated identities',async t=>{
 const f=verificationFixture(t);let probes=0,refresh=false,contact={status:'online',system_id:'synthetic-manager',contacted_at:'2000-01-01T00:00:00Z'};
 const child={async run(binary,args,options){assert.equal(options.timeout,15000);assert(args.includes('runner_docker_1'));probes++;if(refresh)contact={...contact,contacted_at:new Date().toISOString()};return '';}};
 const request=async(url,options)=>{assert.equal(options.headers['PRIVATE-TOKEN'],'synthetic-private-token');return Response.json(url.includes('/runners/all?')?[{id:3}]:[contact]);};
 const service=new RuntimeVerificationService(undefined,child,request);
 assert.deepEqual(await service.runnerContacts(f.selected,f.baseline),{checked:false,reason:'no-operator-supplied-GitLab-API-token'});
 await assert.rejects(service.runnerContacts(f.selected,f.baseline,f.token),/contact-not-fresh/);assert.equal(probes,1);
 refresh=true;const result=await service.runnerContacts(f.selected,f.baseline,f.token);assert.equal(result.online,1);assert.equal(result.authenticationProbeCount,1);assert.equal(result.jobExecutionChecked,false);
 probes=0;assert.equal((await service.runnerContacts(f.selected,f.baseline,f.token)).authenticationProbeCount,0);assert.equal(probes,0);
 for(const changed of [{status:'offline'},{contacted_at:null},{system_id:'other'}]){const before=contact;contact={...contact,...changed};await assert.rejects(service.runnerContacts(f.selected,f.baseline,f.token));assert.equal(probes,0);contact=before;}
 fs.chmodSync(f.token,0o644);await assert.rejects(service.runnerContacts(f.selected,f.baseline,f.token));
});
test('each retained runner requires its own identity and post-baseline contact; probe errors propagate without output',async t=>{
 const f=verificationFixture(t);f.selected.GITLAB_RUNNER_SCALE='2';const second=path.join(f.root,'runners/runner/2/config/.runner_system_id');fs.mkdirSync(path.dirname(second),{recursive:true});fs.writeFileSync(second,'second-manager\n');
 let rows=[{status:'online',system_id:'synthetic-manager',contacted_at:new Date().toISOString()}];
 const service=new RuntimeVerificationService(undefined,{async run(){throw Error('runner-manager-authentication-probe-failed');}},async url=>Response.json(url.includes('/runners/all?')?[{id:3}]:rows));
 await assert.rejects(service.runnerContacts(f.selected,f.baseline,f.token),/expected-runner-managers/);
 rows.push({status:'online',system_id:'second-manager',contacted_at:'2000-01-01T00:00:00Z'});await assert.rejects(service.runnerContacts(f.selected,f.baseline,f.token),/probe-failed/);
 rows[1].contacted_at=new Date().toISOString();assert.equal((await service.runnerContacts(f.selected,f.baseline,f.token)).online,2);
 fs.writeFileSync(second,'synthetic-manager\n');await assert.rejects(service.runnerContacts(f.selected,f.baseline,f.token),/not-unique/);
});
test('runtime route checks require GitLab application and exact Wizard container bytes',async t=>{
 const f=verificationFixture(t);let gitlab=503,direct='wrong',redirect='https://wizard.example.invalid/bootstrapper-routing-check?probe=1';
 const service=new RuntimeVerificationService(undefined,{async run(){return JSON.stringify({status:'ok'});}},async(url)=>{
  if(url.includes('/users/sign_in'))return new Response('',{status:gitlab});
  if(url.includes('/v2/'))return new Response('',{status:401,headers:{'WWW-Authenticate':'Bearer realm="fixture"'}});
  if(url.startsWith('https://old.'))return new Response('',{status:308,headers:{location:redirect}});
  return new Response(url.includes('172.19.')?direct:'wizard');
 });
 await assert.rejects(service.routes(f.selected,f.services),/gitlab-sign-in-not-ready/);gitlab=200;
 await assert.rejects(service.routes(f.selected,f.services),/does-not-route-to-wizard/);direct='wizard';
 await service.routes(f.selected,f.services,'https://old.example.invalid');redirect='https://wrong.example.invalid';await assert.rejects(service.routes(f.selected,f.services,'https://old.example.invalid'),/redirect-mismatch/);
});
test('authenticated Fetch compares exact saved configuration bytes',async t=>{
 const f=verificationFixture(t);let fetched=fs.readFileSync(f.selected._main,'utf8');
 const service=new RuntimeVerificationService(undefined,undefined,async(url,options)=>{
   if(url.endsWith('/login')){assert.equal(JSON.parse(options.body).password,'synthetic-private');return Response.json({refreshToken:'fixture-refresh'});}
   if(url.endsWith('/token'))return Response.json({accessToken:'fixture-access'});
   assert.equal(options.headers.Authorization,'Bearer fixture-access');return Response.json({data:fetched});
 });
 await service.sync(f.selected);fetched+='\n';await assert.rejects(service.sync(f.selected),/does-not-match-saved-config/);
});
test('private receipts reject symlinks and initialization fails before packages or receipt creation on missing volume',async t=>{
 const f=verificationFixture(t),receipt=path.join(f.root,'receipt'),target=path.join(f.root,'target');fs.writeFileSync(target,'preserve');fs.symlinkSync(target,receipt);assert.throws(()=>writePrivate(receipt,Buffer.from('overwrite')));assert.equal(fs.readFileSync(target,'utf8'),'preserve');
 let released=false,mutated=false;const initialize=new HostInitializeService({async recover(){mutated=true;}},{async settings(){throw Error('persistent-volume-missing');}},{async install(){mutated=true;}},undefined,undefined,()=>()=>{released=true;});
 const directory=path.join(f.root,'new-receipts');await assert.rejects(initialize.initialize({checkout:f.root,receiptDir:path.join(os.tmpdir(),path.basename(f.root)+'-receipts')},{PERSISTENCE_ENV_FILE:'/fixture'}),/persistent-volume-missing/);assert.equal(mutated,false);assert.equal(released,true);assert(!fs.existsSync(directory));
});
test('native host bootstrap help needs no live configuration and argument errors stay bounded',()=>{
 const {spawnSync}=require('node:child_process');const entry=path.join(__dirname,'../../bootstrapper/initialize.js');
 assert.equal(spawnSync(process.execPath,[entry,'--help']).status,0);
 const invalid=spawnSync(process.execPath,[path.join(__dirname,'../../bootstrapper/recover-volume.js'),'--unknown']);assert.equal(invalid.status,1);assert.match(invalid.stderr.toString(),/Unexpected host bootstrap arguments/);
});
