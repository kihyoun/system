const {test}=require('node:test'),assert=require('node:assert/strict');
const {RecoveryPublicationService,recoverySource}=require('../../dist/modules/host/recovery-publication.service');
const id=n=>'sha256:'+n.repeat(64);
test('monorepo recovery publication retains old archives and removes obsolete active gitlink identity',()=>{
 const old={sourceCommit:'1'.repeat(40),sourceTree:'2'.repeat(40),wizardSourceRevision:'3'.repeat(40),archives:[{file:'images/old.tar.gz',imageId:id('1')}],localImages:[{tag:'system_bootstrapper',imageId:id('1')},{tag:'controller:old',imageId:id('1')}],publicImages:[{reference:'gitlab/gitlab-ce:old@'+id('2'),tag:'gitlab/gitlab-ce:old',imageId:id('2')}],currentController:{imageId:id('1'),packagedWizardSourceRevision:'3'.repeat(40)}};
 const source={sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40),sourceLayout:'system-monorepo-v1',wizardSourceTree:'c'.repeat(40)};
 const archive={...source,file:'images/new.tar.gz',imageId:id('4')};
 const value=new RecoveryPublicationService().refresh(old,archive,source,'controller:new',id('4'),'gitlab/gitlab-ce:new@'+id('5'),id('5'),'wizard:new');
 assert.equal(value.sourceLayout,'system-monorepo-v1');assert.equal(value.wizardSourceRevision,undefined);assert.equal(value.currentController.packagedWizardSourceRevision,undefined);assert.equal(value.currentController.wizardSourceTree,source.wizardSourceTree);
 assert.deepEqual(value.archives,[old.archives[0],archive]);assert.deepEqual(value.controllerHistory,[old.currentController]);assert.equal(old.wizardSourceRevision,'3'.repeat(40));
 assert.throws(()=>recoverySource({...source,wizardSourceRevision:'d'.repeat(40)}));
});
test('historical tuple source remains readable without inventing monorepo identity',()=>{
 assert.deepEqual(recoverySource(['a'.repeat(40),'b'.repeat(40),'c'.repeat(40)]),{sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40),wizardSourceRevision:'c'.repeat(40)});
});

test('native release assignments preserve Cube, multiline literals and every unrelated byte',()=>{
 const {imageAssignment}=require('../../dist/modules/host/release-selection.service');
 const {BOOTSTRAPPER_CUBE}=require('../../dist/cli/presentation');
 const reference='example/controller@'+id('1'),next='example/controller@'+id('2');
 const raw=Buffer.from(BOOTSTRAPPER_CUBE+`export BOOTSTRAPPER_IMAGE='${reference}'\n`);
 const secret=Buffer.from("export OTHER='한국어 literal\nexport BOOTSTRAPPER_IMAGE=inside-secret\nlast line'\n");
 const result=imageAssignment(Buffer.concat([raw,secret]),next);
 assert(result.subarray(0,1184).equals(raw.subarray(0,1184)));assert(result.subarray(-secret.length).equals(secret));
 assert.equal(result.toString(),BOOTSTRAPPER_CUBE+`export BOOTSTRAPPER_IMAGE='${next}'\n`+secret);
 assert.deepEqual(imageAssignment(Buffer.from(raw.toString().replace('export BOOTSTRAPPER_IMAGE=','  export\tBOOTSTRAPPER_IMAGE=')),next),imageAssignment(raw,next));
 assert.throws(()=>imageAssignment(Buffer.concat([raw,Buffer.from(`\t export\tBOOTSTRAPPER_IMAGE='${reference}'\n`)]),next),/duplicate-or-header/);
 assert.throws(()=>imageAssignment(Buffer.concat([raw,Buffer.from("export SECRET='unclosed\n")]),next),/incomplete-controller/);
 for(const extra of ['echo unsupported-command\n','export SECRET=$(whoami)\n'])assert.throws(()=>imageAssignment(Buffer.concat([raw,Buffer.from(extra)]),next));
 const wizard=imageAssignment(raw,'example/wizard@'+id('3'),'WIZARD_IMAGE');assert(wizard.subarray(0,raw.length).equals(raw));
 assert(wizard.toString().endsWith(`export WIZARD_IMAGE='example/wizard@${id('3')}'\n`));
 assert.throws(()=>imageAssignment(raw,next,'UNRELATED'),/unsupported-update-image/);
});

