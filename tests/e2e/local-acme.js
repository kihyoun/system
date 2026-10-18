'use strict';
// Test-only external authority. It survives both disposable platform hosts;
// never start a second GitLab daemon or publish an outer port here.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {Candidate,LABEL}=require('../shared/disposable-candidate');
const PINNED={
  pebble:'ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199',
  dns:'ghcr.io/letsencrypt/pebble-challtestsrv@sha256:12ce21884def456bcf9786542113949e1f19dc7738d2c70e156c2d0c38a1405b',
  certbot:'certbot/certbot@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20'
};
const TRUST_HASH='0c502e52627ff7de972c7e9e065640103b4589b4e2d23d3fcf21bef1e3c8c67c';
const ISSUANCE_CA='/ssl/.acme-fixture-issuance-ca.pem';
const DIRECTORY='https://pebble:14000/dir';
const CLIENT_ALIAS='acme-certbot:under-test';
function hashFile(filename){
  const fd=fs.openSync(filename,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);
  try{let size;while((size=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,size));}finally{fs.closeSync(fd);}
  return hash.digest('hex');
}
function validate(spec,trustPath=path.join(__dirname,'acme-fixture/pebble.minica.pem')){
  const images=spec.acmeImages;
  if(!images||Object.keys(images).sort().join()!=='certbot,dns,pebble')throw Error('acme-declared-images-required');
  for(const [role,pin]of Object.entries(PINNED)){
    if(images[role].reference!==pin||!/^sha256:[a-f0-9]{64}$/.test(images[role].id||''))throw Error('acme-pinned-image-required');
  }
  const archive=images.certbot.archive;
  if(!path.isAbsolute(archive||'')||!/^[a-f0-9]{64}$/.test(images.certbot.sha256||''))throw Error('acme-client-archive-required');
  const stat=fs.lstatSync(archive);
  if(!stat.isFile()||stat.isSymbolicLink()||hashFile(archive)!==images.certbot.sha256)throw Error('acme-client-archive-identity-mismatch');
  const trustStat=fs.lstatSync(trustPath);
  if(!trustStat.isFile()||trustStat.isSymbolicLink()||hashFile(trustPath)!==TRUST_HASH)throw Error('acme-fixture-trust-identity-mismatch');
  return {images,trust:fs.readFileSync(trustPath,'utf8')};
}
function pebbleConfiguration(){return {pebble:{listenAddress:'0.0.0.0:14000',managementListenAddress:'0.0.0.0:15000',
  certificate:'/test/certs/localhost/cert.pem',privateKey:'/test/certs/localhost/key.pem',httpPort:80,tlsPort:443,
  externalAccountBindingRequired:false,retryAfter:{authz:1,order:1}}};}
