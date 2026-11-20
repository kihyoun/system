const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BuildToolsService,RUNTIME_PACKAGES}=require('../dist/host-bootstrap/build-tools.service');
const checkout=path.resolve(__dirname,'../..');
test('reviewed trust replaces old roots and hash links only after hash verification',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-build-trust-'));
 try{
  const certs=path.join(root,'etc/ssl/certs');fs.mkdirSync(certs,{recursive:true});
  fs.writeFileSync(path.join(certs,'obsolete.pem'),'old');fs.symlinkSync('obsolete.pem',path.join(certs,'old-hash.0'));
  fs.mkdirSync(path.join(certs,'retained-directory'));
  const service=new BuildToolsService({},root);
  const bad=path.join(root,'checkout');fs.mkdirSync(path.join(bad,'bootstrapper/ca'),{recursive:true});
  fs.writeFileSync(path.join(bad,'bootstrapper/ca/cacert-2026-10-20.crt'),'wrong');
  assert.throws(()=>service.refreshCa(bad),/hash mismatch/);
  assert.equal(fs.readFileSync(path.join(certs,'obsolete.pem'),'utf8'),'old');
  service.refreshCa(checkout);
  assert.deepEqual(fs.readdirSync(certs).sort(),['ca-certificates.crt','retained-directory']);
  assert.equal(fs.readlinkSync(path.join(root,'etc/ssl/cert.pem')),'certs/ca-certificates.crt');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('runtime installation refuses mismatched toolchain before package mutation',async()=>{
 const calls=[];const service=new BuildToolsService({async run(binary,args){calls.push([binary,args]);return 'wrong';}});
 await assert.rejects(service.installRuntime(checkout,{}),/Pinned Node/);
 assert.equal(calls.length,1);assert(!calls.some(([binary])=>binary==='apk'));
 assert(RUNTIME_PACKAGES.every(value=>value.includes('=')));
});