test('native release selection retains exact metadata and resumes mixed publication or rollback safely',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {ReleaseSelectionService}=require('../../dist/modules/host/release-selection.service');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-release-selection-')),service=new ReleaseSelectionService();
 const release={sourceRevision:'a'.repeat(40),sourceTree:'b'.repeat(40),wizardRevision:'c'.repeat(40)},
   accepted={version:'2.0.0',tag:'v2.0.0',source:{revision:release.sourceRevision}},
   controller={reference:'example/controller@'+id('1'),imageId:id('1')},wizard={reference:'example/wizard@'+id('2'),imageId:id('2')};
 const names=['.release-images.json','.release-images.env'];
 try{
  for(const existing of [true,false]){
   const directory=path.join(root,existing?'existing':'absent'),checkpoint=path.join(directory,'checkpoint');fs.mkdirSync(checkpoint,{recursive:true});
   const main=path.join(directory,'.docker.env');fs.writeFileSync(main,'untouched configuration');
   if(existing)for(const name of names){const file=path.join(directory,name);fs.writeFileSync(file,`prior private bytes: ${name}\n`,{mode:0o600});if(process.getuid()===0)fs.chownSync(file,65534,65534);}
   const before=service.read(main),prepared=service.prepare(main,accepted,release,controller,wizard),{selection,previous,payloads}=prepared;
   assert.deepEqual(service.read(main),before,'preparation must not publish');assert.deepEqual(previous,before.payloads);
   const receipt=JSON.parse(payloads[names[0]]);assert.deepEqual(receipt.productRelease,{version:accepted.version,tag:accepted.tag,sourceRevision:release.sourceRevision});assert.equal(receipt.wizardSourceRevision,release.wizardRevision);assert.equal(receipt.status,'selected');assert.deepEqual(receipt.images,{controller,wizard});
   const shared={...release,sourceLayout:'system-monorepo-v1',wizardSourceTree:'d'.repeat(40)};delete shared.wizardRevision;
   const sharedReceipt=JSON.parse(service.prepare(main,accepted,shared,controller,wizard).payloads[names[0]]);
   assert.equal(sharedReceipt.sourceCommit,release.sourceRevision);assert.equal(sharedReceipt.wizardSourceTree,shared.wizardSourceTree);assert(!('wizardSourceRevision' in sharedReceipt));
   for(const name of names){if(previous[name])fs.writeFileSync(path.join(checkpoint,name+'.before'),previous[name],{mode:0o600});fs.writeFileSync(path.join(checkpoint,name+'.after'),payloads[name],{mode:0o600});}
   service.verifyCheckpoint(checkpoint,selection);service.verify(main,selection);
   const rename=fs.renameSync,chown=fs.fchownSync,unlink=fs.unlinkSync;let stopped=false;
   try{
    fs.fchownSync=()=>{throw Error('fixture-owner-failure');};
    assert.throws(()=>service.write(main,checkpoint,selection,'after'),/owner-failure/);assert.deepEqual(service.read(main),before);
   }finally{fs.fchownSync=chown;}
   try{
    fs.renameSync=(from,to)=>{rename(from,to);if(to===path.join(directory,names[0])&&!stopped){stopped=true;const stat=fs.statSync(to);assert.equal(stat.uid,selection.after[names[0]].uid);assert.equal(stat.gid,selection.after[names[0]].gid);throw Error('fixture-interrupted-after-rename');}};
    assert.throws(()=>service.write(main,checkpoint,selection,'after'),/interrupted-after-rename/);
   }finally{fs.renameSync=rename;}
   const mixed=service.read(main);assert.deepEqual(mixed.state[names[0]],selection.after[names[0]]);assert.deepEqual(mixed.state[names[1]],selection.before[names[1]]);
   assert.throws(()=>service.verify(main,selection),/selection-changed/);service.verify(main,selection,true);
   service.write(main,checkpoint,selection,'after');service.verify(main,selection,true);
   fs.appendFileSync(path.join(directory,names[0]),'operator edit');assert.throws(()=>service.verify(main,selection,true),/selection-changed/);
   fs.writeFileSync(path.join(directory,names[0]),payloads[names[0]]);service.verify(main,selection,true);
   if(!existing)try{fs.unlinkSync=file=>{if(file===path.join(directory,names[1]))throw Error('fixture-unlink-interruption');return unlink(file);};assert.throws(()=>service.write(main,checkpoint,selection,'before'),/unlink-interruption/);service.verify(main,selection,true);}finally{fs.unlinkSync=unlink;}
   service.write(main,checkpoint,selection,'before');assert.deepEqual(service.read(main),before);assert.equal(fs.readFileSync(main,'utf8'),'untouched configuration');
   fs.appendFileSync(path.join(checkpoint,names[0]+'.after'),'changed');assert.throws(()=>service.verifyCheckpoint(checkpoint,selection),/checkpoint-changed/);assert.throws(()=>service.write(main,checkpoint,selection,'after'),/checkpoint-changed/);assert.deepEqual(service.read(main),before);
   assert(!fs.readdirSync(directory).some(name=>name.includes('.tmp-')));
   if(existing){fs.unlinkSync(path.join(directory,names[1]));assert.throws(()=>service.prepare(main,accepted,release,controller,wizard),/selection-incomplete/);}
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
