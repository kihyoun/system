'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LifecycleService}=require('../../operations/dist/lifecycle/lifecycle.service');
const {ShellConfiguration}=require('../../operations/dist/projects-routing/ports');
const {NativeProcessRunner}=require('../../operations/dist/runtime/process');
test('GitLab startup recreates changed configuration and exports explicit Omnibus settings',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gitlab-startup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const directory of ['system','gitlab','config','data'])fs.mkdirSync(path.join(root,directory));
 fs.copyFileSync(path.resolve(__dirname,'../../gitlab/gitlab.rb'),path.join(root,'gitlab/gitlab.rb'));
 const config=path.join(root,'system/.docker.env');fs.writeFileSync(config,'GITLAB_REGISTRY_DOMAIN_MODE=0\nGITLAB_REGISTRY_URL=http://registry.localhost:5050\nGITLAB_REGISTRY_HOST=registry.localhost\nGITLAB_EXTERNAL_URL=http://gitlab.localhost\n');
 const calls=[],child={async run(binary,args,options){calls.push({binary,args,options});return binary==='docker'?'172.19.0.3':'';}};
 const service=new LifecycleService(child,new ShellConfiguration(new NativeProcessRunner()),{}, {},{gitlabConfig:path.join(root,'config'),gitlabData:path.join(root,'data'),syncTemplates:path.join(root,'templates')});
 const run=async environment=>{calls.length=0;await service.gitlab({root,state:path.join(root,'system'),environment:{...process.env,...environment}},true);return calls.find(c=>c.binary==='docker-compose');};
 assert((await run({})).args.includes('--force-recreate'));
 assert(!(await run({})).args.includes('--force-recreate'));
 fs.appendFileSync(config,'GITLAB_EXTERNAL_URL=http://changed.localhost\n');assert((await run({})).args.includes('--force-recreate'));
 const before=fs.readFileSync(path.join(root,'config/gitlab.rb')),omnibus="puma['worker_processes'] = 2";
 for(const saved of [false,true]){
  if(saved)fs.appendFileSync(config,'GITLAB_OMNIBUS_CONFIG="'+omnibus+'"\n');
  const call=await run(saved?{}:{GITLAB_OMNIBUS_CONFIG:omnibus});assert(call.args.includes('../gitlab/docker-compose.omnibus.yml'));assert.equal(call.options.env.GITLAB_OMNIBUS_CONFIG,omnibus);assert.deepEqual(fs.readFileSync(path.join(root,'config/gitlab.rb')),before);
 }
 fs.writeFileSync(path.join(root,'data/.system-bootstrapper-restore-incomplete'),'interrupted');await assert.rejects(run({}),/interrupted Seed restore/);
});
