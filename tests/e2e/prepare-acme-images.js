'use strict';
// Called only by the separately reviewed ACME acceptance activation. No daemon
// or authority is started while preparing these explicit public inputs.
const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const {PINNED,hashFile}=require('./local-acme');
function prepare(output,dependencies={}){
  const run=dependencies.run||((args)=>execFileSync('docker',args,{stdio:'inherit',timeout:180000}));
  const inspect=dependencies.inspect||((reference)=>JSON.parse(execFileSync('docker',['image','inspect','--format','{{json .}}',reference],{encoding:'utf8',timeout:10000})));
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const images={};
  for(const [role,reference]of Object.entries(PINNED)){
    run(['pull',reference]);
    const actual=inspect(reference);
    if(!/^sha256:[a-f0-9]{64}$/.test(actual.Id||'')||!actual.RepoDigests?.includes(reference))throw Error('acme-image-preparation-identity-mismatch');
    images[role]={id:actual.Id,reference};
    if(role==='certbot'){
      const archive=path.resolve(output,'acme-certbot.tar');
      run(['image','save','--output',archive,reference]);fs.chmodSync(archive,0o600);
      Object.assign(images[role],{archive,sha256:hashFile(archive)});
    }
  }
  return images;
}
module.exports={prepare};
