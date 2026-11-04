'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {execFileSync,spawnSync}=require('node:child_process');
const operation=require('../../system/seed-operation');
const mounts='1 0 0:1 / / rw - overlay overlay rw\n2 1 8:2 / /external-seed rw - ext4 /dev/vdb rw\n';
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'storage-operation-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const spec={PERSISTENCE_MODE:'local',PERSISTENT_MOUNT:'/',PERSISTENT_DIR:'/data/platform',
    SEED_DIR:'/external-seed/seed',SEED_MOUNT:'/external-seed'};
  for (const dir of ['/external-seed/seed',...['configuration','wizard-public','templates','synctemplates','ssl','runners',
    'gitlab/config','gitlab/logs','gitlab/data','host/letsencrypt'].map(relative=>'/data/platform/'+relative)])
    fs.mkdirSync(root+dir,{recursive:true,mode:0o700});
  return {root,spec};
}
test('local data and an explicitly selected external Seed are independent',t=>{
  const f=fixture(t);
  assert.equal(operation.validate(f.spec,()=>mounts,f.root).mode,'local');
  assert.throws(()=>operation.validate({...f.spec,SEED_MOUNT:''},()=>mounts,f.root),/declare-external-seed-mount/);
});
test('a disappeared external mount never becomes a root-disk backup directory',t=>{
  const f=fixture(t);
  assert.throws(()=>operation.validate(f.spec,()=>mounts.split('\n')[0],f.root),/seed-target-unavailable/);
  assert.throws(()=>operation.validate({...f.spec,SEED_DIR:'/data/backup',SEED_MOUNT:'/'},()=>mounts,f.root),/external-seed-volume-required/);
});
test('backup roots cannot overlap, traverse, or follow a symlink',t=>{
  const f=fixture(t);
  assert.throws(()=>operation.validate({...f.spec,SEED_DIR:'/data/platform/seed'},()=>mounts,f.root),/overlapping-live-and-backup/);
  assert.throws(()=>operation.absolute('/backup/../data'),/invalid-storage-path/);
  fs.renameSync(f.root+'/external-seed/seed',f.root+'/external-seed/original');
  fs.symlinkSync('original',f.root+'/external-seed/seed');
  assert.throws(()=>operation.validate(f.spec,()=>mounts,f.root),/seed-target-unavailable/);
});
test('legacy live volume and Seed on the same selected data volume remain valid',t=>{
  const f=fixture(t),spec={...f.spec,PERSISTENCE_MODE:'volume',PERSISTENT_MOUNT:'/external-seed',
    PERSISTENT_DIR:'/external-seed/platform',SEED_MOUNT:''};
  fs.cpSync(f.root+f.spec.PERSISTENT_DIR,f.root+spec.PERSISTENT_DIR,{recursive:true});
  assert.equal(operation.validate(spec,()=>mounts,f.root).mode,'volume');
});
test('only an exact owned image receives the temporary Seed mount',()=>{
  const image='sha256:'+'a'.repeat(64),name='system-storage-harvest-'+'b'.repeat(24);
  const spec={PERSISTENT_DIR:'/data/platform',SEED_DIR:'/external-seed/seed'};
  const args=operation.helperArguments(spec,image,name,'harvest');
  assert(args.includes(image)); assert(args.includes('none')); assert(!args.includes('--privileged'));
  assert(args.includes('type=bind,src=/,dst=/host,readonly'));
  assert(args.includes('type=bind,src=/external-seed/seed,dst=/seed'));
  assert(args.includes('type=bind,src=/data/platform/gitlab/logs,dst=/srv/gitlab/log'));
  assert.throws(()=>operation.helperArguments(spec,'controller:latest',name,'harvest'),/invalid-helper-identity/);
  assert(!fs.readFileSync(path.join(__dirname,'../../system/docker-compose.yml'),'utf8').includes(':/seed'));
});
test('local preparation is source-owned and independent of any backup path',t=>{
  const f=fixture(t);
  operation.prepareLocal(f.spec,f.root,mounts);
  const live=f.root+f.spec.PERSISTENT_DIR;
  assert.equal(fs.readFileSync(live+'/.system-bootstrapper-volume','utf8'),'system-bootstrapper-persistence-v1\n');
  assert.equal(fs.statSync(live+'/configuration').mode&0o777,0o700);
  assert.equal(fs.statSync(live+'/wizard-public').mode&0o777,0o755);
  operation.restoreEmpty(live);
  fs.writeFileSync(live+'/gitlab/data/database','existing live data');
  assert.throws(()=>operation.restoreEmpty(live),/restore-target-not-empty/);
  assert.equal(fs.readFileSync(live+'/gitlab/data/database','utf8'),'existing live data');
});
test('mount records decode whitespace without confusing path prefixes',()=>{
  const rows=operation.mountRows('1 0 0:1 / / rw - ext4 /dev/vda rw\n2 1 8:2 / /seed\\040target rw - ext4 /dev/vdb rw');
  assert.equal(operation.covering(rows,'/seed target/a').device,'8:2');
  assert.equal(operation.covering(rows,'/seed target-other').device,'0:1');
});
test('environment operations racing the initial preflight still block before copying',t=>{
  const f=fixture(t),state=f.root+'/data/platform';
  const held=new operation.StorageLease(state,{operation:'harvest',helperName:'owned-helper',imageId:'sha256:'+'a'.repeat(64)});
  const raced=path.join(state,'.projects.env/.wizard.env.environments.lock');
  fs.mkdirSync(raced,{recursive:true});
  assert.throws(()=>held.acquireEnvironment(),/storage-operation-busy/);
  held.release(true);
  assert(fs.existsSync(raced),'the competing operation owns its mutex');
  assert(!fs.existsSync(path.join(state,'.storage-operation-lock')));
});
test('uncertain child completion retains both owned operation barriers',t=>{
  const f=fixture(t),state=f.root+'/data/platform';
  const held=new operation.StorageLease(state,{operation:'restore',helperName:'owned-helper',imageId:'sha256:'+'a'.repeat(64)});
  held.acquireEnvironment(); held.release(false);
  assert(fs.existsSync(held.environment));
  assert.equal(JSON.parse(fs.readFileSync(held.owner)).completion,'uncertain');
});
test('real configuration ZIP entries accept Wizard JSON and refuse symlinks or traversal before extraction',t=>{
  const f=fixture(t),zip=path.join(f.root,'bootstrapper.zip');
  const create=(name,mode=0o100600)=>execFileSync('python3',['-c',
    'import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr(".docker.env","configuration")\n z.writestr("bootstrapper.json","{}")\n i=zipfile.ZipInfo(sys.argv[2]); i.create_system=3; i.external_attr=int(sys.argv[3])<<16; z.writestr(i,"public fixture")',
    zip,name,String(mode)]);
  create('.projects.env/.wizard.env'); operation.validateBackup(zip);
  create('.projects.env/.wizard.env',0o120777);
  assert.throws(()=>operation.validateBackup(zip),/unsafe-configuration-backup-entry/);
  create('../outside'); assert.throws(()=>operation.validateBackup(zip),/invalid-configuration-backup/);
  assert(!fs.existsSync(path.join(f.root,'outside')));
});
test('a real configuration import preserves the acquired server-owned environment mutex',t=>{
  const f=fixture(t),state=f.root+'/data/platform/configuration',system=f.root+'/source/system';
  fs.mkdirSync(system,{recursive:true});fs.mkdirSync(f.root+'/source/project-bootstrap');
  for(const relative of ['system/push.sh','project-bootstrap/preserve-system-project.js'])
    fs.copyFileSync(path.join(__dirname,'../..',relative),f.root+'/source/'+relative);
  execFileSync('python3',['-c',
    'import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr(".docker.env","export SYNC_ENABLE=true\\n")\n z.writestr(".projects.env/new.env","export PROJECT=new\\n")',f.root+'/source/bootstrapper.zip']);
  const held=new operation.StorageLease(state,{operation:'restore',helperName:'fixture',imageId:'sha256:'+'a'.repeat(64)});
  held.acquireEnvironment();const inode=fs.statSync(held.environment).ino;
  execFileSync('bash',['push.sh'],{cwd:system,env:{...process.env,SYSTEM_CONFIG_DIR:state},encoding:'utf8'});
  assert.equal(fs.statSync(held.environment).ino,inode);
  assert.equal(fs.readFileSync(state+'/.projects.env/new.env','utf8'),'export PROJECT=new\n');
  held.release(true);
});
test('all live source roots reject symlinks and unexpected nested mounts before writable binds',t=>{
  const f=fixture(t),original=f.root+'/data/platform/gitlab';
  fs.renameSync(original,original+'-elsewhere'); fs.symlinkSync('gitlab-elsewhere',original);
  assert.throws(()=>operation.validate(f.spec,()=>mounts,f.root),/seed-target-unavailable/);
  fs.unlinkSync(original); fs.renameSync(original+'-elsewhere',original);
  assert.throws(()=>operation.validate(f.spec,()=>mounts+'3 1 8:3 / /data/platform/ssl rw - ext4 /dev/other rw\n',f.root),/nested-live-storage-mount/);
});
test('local preparation refuses intermediate symlinks before mkdir can escape',t=>{
  const f=fixture(t),live=f.root+'/data/platform',outside=f.root+'/elsewhere';
  fs.mkdirSync(outside);fs.rmSync(live+'/gitlab',{recursive:true});fs.symlinkSync(outside,live+'/gitlab');
  assert.throws(()=>operation.prepareLocal(f.spec,f.root,mounts),/unsafe-live-storage-path/);
  assert.deepEqual(fs.readdirSync(outside),[]);
  assert(!fs.existsSync(live+'/.system-bootstrapper-volume'));
});
test('a dangling persistence marker cannot make local preparation write outside the selected root',t=>{
  const f=fixture(t),outside=f.root+'/unexpected-marker';
  fs.symlinkSync(outside,f.root+'/data/platform/.system-bootstrapper-volume');
  assert.throws(()=>operation.prepareLocal(f.spec,f.root,mounts),/unrecognized-live-storage/);
  assert(!fs.existsSync(outside));
});
test('controller restart refuses running, uncertain, or unowned storage operations before service writes',t=>{
  const f=fixture(t),state=f.root+'/data/platform/configuration';
  operation.startupAllowed(state);
  const held=new operation.StorageLease(state,{operation:'harvest',helperName:'owned-helper',imageId:'sha256:'+'a'.repeat(64)});
  assert.throws(()=>operation.startupAllowed(state),/storage-operation-busy/);
  held.release(false);assert.throws(()=>operation.startupAllowed(state),/storage-operation-busy/);
  fs.rmSync(held.directory,{recursive:true});fs.mkdirSync(held.directory);
  assert.throws(()=>operation.startupAllowed(state),/storage-operation-busy/);
  fs.writeFileSync(path.join(held.directory,'controller-owner.json'),JSON.stringify({format:'system-controller-operation-v1',operation:'a'.repeat(32)}));
  assert.throws(()=>operation.startupAllowed(state),/storage-operation-busy/);
  const upgrade=path.join(state,'.gitlab-upgrade-lock');fs.mkdirSync(upgrade);
  fs.copyFileSync(path.join(held.directory,'controller-owner.json'),path.join(upgrade,'controller-owner.json'));
  operation.startupAllowed(state,true);
  fs.writeFileSync(path.join(upgrade,'upgrade-owner.json'),'{}');
  assert.throws(()=>operation.startupAllowed(state,true),/storage-operation-busy/);
  const start=fs.readFileSync(path.join(__dirname,'../../system/start.sh'),'utf8');
  assert(start.indexOf('startup-begin') < start.indexOf('node ./persistence-init.js'));
});
test('startup and cold backup take the same atomic barrier across the writer-start interval',t=>{
  const f=fixture(t),state=f.root+'/data/platform/configuration',spec={operation:'harvest',helperName:'helper',imageId:'sha256:'+'a'.repeat(64)};
  const startup=operation.startupBegin(state,process.pid);
  assert.throws(()=>new operation.StorageLease(state,spec),/storage-operation-busy/);
  assert.throws(()=>operation.startupBegin(state,process.pid),/storage-operation-busy/);
  operation.startupFinish(state,startup);
  const harvest=new operation.StorageLease(state,spec);
  assert.throws(()=>operation.startupBegin(state,process.pid),/storage-operation-busy/);
  harvest.release(true);
  assert(!fs.existsSync(path.join(state,'.storage-operation-lock')));
});
test('a settled startup failure retries while killed or unknown work retains its barrier',t=>{
  const f=fixture(t),state=f.root+'/data/platform/configuration';
  const first=operation.startupBegin(state,process.pid);
  operation.startupSettled(state,first,1);
  const retry=operation.startupBegin(state,process.pid);
  operation.startupSettled(state,first,0);
  assert.throws(()=>operation.startupBegin(state,process.pid),/storage-operation-busy/);
  for(const code of [137,143,null]){
    operation.startupSettled(state,retry,code);
    assert.throws(()=>operation.startupBegin(state,process.pid),/storage-operation-busy/);
  }
  operation.startupSettled(state,retry,1);
  assert(!fs.existsSync(path.join(state,'.storage-operation-lock')));
});
test('a busy controller waits without writers while settled startup failures remain retryable',t=>{
  const f=fixture(t),state=f.root+'/data/platform/configuration',system=f.root+'/source/system';fs.mkdirSync(system,{recursive:true});
  for(const file of ['start.sh','seed-operation.js'])fs.copyFileSync(path.join(__dirname,'../../system',file),path.join(system,file));
  fs.writeFileSync(system+'/persistence-init.js','process.exit(1);\n');
  const env={...process.env,SYSTEM_CONFIG_DIR:state},held=new operation.StorageLease(state,{operation:'harvest',helperName:'fixture',imageId:'sha256:'+'a'.repeat(64)});
  const busy=spawnSync('timeout',['--kill-after=1','0.5','bash','start.sh'],{cwd:system,env,encoding:'utf8'});
  assert.equal(busy.status,124,busy.stderr);assert.match(busy.stderr,/Startup paused/);
  assert(fs.existsSync(held.owner));held.release(true);
  for(let attempt=0;attempt<2;attempt++){
    const settled=spawnSync('bash',['start.sh'],{cwd:system,env,encoding:'utf8',timeout:5000});
    assert.equal(settled.status,1,settled.stderr);
    assert(!fs.existsSync(path.join(state,'.storage-operation-lock')));
  }
});
test('authenticated controller quiescence rejects active or unknown queues after acquiring the barrier',()=>{
  const status={projectOperationInProgress:false,runnerSetupInProgress:false,defaultWizardSetupInProgress:false,needRestart:false,harvestInProgress:true};
  assert.equal(operation.statusIdle(status),true);
  for(const key of ['projectOperationInProgress','runnerSetupInProgress','defaultWizardSetupInProgress','needRestart']){
    assert.equal(operation.statusIdle({...status,[key]:true}),false);
    const absent={...status};delete absent[key];assert.equal(operation.statusIdle(absent),false);
  }
  assert.throws(()=>operation.controllerIdle({},()=>'{"idle":false}'),/controller-operation-busy/);
  operation.controllerIdle({},args=>{assert.equal(args[0],'exec');assert(!args.join(' ').includes('password'));return '{"idle":true}';});
});
test('controller status uses saved authentication over first-setup generated defaults',t=>{
  const f=fixture(t),state=f.root+'/data/platform/configuration',bin=f.root+'/bin';fs.mkdirSync(bin);
  fs.writeFileSync(state+'/sync-auth.env','export SYNC_USER=first_setup\nexport SYNC_PASS=first_setup_fixture\n');
  fs.writeFileSync(state+'/.docker.env','export SYNC_USER=saved_user\nexport SYNC_PASS=saved_fixture\n');
  fs.writeFileSync(bin+'/node',`#!/bin/sh
[ "$SYNC_USER" = saved_user ] && [ "$SYNC_PASS" = saved_fixture ] || exit 1
printf '{"idle":true}'
`,{mode:0o700});
  operation.controllerIdle({},args=>execFileSync('bash',['-ec',args[4]],
    {env:{...process.env,SYSTEM_CONFIG_DIR:state,PATH:bin+':'+process.env.PATH},encoding:'utf8'}));
});
test('a stopped or running GitLab must actually own every selected data source',()=>{
  const calls=[], image='sha256:'+'a'.repeat(64),spec={operation:'harvest',PERSISTENT_DIR:'/data/platform'};
  const container={Image:image,State:{Running:true},Config:{Labels:{'com.docker.compose.project':'system','com.docker.compose.service':'gitlab'}},
    Mounts:[['/etc/gitlab','config'],['/var/log/gitlab','logs'],['/var/opt/gitlab','data']].map(([destination,relative])=>
      ({Type:'bind',Source:'/data/platform/gitlab/'+relative,Destination:destination,RW:true}))};
  const run=args=>{calls.push(args); if(args[0]==='container')return 'system_gitlab_1'; if(args[0]==='image')return image;return JSON.stringify([container]);};
  operation.gitlabOwnership(spec,'gitlab:fixed',run);
  container.Mounts[2].Source='/other-platform/gitlab/data';
  assert.throws(()=>operation.gitlabOwnership(spec,'gitlab:fixed',run),/gitlab-writers-use-different-live-storage/);
  assert(!calls.some(args=>['stop','exec','start'].includes(args[0])));
});
test('effective pinned runtime image remains available when an old configuration omits it',()=>{
  const cube=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example')).subarray(0,1184);
  const selected='gitlab/gitlab-ce:fixed@sha256:'+'a'.repeat(64);
  assert.equal(operation.imageFromConfiguration(Buffer.concat([cube,Buffer.from('\nexport SYNC_ENABLE=true\n')]),selected),selected);
  assert.equal(operation.imageFromConfiguration(Buffer.concat([cube,Buffer.from('\nexport GITLAB_IMAGE="declared:fixed"\n')]),selected),'declared:fixed');
  assert.equal(operation.imageFromConfiguration(cube),'');
});
