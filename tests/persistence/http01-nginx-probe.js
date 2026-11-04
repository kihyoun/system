#!/usr/bin/env node
'use strict';
// A real worker serves public tokens from an owned volume; no GitLab or public ports.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const label='org.system-bootstrapper.http01-probe';
function run({helperImage,nginxImage}) {
  assert(helperImage && /^nginx@sha256:[a-f0-9]{64}$/.test(nginxImage),'Exact helper and pinned NGINX images required.');
  const name='system-http01-'+crypto.randomBytes(12).toString('hex');
  const volume=name+'-data',helper=name+'-helper',proxy=name+'-nginx';
  const containers=[];let volumeCreated=false,primary;
  const command=(args,{input}={})=>{
    const result=spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
    if(result.error || result.status!==0)throw Error('HTTP-01 probe command failed: '+args[0]);
    return result;
  };
  const json=args=>JSON.parse(command(args).stdout);
  const identities=Object.fromEntries([['helper',helperImage],['proxy',nginxImage]].map(([role,image])=>{
    const row=json(['image','inspect',image])[0];assert.match(row.Id,/^sha256:[a-f0-9]{64}$/);
    if(role==='proxy')assert(row.RepoDigests.includes(nginxImage));
    return [role,row.Id];
  }));
  const ownedContainer=(container,image)=>{
    const row=json(['inspect',container])[0];
    assert.equal(row.Name,'/'+container);assert.equal(row.Image,image);assert.equal(row.Config.Labels?.[label],name);
  };
  const executeHelper=source=>command(['exec','--interactive',helper,'node','-'],{input:source});
  try {
    // Record intent first: an interrupted Docker reply can still have created it.
    volumeCreated=true;command(['volume','create','--label',label+'='+name,volume]);
    containers.push([helper,identities.helper]);
    command(['create','--name',helper,'--label',label+'='+name,'--network','none','--read-only',
      '--tmpfs','/tmp:rw,noexec,nosuid,size=4m','--mount','type=volume,src='+volume+',dst=/host',
      '--memory','128m','--cpus','0.25','--pids-limit','64','--entrypoint','node',identities.helper,
      '-e','setInterval(()=>{},1000)']);command(['start',helper]);
    executeHelper(`const fs=require('node:fs');fs.writeFileSync('/tmp/native-seed-operation.js',${JSON.stringify(fs.readFileSync(path.join(__dirname,'../../system/seed-operation.js'),'utf8'))});`);
    executeHelper(`const fs=require('node:fs');
      const ssl='/host/data/platform/ssl';
      fs.mkdirSync(ssl+'/acme-http01/.well-known/acme-challenge',{recursive:true,mode:0o755});
      fs.chmodSync(ssl,0o700);
      fs.mkdirSync(ssl+'/live/example',{recursive:true,mode:0o700});
      fs.writeFileSync(ssl+'/live/example/privkey.pem','private synthetic key',{mode:0o600});
      fs.writeFileSync(ssl+'/acme-http01/.well-known/acme-challenge/probe','public-http01-probe',{mode:0o644});`);
    containers.push([proxy,identities.proxy]);
    command(['create','--name',proxy,'--label',label+'='+name,'--network','none','--read-only',
      '--tmpfs','/tmp:rw,noexec,nosuid,size=4m','--tmpfs','/var/cache/nginx:rw,noexec,nosuid,size=4m',
      '--mount','type=volume,src='+volume+',dst=/ssl,volume-subpath=data/platform/ssl,readonly',
      '--memory','64m','--cpus','0.25','--pids-limit','64','--entrypoint','/bin/sh',identities.proxy,
      '-c','sleep 600']);command(['start',proxy]);
    const template=fs.readFileSync(path.join(__dirname,'../../nginx/.templates/acme-http01.conf.template'),'utf8');
    command(['exec','--interactive',proxy,'sh','-c','cat > /tmp/http01-nginx.conf'],{input:
      'user nginx; pid /tmp/nginx.pid; error_log /dev/stderr; events {} http { access_log off; '+template+' }\n'});
    command(['exec',proxy,'nginx','-c','/tmp/http01-nginx.conf']);
    const get=()=>command(['exec',proxy,'curl','--silent','--show-error','--max-time','5','--include',
      'http://127.0.0.1/.well-known/acme-challenge/probe']);
    const before=get();assert.match(before.stdout,/^HTTP\/1\.1 404 /);
    // This isolates HTTP worker permissions; the full candidate separately proves
    // native host mount selection. The volume fixture supplies its mount record.
    executeHelper(`const operation=require('/tmp/native-seed-operation');
      operation.prepareLocal({PERSISTENCE_MODE:'local',PERSISTENT_MOUNT:'/',PERSISTENT_DIR:'/data/platform'},
      '/host','1 0 0:1 / / rw - overlay overlay rw\\n');
      const fs=require('node:fs'),assert=require('node:assert/strict'),ssl='/host/data/platform/ssl';
      for(const [relative,mode] of [['',0o711],['/acme-http01',0o755],['/live',0o700],['/live/example/privkey.pem',0o600]])
        assert.equal(fs.statSync(ssl+relative).mode&0o777,mode);`);
    const after=get();assert.match(after.stdout,/^HTTP\/1\.1 200 OK/);assert.equal(after.stdout.split('\r\n\r\n')[1],'public-http01-probe');
    command(['exec','--user','nginx',proxy,'sh','-c',
      'if cat /ssl/live/example/privkey.pem >/dev/null 2>&1; then exit 1; fi; if ls /ssl/live >/dev/null 2>&1; then exit 1; fi']);
    console.log('HTTP-01 worker probe passed: legacy 404, native prepare 200, private key inaccessible.');
  } catch(error) {primary=error;}
  const failed=[];
  for(const [container,image] of containers.reverse())try{
    const names=command(['container','ls','--all','--filter','name=^/'+container+'$','--format','{{.Names}}']).stdout.trim();
    if(!names)continue;
    assert.equal(names,container);ownedContainer(container,image);command(['rm','--force',container]);
  }catch{failed.push(container);}
  if(volumeCreated)try{
    const names=command(['volume','ls','--filter','name=^'+volume+'$','--format','{{.Name}}']).stdout.trim();
    if(names){
      assert.equal(names,volume);
      const row=json(['volume','inspect',volume])[0];assert.equal(row.Name,volume);assert.equal(row.Labels?.[label],name);
      command(['volume','rm',volume]);
    }
  }catch{failed.push(volume);}
  if(failed.length)throw Error('HTTP-01 probe owned resource cleanup failed.');
  if(primary)throw primary;
}
module.exports={run};
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length!==4 || args[0]!=='--helper-image' || args[2]!=='--nginx-image')throw Error('Expected --helper-image IMAGE --nginx-image PIN.');
  run({helperImage:args[1],nginxImage:args[3]});
}
