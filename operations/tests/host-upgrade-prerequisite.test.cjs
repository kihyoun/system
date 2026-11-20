const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {UpgradePrerequisiteService}=require('../dist/host/upgrade-prerequisite.service');
const {validateUpgradeGraph}=require('../dist/host/upgrade-graph');
const security=require('../../gitlab/security-release.json');
const id=n=>'sha256:'+n.repeat(64),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('database transition declares native prerequisite without preservation claims',()=>{
 const graph=require('../../bootstrapper/upgrade-paths.json');validateUpgradeGraph(graph);
 const edge=graph.transitions.find(e=>e.to==='2.0.0');assert.equal(edge.from,'1.2.0');assert.equal(edge.databaseMigration,true);assert.equal(edge.serviceImagesPreserved,false);
 for(const mutate of [e=>e.serviceImagesPreserved=true,e=>delete e.gitlabPrerequisite,e=>e.gitlabPrerequisite.toVersion='19.7.0']){const bad=structuredClone(graph);mutate(bad.transitions.at(-1));assert.throws(()=>validateUpgradeGraph(bad));}
});
test('GitLab prerequisite requires promoted matching cold checkpoint and running version',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'upgrade-gate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const directory=path.join(root,'checkpoint');fs.mkdirSync(directory);
 const entries=[];for(const name of ['gitlab','configuration']){const full=path.join(directory,name);fs.mkdirSync(full,{mode:0o700});const stat=fs.statSync(full);entries.push({path:name,mode:stat.mode&0o7777,uid:stat.uid,gid:stat.gid,type:'directory'});}
 const revision='a'.repeat(40),checkpoint={format:'system-gitlab-cold-checkpoint-v1',sourceRevision:revision,plan:{sourceRevision:revision,fromImageId:id('1'),toImageId:id('2'),runner:{fromImageId:id('3'),toImageId:id('4')}},entries};
 const bytes=Buffer.from(JSON.stringify(checkpoint)),digest=sha(bytes);fs.writeFileSync(path.join(directory,'checkpoint.json'),bytes,{mode:0o600});
 const operation={format:'system-gitlab-upgrade-operation-v1',phase:'promoted',checkpointSha256:digest,toImage:security.toImage,sourceRevision:revision};
 const write=()=>fs.writeFileSync(path.join(directory,'operation.json'),JSON.stringify(operation),{mode:0o600});write();
 let version='19.6.1';const service=new UpgradePrerequisiteService({run(binary,args){return args.includes('inspect')?JSON.stringify([{Name:'/system_gitlab_1',Image:id('2'),State:{Running:true}},{Name:'/runner_docker_1',Image:id('4'),State:{Running:true}}]):version;}});
 assert.equal(service.verify(root,directory,revision,security).checkpointSha256,digest);
 version='19.5.3';assert.throws(()=>service.verify(root,directory,revision,security),/running-version/);version='19.6.1';
 operation.phase='restored-checkpoint';write();assert.throws(()=>service.verify(root,directory,revision,security),/completed-native/);operation.phase='promoted';write();
 fs.writeFileSync(path.join(directory,'gitlab','extra'),'changed');assert.throws(()=>service.verify(root,directory,revision,security),/checkpoint-changed/);
});
