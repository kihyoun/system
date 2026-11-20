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
