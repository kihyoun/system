const {test}=require('node:test'),assert=require('node:assert/strict');
const {RecoveryPublicationService,recoverySource}=require('../dist/host/recovery-publication.service');
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
