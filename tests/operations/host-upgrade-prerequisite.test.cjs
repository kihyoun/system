const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {UpgradePrerequisiteService}=require('../../dist/modules/host/upgrade-prerequisite.service');
const {validateUpgradeGraph}=require('../../dist/modules/host/upgrade-graph');
const security=require('../../config/gitlab/security-release.json');
const id=n=>'sha256:'+n.repeat(64),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('database transition declares native prerequisite without preservation claims',()=>{
 const graph=require('../../config/releases/upgrade-paths.json');validateUpgradeGraph(graph);
 const edge=graph.transitions.find(e=>e.to==='2.0.0');assert.equal(edge.from,'1.2.0');assert.equal(edge.databaseMigration,true);assert.equal(edge.serviceImagesPreserved,false);
 for(const mutate of [e=>e.serviceImagesPreserved=true,e=>delete e.gitlabPrerequisite,e=>e.gitlabPrerequisite.toVersion='19.7.0']){const bad=structuredClone(graph);mutate(bad.transitions.at(-1));assert.throws(()=>validateUpgradeGraph(bad));}
});
function prerequisiteFixture(t,scale){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'upgrade-gate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const directory=path.join(root,'checkpoint');fs.mkdirSync(directory);
 const entries=[];for(const name of ['gitlab','configuration']){const full=path.join(directory,name);fs.mkdirSync(full,{mode:0o700});const stat=fs.statSync(full);entries.push({path:name,mode:stat.mode&0o7777,uid:stat.uid,gid:stat.gid,type:'directory'});}
 const revision='a'.repeat(40),checkpoint={format:'system-gitlab-cold-checkpoint-v1',sourceRevision:revision,plan:{sourceRevision:revision,fromImageId:id('1'),toImageId:id('2'),runner:{fromImageId:id('3'),toImageId:id('4'),scale}},entries};
 const bytes=Buffer.from(JSON.stringify(checkpoint)),digest=sha(bytes);fs.writeFileSync(path.join(directory,'checkpoint.json'),bytes,{mode:0o600});
 const operation={format:'system-gitlab-upgrade-operation-v1',phase:'promoted',checkpointSha256:digest,toImage:security.toImage,sourceRevision:revision};
 const write=()=>fs.writeFileSync(path.join(directory,'operation.json'),JSON.stringify(operation),{mode:0o600});write();
 const state={version:'19.6.1',rows:[{Name:'/system_gitlab_1',Image:id('2'),State:{Running:true}},...Array.from({length:Number.isInteger(scale)&&scale>=0&&scale<=50?scale:0},(_,index)=>({Name:'/runner_docker_'+(index+1),Image:id('4'),State:{Running:true}}))]},inspections=[];
 const service=new UpgradePrerequisiteService({run(binary,args){if(args.includes('inspect')){inspections.push(args.slice(2));return JSON.stringify(state.rows);}return state.version;}});
 return {root,directory,revision,digest,operation,write,state,inspections,service};
}
test('GitLab prerequisite requires promoted matching cold checkpoint and running version',t=>{
 const {root,directory,revision,digest,operation,write,state,service}=prerequisiteFixture(t,1);
 assert.equal(service.verify(root,directory,revision,security).checkpointSha256,digest);
 state.version='19.5.3';assert.throws(()=>service.verify(root,directory,revision,security),/running-version/);state.version='19.6.1';
 operation.phase='restored-checkpoint';write();assert.throws(()=>service.verify(root,directory,revision,security),/completed-native/);operation.phase='promoted';write();
 fs.writeFileSync(path.join(directory,'gitlab','extra'),'changed');assert.throws(()=>service.verify(root,directory,revision,security),/checkpoint-changed/);
});
test('GitLab prerequisite accepts a completed migration without runner managers',t=>{
 const f=prerequisiteFixture(t,0);
 assert.equal(f.service.verify(f.root,f.directory,f.revision,security).checkpointSha256,f.digest);
 assert.deepEqual(f.inspections,[['system_gitlab_1']]);
});
test('GitLab prerequisite verifies every manager retained by the migration',t=>{
 const f=prerequisiteFixture(t,4),verify=()=>f.service.verify(f.root,f.directory,f.revision,security);
 verify();assert.deepEqual(f.inspections,[['system_gitlab_1','runner_docker_1','runner_docker_2','runner_docker_3','runner_docker_4']]);
 const valid=structuredClone(f.state.rows);
 f.state.rows=valid.filter(row=>row.Name!=='/runner_docker_4');assert.throws(verify,/services-required/);
 for(const patch of [{Image:id('3')},{State:{Running:false}}]){
  f.state.rows=structuredClone(valid);Object.assign(f.state.rows.at(-1),patch);assert.throws(verify,/running-image-mismatch/);
 }
});
test('GitLab prerequisite refuses an invalid checkpoint runner scale before inspecting services',t=>{
 for(const scale of [-1,1.5,51,'4',null,undefined]){
  const f=prerequisiteFixture(t,scale);
  assert.throws(()=>f.service.verify(f.root,f.directory,f.revision,security),/runner-transition-required/);
  assert.deepEqual(f.inspections,[]);
 }
});
