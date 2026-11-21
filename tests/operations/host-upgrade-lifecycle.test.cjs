const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {UpgradeLifecycleService}=require('../../dist/modules/host/upgrade-lifecycle.service');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'host-lifecycle-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return {directory,service:new UpgradeLifecycleService()};}
test('upgrade durable phases cannot skip retained images or backup readiness',t=>{
 const {directory,service}=fixture(t);
 let state=service.transition(directory,'retaining-previous-images');
 assert.throws(()=>service.transition(directory,'paired-update-starting',{},state.phase),/phase-order/);
 assert.throws(()=>service.transition(directory,'backup-starting',{},'stale'),/phase-changed/);
 for(const phase of ['backup-starting','backup-services-resuming','paired-update-starting'])state=service.transition(directory,phase,{},state.phase);
 assert.throws(()=>service.transition(directory,'completed',{},state.phase),/identity/);
 state=service.transition(directory,'completed',{version:'2.0.0',sourceRevision:'a'.repeat(40),dataSampleVerified:true,configurationPreserved:true,runnerRegistryOperationalChecks:true},state.phase);
 assert.equal(state.databaseMigration,false);assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'operation.json'))).phase,'completed');
 assert.throws(()=>service.transition(directory,'needs-inspection',{},state.phase),/phase-order/);
});
test('interrupted upgrade retains inspection phase and paired recovery never rewinds database',t=>{
 const {directory,service}=fixture(t);service.transition(directory,'retaining-previous-images');
 service.transition(directory,'needs-inspection',{},'retaining-previous-images');
 assert.throws(()=>service.transition(directory,'rolled-back',{databaseRewound:true},'needs-inspection'),/recovery/);
 const state=service.transition(directory,'rolled-back',{databaseRewound:false,recoveryImageSelectors:true,restoredVersion:'1.2.0',originalConfiguration:'/retained/main-before.env'},'needs-inspection');assert.equal(state.databaseRewound,false);
});
test('apply requires exact reviewed plan and migration checkpoint before journaling',t=>{
 const {directory,service}=fixture(t),filename=path.join(directory,'plan.json');
 const write=plan=>{const bytes=Buffer.from(JSON.stringify(plan));fs.writeFileSync(filename,bytes,{mode:0o600});return crypto.createHash('sha256').update(bytes).digest('hex');};
 const plan={format:'system-public-upgrade-plan-v1',transitions:[{databaseMigration:true}]};let hash=write(plan);
 assert.throws(()=>service.approvedPlan(directory,'wrong'),/confirmation/);
 assert.throws(()=>service.approvedPlan(directory,hash));
 plan.gitlabPrerequisite={checkpoint:'/retained/cold'};hash=write(plan);assert.deepEqual(service.approvedPlan(directory,hash),plan);
 service.transition(directory,'retaining-previous-images');assert.throws(()=>service.approvedPlan(directory,hash),/already-started/);
});
