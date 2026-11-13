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
  const command=(args,{input,status=0}={})=>{
    const result=spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
    if(result.error || result.status!==status)throw Error('HTTP-01 probe command failed: '+args[0]+
      ' (expected '+status+', received '+result.status+').');
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
    const hostname='app.example.test',unknown='unknown.example.test';
    const html='<html>application-proxy-fixture</html>\n',media='0123456789abcdefghijklmnopqrstuv';
    assert.equal(Buffer.byteLength(media),32);
    const write=(filename,content)=>command(['exec','--interactive',proxy,'sh','-c','cat > '+filename],{input:content});
    command(['exec',proxy,'sh','-ec','command -v openssl >/dev/null; mkdir -p /tmp/app']);
    write('/tmp/app/index.html',html);write('/tmp/app/media.bin',media);
    const templateDirectory=path.join(__dirname,'../../nginx/.templates');
    const fallback=fs.readFileSync(path.join(templateDirectory,'acme-http01.conf.template'),'utf8');
    const application=ssl=>{
      const values={PROXY_UPSTREAM:'probe_application',PROXY_IP:'127.0.0.1',PROXY_PORT:'8080',PROXY_HOSTNAME:hostname,
        PROXY_SSL_CERT_PATH:'/tmp/probe-leaf.pem',PROXY_SSL_CERT_KEY_PATH:'/tmp/probe-leaf.key'};
      return fs.readFileSync(path.join(templateDirectory,ssl?'default.ssl.conf.template':'default.conf.template'),'utf8')
        .replace(/\$\{(PROXY_[A-Z_]+)\}/g,(_,key)=>{assert(Object.hasOwn(values,key),'Unexpected application template selector: '+key);return values[key];});
    };
    const configure=ssl=>{
      write('/tmp/http01-nginx.conf','user nginx; worker_processes 1; pid /tmp/nginx.pid; error_log /dev/stderr; events {} http { access_log off; '+
        'server { listen 127.0.0.1:8080; server_name backend; root /tmp/app; add_header X-HTTP01-Probe-Backend app always; '+
        'location / { try_files $uri $uri/ /index.html; } }\n'+fallback+'\n'+application(ssl)+'\n}\n');
      command(['exec',proxy,'nginx','-t','-c','/tmp/http01-nginx.conf']);
    };
    const request=({host=hostname,uri='/',ssl=false,range,retry=false,status=0}={})=>{
      const result=command(['exec',proxy,'curl','--silent','--show-error','--noproxy','*','--max-time','5','--include',
        '--resolve',host+':'+(ssl?'443':'80')+':127.0.0.1',...(ssl?['--cacert','/tmp/probe-ca.pem']:[]),
        ...(range?['--range',range]:[]),...(retry?['--retry','10','--retry-delay','1','--retry-connrefused','--retry-max-time','10']:[]),
        (ssl?'https://':'http://')+host+uri],{status});
      if(status!==0)return result;
      const separator=result.stdout.indexOf('\r\n\r\n');assert(separator>=0,'Expected HTTP response headers.');
      return {headers:result.stdout.slice(0,separator),body:result.stdout.slice(separator+4)};
    };
    const token=host=>request({host,uri:'/.well-known/acme-challenge/probe'});
    const assertApplication=ssl=>{
      for(const uri of ['/','/nested/client/route?probe=spa']){
        const response=request({uri,ssl});assert.match(response.headers,/^HTTP\/1\.1 200 OK/);
        assert.match(response.headers,/\r\nX-HTTP01-Probe-Backend: app/i);assert.equal(response.body,html);
      }
      const response=request({uri:'/media.bin',ssl,range:'5-12'});
      assert.match(response.headers,/^HTTP\/1\.1 206 Partial Content/);
      assert.match(response.headers,/\r\nContent-Range: bytes 5-12\/32(?:\r\n|$)/i);
      assert.match(response.headers,/\r\nX-HTTP01-Probe-Backend: app/i);assert.equal(response.body,media.slice(5,13));
    };
    configure(false);
    command(['exec',proxy,'nginx','-c','/tmp/http01-nginx.conf']);
    for(const host of [hostname,unknown])assert.match(token(host).headers,/^HTTP\/1\.1 404 /);
    assert.match(request({host:unknown}).headers,/^HTTP\/1\.1 404 /);
    assertApplication(false);
    // This isolates HTTP worker permissions; the full candidate separately proves
    // native host mount selection. The volume fixture supplies its mount record.
    executeHelper(`const operation=require('/tmp/native-seed-operation');
      operation.prepareLocal({PERSISTENCE_MODE:'local',PERSISTENT_MOUNT:'/',PERSISTENT_DIR:'/data/platform'},
      '/host','1 0 0:1 / / rw - overlay overlay rw\\n');
      const fs=require('node:fs'),assert=require('node:assert/strict'),ssl='/host/data/platform/ssl';
      for(const [relative,mode] of [['',0o711],['/acme-http01',0o755],['/live',0o700],['/live/example/privkey.pem',0o600]])
        assert.equal(fs.statSync(ssl+relative).mode&0o777,mode);`);
    const assertTokens=()=>{
      for(const host of [hostname,unknown]){
        const response=token(host);assert.match(response.headers,/^HTTP\/1\.1 200 OK/);
        assert.doesNotMatch(response.headers,/\r\nLocation:/i);assert.equal(response.body,'public-http01-probe');
      }
    };
    assertTokens();assertApplication(false);
    command(['exec','--user','nginx',proxy,'sh','-c',
      'if cat /ssl/live/example/privkey.pem >/dev/null 2>&1; then exit 1; fi; if ls /ssl/live >/dev/null 2>&1; then exit 1; fi']);
    write('/tmp/probe-leaf.ext','subjectAltName=DNS:'+hostname+'\nbasicConstraints=critical,CA:FALSE\n'+
      'keyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
    // Keys exist only in this owned container's tmpfs; curl trusts only its fixture CA.
    command(['exec',proxy,'sh','-ec',
      'umask 077; openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 '+
      '-keyout /tmp/probe-ca.key -out /tmp/probe-ca.pem -subj /CN=HTTP01-Probe-CA '+
      '-addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign; '+
      'openssl req -new -newkey rsa:2048 -nodes -sha256 -keyout /tmp/probe-leaf.key '+
      '-out /tmp/probe-leaf.csr -subj /CN='+hostname+'; '+
      'openssl x509 -req -in /tmp/probe-leaf.csr -CA /tmp/probe-ca.pem -CAkey /tmp/probe-ca.key '+
      '-CAcreateserial -out /tmp/probe-leaf.pem -days 1 -sha256 -extfile /tmp/probe-leaf.ext']);
    configure(true);command(['exec',proxy,'nginx','-s','reload','-c','/tmp/http01-nginx.conf']);
    assert.match(request({ssl:true,retry:true}).headers,/^HTTP\/1\.1 200 OK/);
    const mismatch=request({host:unknown,ssl:true,status:60});assert.match(mismatch.stderr,/certificate|SSL/i);
    assertApplication(true);
    const redirectUri='/nested/client/route?probe=path%2Fquery&keep=1';
    const redirect=request({uri:redirectUri});assert.match(redirect.headers,/^HTTP\/1\.1 301 /);
    assert(redirect.headers.split('\r\n').some(line=>line==='Location: https://'+hostname+redirectUri));
    assertTokens();assert.match(request({host:unknown}).headers,/^HTTP\/1\.1 404 /);
    console.log('HTTP-01 application probe passed: native prepare, HTTP/verified HTTPS SPA and ranges, hostname rejection, redirect, fallback and private key isolation.');
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
