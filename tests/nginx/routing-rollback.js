'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {test}=require('node:test');
const source=path.resolve(__dirname,'../..');
test('native proxy reload restores known failures and retains exact ownership evidence for uncertain recovery',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'routing-rollback-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.symlinkSync(path.join(source,'dist'),path.join(root,'dist'),'dir');
 for(const directory of ['config/system','config/system/.projects.env','config/gitlab','wizard','config/nginx-proxy/.projects','bin','templates','active'])fs.mkdirSync(path.join(root,directory),{recursive:true});
 fs.cpSync(path.join(source,'templates/nginx'),path.join(root,'templates/nginx'),{recursive:true});
 fs.writeFileSync(path.join(root,'.docker.env'),'BOOTSTRAPPER_IP=127.0.0.1\n');
 fs.writeFileSync(path.join(root,'config/gitlab/.docker.env'),'GITLAB_IP=127.0.0.1\n');
 fs.writeFileSync(path.join(root,'config/system/.docker.env'),'GITLAB_HOST=gitlab.example.test\nGITLAB_DOMAIN_MODE=0\nGITLAB_REGISTRY_HOST=registry.example.test\nGITLAB_REGISTRY_DOMAIN_MODE=0\nSYNC_ENABLE=false\nWIZARD_ENABLE=false\n');
 // Only emulate the Docker transport/NGINX executable; filesystem primitives run for real.
 fs.writeFileSync(path.join(root,'bin/docker'),'#!'+process.execPath+'\n'+`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=process.env.FIXTURE,args=process.argv.slice(2),id='a'.repeat(64);
assert.equal(args.shift(),'--host=unix:///var/run/docker.sock');
fs.appendFileSync(path.join(root,'trace'),JSON.stringify(args)+'\\n');
if(args[0]==='container'){assert.deepEqual(args,['container','inspect','--format','{{.Id}}','system_web_1']);process.stdout.write(id);process.exit(0);}
assert.equal(args.shift(),'exec');assert.equal(args.shift(),id,'all mutations retain the inspected identity');
const binary=args.shift(),phase=process.env.PHASE,fail=path.join(root,'fail');
const selected=()=>fs.existsSync(fail),consume=()=>fs.unlinkSync(fail);
if(binary==='/docker-entrypoint.d/20-envsubst-on-templates.sh'){
 fs.writeFileSync(path.join(root,'active/default.conf'),'candidate');fs.writeFileSync(path.join(root,'active/new.conf'),'candidate extra');
 if(phase==='cancel')process.kill(process.pid,'SIGKILL');
 if(phase==='render'&&selected()){consume();process.exit(19);}process.exit(0);
}
if(binary==='nginx'){
 if(selected()&&((['validate','rollback'].includes(phase)&&args[0]==='-t')||(phase==='reload'&&args[1]==='reload'))){consume();if(phase==='rollback')fs.writeFileSync(path.join(root,'rollback-fail'),'1');process.exit(19);}process.exit(0);
}
assert(['mkdir','cp','find','rm','rmdir'].includes(binary),'unexpected native operation');
const mapped=args.map(arg=>arg.replace('/etc/nginx/conf.d',path.join(root,'active')).replace('/tmp/system-routing-reload.lock',path.join(root,'lease')));
if(binary==='cp'&&phase==='snapshot'&&selected()){consume();process.exit(19);}
if(binary==='cp'&&fs.existsSync(path.join(root,'rollback-fail')))process.exit(23);
const result=cp.spawnSync(binary,mapped,{stdio:'inherit'});process.exit(result.status??1);
`,{mode:0o755});
 const invoke=phase=>spawnSync(process.execPath,[path.join(root,'dist/modules/projects-routing/entry.js'),'routing','reload',root,path.join(root,'templates')],{
  cwd:path.join(root,'config/system'),encoding:'utf8',env:{...process.env,PATH:path.join(root,'bin')+':'+process.env.PATH,FIXTURE:root,PHASE:phase},timeout:20000,
 });
 for(const phase of ['success','snapshot','render','validate','reload','rollback','cancel']){
  for(const name of ['lease','rollback-fail','active/new.conf'])fs.rmSync(path.join(root,name),{recursive:true,force:true});
  const template=path.join(root,'templates/default.conf.template'),active=path.join(root,'active/default.conf');
  fs.writeFileSync(template,'previous template');fs.writeFileSync(active,'previous active config');fs.chmodSync(active,0o600);
  fs.writeFileSync(path.join(root,'fail'),'once');fs.writeFileSync(path.join(root,'trace'),'');
  const result=invoke(phase),calls=fs.readFileSync(path.join(root,'trace'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(result.status===0,phase==='success',phase+': '+result.stderr);
  assert(!calls.some(args=>args.includes('sh')||args.includes('-ec')));
  if(phase==='success'){
   assert.notEqual(fs.readFileSync(template,'utf8'),'previous template');assert.equal(fs.readFileSync(active,'utf8'),'candidate');
  }else assert.equal(fs.readFileSync(template,'utf8'),'previous template');
  if(['snapshot','render','validate','reload'].includes(phase)){
   assert.equal(fs.readFileSync(active,'utf8'),'previous active config');assert.equal(fs.statSync(active).mode&0o777,0o600);
   assert(!fs.existsSync(path.join(root,'active/new.conf')));
   if(phase!=='snapshot')assert(calls.some(args=>args.slice(-3).join(' ')==='nginx -s reload'),'rollback reloads restored configuration');
  }
  if(['rollback','cancel'].includes(phase)){
   assert.match(result.stderr,/retain its owned lease and snapshot/);
   const snapshots=fs.readdirSync(path.join(root,'lease'));assert.equal(snapshots.length,1);
   assert.equal(fs.readFileSync(path.join(root,'lease',snapshots[0],'default.conf'),'utf8'),'previous active config');
   if(phase==='cancel')assert(!calls.some(args=>args.includes('find')),'uncertain renderer must not race rollback');
   fs.writeFileSync(path.join(root,'trace'),'');assert.notEqual(invoke('success').status,0);
   const retry=fs.readFileSync(path.join(root,'trace'),'utf8');assert(!retry.includes('"cp"'));assert(!retry.includes('"rm"'));
   assert.equal(fs.readFileSync(path.join(root,'lease',snapshots[0],'default.conf'),'utf8'),'previous active config');
  }else assert(!fs.existsSync(path.join(root,'lease')));
 }
});