function address(text,network){
  const ip=JSON.parse(text)[network]?.IPAddress;
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(ip||''))throw Error('acme-private-address-required');
  return ip;
}
function basePaths(base){
  if(!['/candidate-data/platform','/recovered-data/platform'].includes(base))throw Error('acme-owned-data-root-required');
  return {base,parent:path.posix.dirname(base),state:base+'/host/letsencrypt',tools:base+'/acme-test-tools',webroot:base+'/ssl/acme-http01'};
}
async function controller(candidate,action,input){
  const script="let t='';process.stdin.on('data',x=>t+=x);process.stdin.on('end',async()=>{try{const input=JSON.parse(t);const result=await ("+action.toString()+")(input);if(result!==undefined)process.stdout.write(JSON.stringify(result));}catch{process.exitCode=1;}});";
  const text=await candidate.inner(['exec','-i','system_bootstrapper_1','node','-e',script],{input:JSON.stringify(input),timeout:20000});
  return text?JSON.parse(text):undefined;
}
async function request(candidate,url,input={}){
  return controller(candidate,async function(input){
    const http=require(input.trust?'https':'http');
    return await new Promise((resolve,reject)=>{
      const parsed=new URL(input.url);
      const req=http.request(parsed,{method:input.body?'POST':'GET',timeout:10000,
        ...(input.trust?{ca:input.trust,rejectUnauthorized:true,servername:'pebble',lookup:(_name,options,done)=>options.all?done(null,[{address:input.address,family:4}]):done(null,input.address,4)}:{}),
        headers:{'User-Agent':'system-bootstrapper-local-acme-test',...(input.body?{'Content-Type':'application/json'}:{})}},response=>{
        const chunks=[];let size=0;response.on('data',part=>{size+=part.length;if(size>65536){req.destroy();reject(Error());}else chunks.push(part);});
        response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
      });
      req.on('error',reject);req.on('timeout',()=>req.destroy(Error()));req.end(input.body?JSON.stringify(input.body):undefined);
    });
  },{url,...input});
}
// The GitLab image supplies real host mount utilities. The only adapter is the
// certbot executable's Docker transport; the lease and deploy scripts are exact
// fresh-source bytes, and run with real bind mounts and the owned inner socket.
function hostProgram(paths,caAddress,certbotReference,scripts){
  const q=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
  const marker=paths.state+'/.fixture-deploy-fired';
  const shim='#!/bin/bash\nset -euo pipefail\n'+
    'rm -f '+q(marker)+'\n'+
    'docker run --rm --pull never --name acme-certbot-operation --memory 256m --cpus 0.5 --cap-drop ALL --security-opt no-new-privileges '+
    '--tmpfs /var/lib/letsencrypt --tmpfs /var/log/letsencrypt --add-host '+q('pebble:'+caAddress)+' '+
    '--env REQUESTS_CA_BUNDLE=/fixture-tools/pebble.minica.pem '+
    '--volume '+q(paths.state+':/etc/letsencrypt')+' --volume '+q(paths.tools+':/fixture-tools:ro')+' '+
    '--volume '+q(paths.webroot+':'+paths.webroot)+' '+q(certbotReference)+' "$@" '+
    '--deploy-hook '+q('touch /etc/letsencrypt/.fixture-deploy-fired')+'\n'+
    'if [ -f '+q(marker)+' ]; then RENEWED_LINEAGE=/etc/letsencrypt/live/recovery-fixture bash /tmp/install-volume-certificate.sh; fi\n';
  return 'set -euo pipefail\numask 077\n'+
    "printf '%s' "+q('PERSISTENT_MOUNT='+paths.parent+'\nPERSISTENT_DIR='+paths.base+'\n')+' > /tmp/persistence.env\n'+
    'export PERSISTENCE_ENV_FILE=/tmp/persistence.env\n'+
    "printf '%s' "+q(shim)+' > /usr/bin/certbot\nchmod 700 /usr/bin/certbot\n'+
    "printf '%s' "+q(scripts.install)+' > /tmp/install-volume-certificate.sh\n'+
    "printf '%s' "+q(scripts.lease)+' > /tmp/certbot-with-volume-lock.sh\n'+
    'bash /tmp/certbot-with-volume-lock.sh "$@"\n';
}
class LocalAcme {
  constructor(original,reportDirectory,dependencies={}){
    const checked=validate(original.spec,dependencies.trustPath);
    this.images=checked.images;this.trust=checked.trust;this.original=original;this.attachments=[];this.ready=false;
    const Owner=dependencies.Owner||Candidate;
    this.owners=['authority','dns','initializer'].map(role=>{
      const owner=new Owner({...original.spec,fullAcceptance:false},{checkpoint:instance=>instance.report(reportDirectory(instance))});
      owner.deadline=original.deadline;
      Object.defineProperty(owner,'canceled',{configurable:true,get:()=>original.canceled,set:()=>{}});
      owner.report(reportDirectory(owner));return owner;
    });
    [this.authority,this.dns,this.initializer]=this.owners;
    this.reportDirectory=reportDirectory;
    this.scripts=dependencies.scripts||{
      lease:fs.readFileSync(path.join(__dirname,'../../bootstrapper/certbot-with-volume-lock.sh'),'utf8'),
      install:fs.readFileSync(path.join(__dirname,'../../bootstrapper/install-volume-certificate.sh'),'utf8')
    };
  }
  async start(){
    const a=this.authority,d=this.dns,i=this.initializer;
    await this.original.stage('acme-independent-authority-start',async()=>{
      for(const role of ['pebble','dns','certbot']){
        const item=this.images[role];
        const actual=JSON.parse(await a.call(['image','inspect','--format','{{json .}}',item.reference]));
        if(actual.Id!==item.id||!actual.RepoDigests?.includes(item.reference))throw Error('acme-public-image-identity-mismatch');
        const volumes=Object.keys(actual.Config?.Volumes||{});
        const allowed=role==='certbot'?['/etc/letsencrypt','/var/lib/letsencrypt']:[];
        if(volumes.some(volume=>!allowed.includes(volume)))throw Error('acme-unowned-image-volume-refused');
      }
      await a.create('network',['network','create','--internal','--label',LABEL+'='+a.id,a.name]);
      await a.create('volume',['volume','create','--label',LABEL+'='+a.id,a.name]);
      this.dnsContainer=await d.create('container',['create','--name',d.name,'--label',LABEL+'='+d.id,'--network',a.name,
        '--memory','64m','--cpus','0.2','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
        '--pull','never',this.images.dns.reference,'-defaultIPv4','127.0.0.1','-defaultIPv6','','-http01','','-https01','','-tlsalpn01','']);
      await d.call(['start',this.dnsContainer]);
      this.dnsAddress=address(await d.call(['inspect','--format','{{json .NetworkSettings.Networks}}',this.dnsContainer]),a.name);
      const init=await i.create('container',['create','-i','--name',i.name,'--label',LABEL+'='+i.id,'--network','none','--memory','128m','--cpus','0.25',
        '--read-only','--tmpfs','/tmp','--tmpfs','/etc/letsencrypt','--tmpfs','/var/lib/letsencrypt','--volume',a.name+':/fixture',
        '--pull','never','--entrypoint','python',this.images.certbot.reference,'-c',
        "import sys,json,os; fd=os.open('/fixture/pebble.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600); os.write(fd,sys.stdin.buffer.read()); os.fsync(fd); os.close(fd)"]);
      await i.call(['start','--attach','--interactive',init],{input:JSON.stringify(pebbleConfiguration())});
      const exit=await i.call(['wait',init]);if(exit!=='0')throw Error('acme-config-initialization-failed');
      if(!i.cleanup())throw Error('acme-initializer-cleanup-failed');i.report(this.reportDirectory(i));
      this.caContainer=await a.create('container',['create','--name',a.name,'--label',LABEL+'='+a.id,'--network',a.name,'--network-alias','pebble',
        '--memory','192m','--cpus','0.3','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--volume',a.name+':/fixture:ro',
        '--env','PEBBLE_VA_NOSLEEP=1','--env','PEBBLE_WFE_NONCEREJECT=0','--env','PEBBLE_AUTHZREUSE=0',
        '--pull','never',this.images.pebble.reference,'-config','/fixture/pebble.json','-dnsserver',this.dnsAddress+':8053','-strict']);
      await a.call(['start',this.caContainer]);
      this.caAddress=address(await a.call(['inspect','--format','{{json .NetworkSettings.Networks}}',this.caContainer]),a.name);
      this.ready=true;
    });
  }
  async attach(candidate){
    if(!this.ready)throw Error('acme-authority-not-started');
    const inspected=JSON.parse(await this.authority.call(['container','inspect',candidate.daemon]))[0];
    if(inspected?.Id!==candidate.daemon||inspected.Name!=='/'+candidate.name||inspected.Config?.Labels?.[LABEL]!==candidate.id)throw Error('acme-foreign-candidate-refused');
    await this.authority.call(['network','connect',this.authority.name,candidate.daemon]);
    this.attachments.push(candidate);
    const ip=address(await this.authority.call(['inspect','--format','{{json .NetworkSettings.Networks}}',candidate.daemon]),this.authority.name);
    await candidate.wait(async()=>{const r=await request(candidate,'http://'+this.dnsAddress+':8055/set-default-ipv4',{body:{ip}});return r.status===200;},30000);
    await candidate.wait(async()=>{const r=await request(candidate,DIRECTORY,{trust:this.trust,address:this.caAddress});return r.status===200;},30000);
    return ip;
  }
  async prepareClient(candidate,base){
    const p=basePaths(base),item=this.images.certbot;
    await candidate.call(['exec','-i',candidate.daemon,'docker','load','--quiet'],{inputFile:item.archive,timeout:120000});
    const id=await candidate.inner(['image','inspect','--format','{{.Id}}',item.id]);
    if(id!==item.id)throw Error('acme-loaded-client-identity-mismatch');
    // Docker save/load does not promise to retain RepoDigests. The archive's
    // verified source pin/hash and loaded image ID define this explicit alias.
    await candidate.inner(['tag',item.id,CLIENT_ALIAS]);
    await candidate.call(['exec',candidate.daemon,'mkdir','-p',p.tools,p.webroot]);
    await candidate.call(['exec','-i',candidate.daemon,'sh','-c','umask 077; cat > "$1"','sh',p.tools+'/pebble.minica.pem'],{input:this.trust});
    await candidate.call(['exec','-i',candidate.daemon,'sh','-c','printf "%s" system-bootstrapper-persistence-v1 > "$1"','sh',p.base+'/.system-bootstrapper-volume']);
    await candidate.inner(['run','--rm','--pull','never','--network','none','--memory','128m','--cpus','0.25','--volume',p.tools+':/fixture-tools','--entrypoint','/bin/sh','system-candidate:under-test',
      '-ec','cp /usr/bin/docker /fixture-tools/docker; cp /lib/ld-musl-x86_64.so.1 /fixture-tools/ld-musl-x86_64.so.1; chmod 755 /fixture-tools/docker /fixture-tools/ld-musl-x86_64.so.1']);
    return p;
  }
  async certbot(candidate,base,args){
    const p=basePaths(base);
    await candidate.inner(['run','--rm','--pull','never','-i','--name','acme-host-integration','--network','none','--memory','256m','--cpus','0.5','--entrypoint','/bin/bash',
      '--env','PATH=/fixture-tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      '--volume','/var/run/docker.sock:/var/run/docker.sock','--volume',p.parent+':'+p.parent,'--volume',p.state+':/etc/letsencrypt','--volume',p.tools+':/fixture-tools:ro',
      '--volume',p.tools+'/ld-musl-x86_64.so.1:/lib/ld-musl-x86_64.so.1:ro','--volume',p.tools+'/ld-musl-x86_64.so.1:/lib/libc.musl-x86_64.so.1:ro',
      'candidate-gitlab:under-test','-s','--',...args],{input:hostProgram(p,this.caAddress,CLIENT_ALIAS,this.scripts),timeout:120000});
  }
  async identity(candidate){
    return controller(candidate,function(){
      const fs=require('fs'),path=require('path'),crypto=require('crypto');
      const keys=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name==='private_key.json')keys.push(file);}}
      walk('/host-letsencrypt/accounts');if(keys.length!==1)throw Error();
      const key=keys[0],cert=fs.readFileSync('/ssl/live/recovery-fixture/fullchain.pem');
      return {account:path.relative('/host-letsencrypt/accounts',path.dirname(key)),keyHash:crypto.createHash('sha256').update(fs.readFileSync(key)).digest('hex'),
        serial:new crypto.X509Certificate(cert).serialNumber,certificateHash:crypto.createHash('sha256').update(cert).digest('hex')};
    },{});
  }
  async issue(candidate){
    return candidate.stage('acme-initial-webroot-issuance',async()=>{
      await this.attach(candidate);await this.prepareClient(candidate,'/candidate-data/platform');
      // Real TLS routing is active using the short-lived bootstrap certificate;
      // Certbot's HTTP-01 webroot will replace it through the actual deploy hook.
      await candidate.inner(['exec','-w','/system/nginx','system_bootstrapper_1','bash','-e','start.sh','reload']);
      await this.certbot(candidate,'/candidate-data/platform',['certonly','--server',DIRECTORY,'--non-interactive','--agree-tos','--register-unsafely-without-email',
        '--webroot','--webroot-path','/candidate-data/platform/ssl/acme-http01','--cert-name','recovery-fixture','-d','wizard.candidate.test','-d','sync.candidate.test']);
      const root=await request(candidate,'https://pebble:15000/roots/0',{trust:this.trust,address:this.caAddress});
      if(root.status!==200||!root.body.startsWith('-----BEGIN CERTIFICATE-----'))throw Error('acme-issuance-trust-required');
      await controller(candidate,input=>require('fs').writeFileSync(input.path,input.root,{mode:0o600}),{path:ISSUANCE_CA,root:root.body});
      return this.identity(candidate);
    });
  }
  async renew(candidate,expected){
    await candidate.stage('acme-restored-account-and-real-renewal',async()=>{
      const ip=await this.attach(candidate);await this.prepareClient(candidate,'/recovered-data/platform');
      const before=await this.identity(candidate);
      if(before.account!==expected.account||before.keyHash!==expected.keyHash||before.serial!==expected.serial)throw Error('acme-restored-account-identity-mismatch');
      // This isolated CA has no shared issuance load; avoid Certbot's default
      // non-interactive scheduling delay inside the bounded validation calls.
      const args=['renew','--server',DIRECTORY,'--non-interactive','--force-renewal','--no-random-sleep-on-renew','--cert-name','recovery-fixture'];
      const blocked=await request(candidate,'http://'+this.dnsAddress+':8055/set-default-ipv4',{body:{ip:'127.0.0.1'}});
      if(blocked.status!==200)throw Error('acme-negative-validation-setup-failed');
      let failed=false;try{await this.certbot(candidate,'/recovered-data/platform',args);}catch(error){if(error.exitCode!==1)throw error;failed=true;}
      finally{const restored=await request(candidate,'http://'+this.dnsAddress+':8055/set-default-ipv4',{body:{ip}});if(restored.status!==200)throw Error('acme-validation-target-restore-failed');}
      if(!failed)throw Error('acme-validation-bypass-detected');
      await this.certbot(candidate,'/recovered-data/platform',args);
      const after=await this.identity(candidate);
      if(after.account!==expected.account||after.keyHash!==expected.keyHash||after.serial===expected.serial||after.certificateHash===expected.certificateHash)throw Error('acme-renewal-did-not-replace-certificate');
      const {tlsProbe}=require('./recovery');
      await candidate.wait(async()=>{
        const response=await tlsProbe(candidate,'wizard.candidate.test','/',{},{certificate:ISSUANCE_CA});
        return response.status===200&&response.serial===after.serial;
      },30000);
      candidate.acmeRenewalVerified=true;
      if(candidate.evidence?.recovery)candidate.evidence.recovery.acmeRenewalVerified=true;
    });
  }
  cleanup(){
    // Cleanup may run after cancellation/deadline. Reuse the guarded synchronous
    // cleanup path, and prove every daemon identity before detaching a bridge.
    let success=true;
    for(const candidate of this.attachments){
      try{
        const listed=this.authority.exec(['container','ls','--all','--no-trunc','--format','{{.ID}}'],{timeout:10000}).split('\n');
        if(!listed.includes(candidate.daemon))continue;
        const actual=JSON.parse(this.authority.exec(['container','inspect',candidate.daemon],{timeout:10000}))[0];
        if(actual.Id!==candidate.daemon||actual.Name!=='/'+candidate.name||actual.Config?.Labels?.[LABEL]!==candidate.id)throw Error();
        if(actual.NetworkSettings?.Networks?.[this.authority.name])this.authority.exec(['network','disconnect','--force',this.authority.name,candidate.daemon],{timeout:10000});
      }catch{success=false;}
    }
    if(!success)return false;
    for(const owner of [...this.owners].reverse()){
      const clean=owner.cleanup();owner.report(this.reportDirectory(owner));if(!clean)return false;
    }
    return true;
  }
}
module.exports={LocalAcme,PINNED,TRUST_HASH,DIRECTORY,ISSUANCE_CA,validate,pebbleConfiguration,basePaths,hostProgram,request,hashFile};
