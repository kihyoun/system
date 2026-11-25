const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BuildToolsService,runtimePackages}=require('../../dist/modules/host-bootstrap/buildTools.service');
const checkout=path.resolve(__dirname,'../..');
test('reviewed trust replaces old roots and hash links only after hash verification',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-build-trust-'));
 try{
  const certs=path.join(root,'etc/ssl/certs');fs.mkdirSync(certs,{recursive:true});
  fs.writeFileSync(path.join(certs,'obsolete.pem'),'old');fs.symlinkSync('obsolete.pem',path.join(certs,'old-hash.0'));
  fs.mkdirSync(path.join(certs,'retained-directory'));
  const service=new BuildToolsService({},root);
  const bad=path.join(root,'checkout');fs.mkdirSync(path.join(bad,'config/ca'),{recursive:true});
  fs.writeFileSync(path.join(bad,'config/ca/cacert-2026-10-20.crt'),'wrong');
  assert.throws(()=>service.refreshCa(bad),/hash mismatch/);
  assert.equal(fs.readFileSync(path.join(certs,'obsolete.pem'),'utf8'),'old');
  service.refreshCa(checkout);
  assert.deepEqual(fs.readdirSync(certs).sort(),['ca-certificates.crt','retained-directory']);
  assert.equal(fs.readlinkSync(path.join(root,'etc/ssl/cert.pem')),'certs/ca-certificates.crt');
  const project=path.join(root,'project'),relative='cacert-2026-10-20.crt';
  fs.mkdirSync(path.join(project,'bootstrapper/ca'),{recursive:true});
  fs.copyFileSync(path.join(checkout,'config/ca',relative),path.join(project,'bootstrapper/ca',relative));
  assert.throws(()=>service.refreshCa(project),error=>error.code==='ENOENT','System layout must not fall back to the project bundle');
  fs.mkdirSync(path.join(project,'config/ca'),{recursive:true});
  fs.writeFileSync(path.join(project,'config/ca',relative),'wrong-system-layout');
  service.refreshCa(project,'project');
  const reviewed=fs.readFileSync(path.join(certs,'ca-certificates.crt'));
  assert(reviewed.equals(fs.readFileSync(path.join(checkout,'config/ca',relative))));
  assert.throws(()=>service.refreshCa(project),/hash mismatch/,'System selection must not use the valid project bundle');
  fs.copyFileSync(path.join(checkout,'config/ca',relative),path.join(project,'config/ca',relative));
  fs.writeFileSync(path.join(project,'bootstrapper/ca',relative),'wrong-project-layout');
  assert.throws(()=>service.refreshCa(project,'project'),/hash mismatch/);
  fs.unlinkSync(path.join(project,'bootstrapper/ca',relative));
  assert.throws(()=>service.refreshCa(project,'project'),error=>error.code==='ENOENT','Project layout must not fall back to the System bundle');
  assert(fs.readFileSync(path.join(certs,'ca-certificates.crt')).equals(reviewed),'Invalid selected CA must not change the trust store');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('runtime installation checks the pinned toolchain and explicit project trust layout',async()=>{
 const calls=[];const service=new BuildToolsService({async run(binary,args){calls.push([binary,args]);return 'wrong';}});
 await assert.rejects(service.installRuntime(checkout,{}),/Pinned Node/);
 assert.equal(calls.length,1);assert(!calls.some(([binary])=>binary==='apk'));
 assert(runtimePackages.every(value=>value.includes('=')));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'project-build-runtime-'));
 try{
  const project=path.join(root,'project'),relative='cacert-2026-10-20.crt',commands=[];
  fs.mkdirSync(path.join(root,'etc/ssl/certs'),{recursive:true});
  fs.mkdirSync(path.join(project,'bootstrapper/ca'),{recursive:true});
  fs.copyFileSync(path.join(checkout,'config/ca',relative),path.join(project,'bootstrapper/ca',relative));
  const prepared=new BuildToolsService({async run(binary,args){commands.push([binary,args]);return binary===process.execPath?'v24.22.0':binary==='npm'?'11.19.1':'';}},root);
  await prepared.installRuntime(project,{},undefined,'project');
  assert(commands.some(([binary])=>binary==='apk'));
  assert.equal(commands.filter(([binary])=>binary==='docker').length,3);
  assert(fs.readFileSync(path.join(root,'etc/ssl/certs/ca-certificates.crt')).equals(fs.readFileSync(path.join(project,'bootstrapper/ca',relative))));
 }finally{fs.rmSync(root,{recursive:true,force:true});}

});
