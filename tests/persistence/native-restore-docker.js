#!/usr/bin/env node
'use strict';
// A small filesystem/ZIP probe with a fixture mount table and Docker lifecycle
// answers. ZIP export/import, native inside(), manifests and rsync are real;
// the full candidate separately proves actual host mount selection.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const label='org.system-bootstrapper.restore-probe';
function run({helperImage,configurationExporter,backup}) {
  assert(helperImage && (configurationExporter || backup),'Candidate image and actual exporter or unchanged ZIP required.');
  const name='system-restore-'+crypto.randomBytes(12).toString('hex'),volume=name+'-data';
  const created=[];let volumeIntended=false,primary,phase='image-and-source';
  const docker=(args,input)=>{
    const result=spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
    if(result.error || result.status!==0){
      throw Error('Native restore probe failed: '+args[0]);
    }
    return result.stdout.trim();
  };
  const inspect=args=>JSON.parse(docker(args));
  const image=inspect(['image','inspect',helperImage])[0].Id;
  assert.match(image,/^sha256:[a-f0-9]{64}$/);
  const sourceRoot=path.resolve(__dirname,'../..');
  const files=Object.fromEntries(['system/seed-operation.js','system/seed-manifest.js','system/seed.sh',
    'system/push.sh','project-bootstrap/preserve-system-project.js'].map(file=>[file,fs.readFileSync(path.join(sourceRoot,file),'utf8')]));
  const code=(container,text)=>docker(['exec','--interactive',container,'node','-'],text);
  const install=container=>code(container,
    `const fs=require('node:fs'),path=require('node:path');for(const [file,text] of Object.entries(${JSON.stringify(files)})){
      const target='/system/'+file;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}`);
  const create=(container,mounts)=>{
    created.push(container);
    docker(['create','--name',container,'--label',label+'='+name,'--network','none','--read-only','--workdir','/',
      '--memory','256m','--cpus','0.5','--pids-limit','64','--tmpfs','/tmp:rw,noexec,nosuid,size=16m',
      '--tmpfs','/system:rw,noexec,nosuid,size=16m','--tmpfs','/srv:rw,noexec,nosuid,size=4m',
      '--tmpfs','/probe-bin:rw,exec,nosuid,nodev,size=1m',...mounts,'--entrypoint','node',image,'-e','setInterval(()=>{},1000)']);
    docker(['start',container]);install(container);
  };
  try {
    phase='owned-volume';volumeIntended=true;docker(['volume','create','--label',label+'='+name,volume]);
    const initializer=name+'-init';
    create(initializer,['--mount','type=volume,src='+volume+',dst=/host']);
    phase='completed-seed-fixture';code(initializer,`const fs=require('node:fs'),path=require('node:path'),manifest=require('/system/system/seed-manifest');
      const operation=require('/system/system/seed-operation'),mounts='1 0 0:1 / / rw - overlay overlay rw\\n2 1 8:2 / /external-seed rw - ext4 fixture rw\\n';
      fs.mkdirSync('/host/proc/1',{recursive:true});fs.writeFileSync('/host/proc/1/mountinfo',mounts);
      operation.prepareLocal({PERSISTENCE_MODE:'local',PERSISTENT_MOUNT:'/',PERSISTENT_DIR:'/live-root'},'/host',mounts);
      const seed='/host/external-seed/seed',stage=seed+'/.harvest-fixture';
      for(const relative of ['srv/gitlab/config','srv/gitlab/log','srv/gitlab/data','ssl/acme-http01','ssl/live/example','letsencrypt/renewal'])
        fs.mkdirSync(path.join(stage,relative),{recursive:true,mode:0o700});
      fs.chmodSync(stage+'/ssl',0o711);fs.chmodSync(stage+'/ssl/acme-http01',0o755);
      fs.writeFileSync(stage+'/srv/gitlab/data/identity','restorable fixture identity',{mode:0o600});
      fs.writeFileSync(stage+'/ssl/live/example/privkey.pem','synthetic private key',{mode:0o600});
      fs.writeFileSync(stage+'/letsencrypt/renewal/example.conf','synthetic renewal state',{mode:0o600});
      process.env.GITLAB_IMAGE='fixture-gitlab:under-test';process.env.GITLAB_IMAGE_ID=${JSON.stringify(image)};
      manifest.create(stage);manifest.publish(seed,stage);`);
    if(configurationExporter){
      phase='wizard-exporter-integrity';
      const bytes=fs.readFileSync(configurationExporter.archive);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),configurationExporter.sha256);
      const example=fs.readFileSync(path.join(sourceRoot,'system/.docker.env.example'),'utf8');
      const main=example.replace(/^(?:export )?GITLAB_IMAGE=.*$/m,"export GITLAB_IMAGE='fixture-gitlab:under-test'");
      code(initializer,`const fs=require('node:fs');fs.writeFileSync('/system/export-configuration.cjs',Buffer.from(${JSON.stringify(bytes.toString('base64'))},'base64'));
        fs.writeFileSync('/system/input.json',JSON.stringify({main:{data:${JSON.stringify(main)}},projects:[]}));`);
      phase='actual-wizard-export';docker(['exec',initializer,'node','/system/export-configuration.cjs','/system/input.json','/host/bootstrapper.zip']);
    } else {
      code(initializer,`require('node:fs').writeFileSync('/host/bootstrapper.zip',Buffer.from(${JSON.stringify(fs.readFileSync(backup).toString('base64'))},'base64'));`);
    }
    phase='native-helper-bindings';const helper=name+'-helper';
    const mount=(sub,destination)=>['--mount','type=volume,src='+volume+',dst='+destination+',volume-subpath='+sub];
    create(helper,['--mount','type=volume,src='+volume+',dst=/host',...mount('live-root','/live'),
      ...mount('external-seed/seed','/seed'),...['config','logs','data'].flatMap(dir=>mount('live-root/gitlab/'+dir,'/srv/gitlab/'+(dir==='logs'?'log':dir)))]);
    phase='native-restore-and-verification';code(helper,`const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
      const operation=require('/system/system/seed-operation');
      fs.copyFileSync('/host/bootstrapper.zip','/system/bootstrapper.zip');
      const hash=()=>crypto.createHash('sha256').update(fs.readFileSync('/host/bootstrapper.zip')).digest('hex'),before=hash();
      operation.validateBackup('/system/bootstrapper.zip');
      fs.writeFileSync('/probe-bin/docker',
        '#!/usr/local/bin/node\\nconst a=process.argv.slice(2);if(a[0]?.startsWith("--host="))a.shift();'+
        'if(a[0]==="image"&&a[1]==="inspect")console.log('+${JSON.stringify(JSON.stringify(image))}+');'+
        'else if(!(["info","ps"].includes(a[0])||(a[0]==="container"&&a[1]==="ls")))process.exitCode=2;\\n',{mode:0o700});
      process.env.PATH='/probe-bin:'+process.env.PATH;
      operation.inside({PERSISTENCE_MODE:'local',PERSISTENT_MOUNT:'/',PERSISTENT_DIR:'/live-root',
        SEED_DIR:'/external-seed/seed',SEED_MOUNT:'/external-seed',GITLAB_IMAGE:'fixture-gitlab:under-test',
        backup:true,operation:'restore',helperName:${JSON.stringify(helper)},imageId:${JSON.stringify(image)}});
      assert.equal(hash(),before,'the actual exported ZIP is never rewritten');
      assert.equal(fs.readFileSync('/live/gitlab/data/identity','utf8'),'restorable fixture identity');
      for(const [relative,mode] of [['ssl',0o711],['ssl/acme-http01',0o755],['ssl/live',0o700],['ssl/live/example/privkey.pem',0o600]])
        assert.equal(fs.statSync('/live/'+relative).mode&0o777,mode);
      for(const relative of ['gitlab/data/.system-bootstrapper-restore-incomplete','configuration/.storage-operation-lock',
        'configuration/.projects.env/.wizard.env.environments.lock','host/letsencrypt/.system-bootstrapper-certificate-lock'])assert(!fs.existsSync('/live/'+relative));
      const main=fs.readFileSync('/live/configuration/.docker.env');assert.equal(main[807],36);
      assert.equal(crypto.createHash('md5').update(main.subarray(0,1184)).digest('hex'),'bd4a8426355824593a5e21ad759830c1');
      assert(fs.existsSync('/live/configuration/.projects.env'));`);
    console.log('Native restore ZIP probe passed: unchanged Wizard DOS backup, actual import/Seed/rsync, retained private modes.');
  }catch(error){
    console.error('Native restore ZIP probe failed at '+phase+'.');
    primary=Error('Native restore ZIP probe failed at '+phase+': '+error.message);
  }
  const failed=[];
  for(const container of created.reverse())try{
    const names=docker(['container','ls','--all','--filter','name=^/'+container+'$','--format','{{.Names}}']);
    if(!names)continue;
    assert.equal(names,container);const row=inspect(['inspect',container])[0];
    assert.equal(row.Name,'/'+container);assert.equal(row.Image,image);assert.equal(row.Config.Labels?.[label],name);
    docker(['rm','--force',container]);
  }catch{failed.push(container);}
  if(volumeIntended)try{
    const names=docker(['volume','ls','--filter','name=^'+volume+'$','--format','{{.Name}}']);
    if(names){assert.equal(names,volume);const row=inspect(['volume','inspect',volume])[0];assert.equal(row.Labels?.[label],name);docker(['volume','rm',volume]);}
  }catch{failed.push(volume);}
  if(failed.length)throw Error('Native restore probe owned resource cleanup failed.');
  if(primary)throw primary;
}
module.exports={run};
if(require.main===module){
  const args=process.argv.slice(2);
  assert.deepEqual([args[0],args[2]],['--helper-image','--backup']);assert.equal(args.length,4);
  run({helperImage:args[1],backup:args[3]});
}
