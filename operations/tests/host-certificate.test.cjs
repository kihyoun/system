const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {HostCertificateService,rebindRenewal}=require('../dist/host-bootstrap/certificate.service');
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-cert-'));const data=path.join(root,'data');fs.mkdirSync(path.join(data,'host/letsencrypt'),{recursive:true});fs.mkdirSync(path.join(data,'ssl'),{recursive:true});fs.writeFileSync(path.join(data,'.system-bootstrapper-volume'),'system-bootstrapper-persistence-v1\n');return {root,data,env:{PERSISTENCE_MODE:'local',PERSISTENT_MOUNT:'/',PERSISTENT_DIR:data}};}
function runner(env,callback){return {async run(binary,args,options){if(binary==='bash')return Object.entries(env).map(([k,v])=>k+'='+v+'\0').join('');return callback(binary,args,options);}};}
test('renewal holds shared lease during child, refuses concurrent owner and releases on failure',async()=>{
 const f=fixture(),lock=path.join(f.data,'host/letsencrypt/.system-bootstrapper-certificate-lock');
 try{
  const service=new HostCertificateService(runner(f.env,async binary=>{assert.equal(binary,'/usr/bin/certbot');assert(fs.existsSync(lock));throw Error('renewal failed');}),f.root);
  await assert.rejects(service.renew(f.root,['renew'],f.env),/renewal failed/);assert(!fs.existsSync(lock));
  fs.mkdirSync(lock);await assert.rejects(service.renew(f.root,['renew'],f.env),/EEXIST/);assert(fs.existsSync(lock));
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('certificate publication retains private key mode and refuses destination escape before writes',async()=>{
 const f=fixture();try{
  const lineage=path.join(f.root,'etc/letsencrypt/live/example.test');fs.mkdirSync(lineage,{recursive:true});fs.writeFileSync(path.join(lineage,'fullchain.pem'),'cert');fs.writeFileSync(path.join(lineage,'privkey.pem'),'private');f.env.RENEWED_LINEAGE=lineage;
  const service=new HostCertificateService(runner(f.env,async()=> 'false'),f.root);
  await service.publish(f.root,f.env);const target=path.join(f.data,'ssl/live/example.test');assert.equal(fs.statSync(path.join(target,'privkey.pem')).mode&0o777,0o600);
  fs.rmSync(path.join(f.data,'ssl/live'),{recursive:true});const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.data,'ssl/live'));
  await assert.rejects(service.publish(f.root,f.env),/escape/);assert.deepEqual(fs.readdirSync(outside),[]);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('renewal rebind changes only webroot authenticator mappings and leaves other sections',()=>{
 const input='authenticator = webroot\nwebroot_path = /old,\n[[webroot_map]]\nexample.test = /old\n[other]\noption = /retain\n';
 assert.equal(rebindRenewal(input,'/new'),input.replaceAll('/old','/new'));
 assert.equal(rebindRenewal(input.replace('authenticator = webroot','authenticator = dns'),' /bad'.trim()),input.replace('authenticator = webroot','authenticator = dns'));
 assert.throws(()=>rebindRenewal(input,'/bad\npath'),/Invalid/);
});
