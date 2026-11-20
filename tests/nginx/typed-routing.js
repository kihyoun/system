'use strict';
require('../../operations/node_modules/reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ProjectsRoutingService}=require('../../operations/dist/projects-routing/projects-routing.service');
const {LiteralConfiguration}=require('../../operations/dist/projects-routing/ports');
const {NativeProcessRunner,ProcessFailure}=require('../../operations/dist/runtime/process');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'typed-project-routing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const directory of ['system/.projects.env','nginx','gitlab','wizard','nginx-proxy/.projects','templates/wizard-environments'])fs.mkdirSync(path.join(root,directory),{recursive:true});
 fs.cpSync(path.resolve(__dirname,'../../nginx/.templates'),path.join(root,'nginx/.templates'),{recursive:true});
 fs.writeFileSync(path.join(root,'.docker.env'),'BOOTSTRAPPER_IP=127.0.0.1\n');
 fs.writeFileSync(path.join(root,'gitlab/.docker.env'),'GITLAB_IP=127.0.0.2\n');
 fs.writeFileSync(path.join(root,'wizard/.docker.env'),'WIZARD_IP=127.0.0.3\n');
 fs.writeFileSync(path.join(root,'system/.docker.env'),'GITLAB_HOST=gitlab.example.test\nGITLAB_DOMAIN_MODE=0\nGITLAB_REGISTRY_HOST=registry.example.test\nGITLAB_REGISTRY_DOMAIN_MODE=0\nSYNC_ENABLE=true\nSYNC_DOMAIN_MODE=0\nSYNC_HOST=sync.example.test\nWIZARD_ENABLE=true\nWIZARD_DOMAIN_MODE=0\nWIZARD_HOST=wizard.example.test\nPERSISTENT_DIR=/selected/data\nNGINX_IMAGE=selected-nginx\nSYSTEM_LOG_MAX_SIZE=7m\n');
 fs.writeFileSync(path.join(root,'system/docker-compose.yml'),'services: {web: {image: "${NGINX_IMAGE}", volumes: ["${PERSISTENT_DIR}/templates:/templates"], logging: {options: {max-size: "${SYSTEM_LOG_MAX_SIZE}"}}}}');
 fs.writeFileSync(path.join(root,'templates/wizard-environments/beta.conf'),'owned candidate fragment');
 const native=new NativeProcessRunner(),calls=[];
 const process={run(binary,args,options){if(binary==='bash')return native.run(binary,args,options);calls.push({binary,args,options});return {stdout:'172.20.0.2\n',stderr:'',status:0};}};
 return {root,calls,process,service:new ProjectsRoutingService(process,new LiteralConfiguration()),command:{action:'reload',root,templates:path.join(root,'templates')}};
}
test('Nest routing module resolves the typed service and bounded configuration port',async()=>{
 const {NestFactory}=require('../../operations/node_modules/@nestjs/core'),{ProjectsRoutingModule}=require('../../operations/dist/projects-routing/projects-routing.module');
 const app=await NestFactory.createApplicationContext(ProjectsRoutingModule,{logger:false});
 try{assert(app.get(ProjectsRoutingService) instanceof ProjectsRoutingService);}finally{await app.close();}
});
test('literal configuration adapter reads settings without executing them and clears omitted per-project flags',t=>{
 const f=fixture(t),file=path.join(f.root,'project.env');fs.writeFileSync(file,'PROJECT_NAME=sample\n');
 const port=new LiteralConfiguration();assert.deepEqual(port.read([file],['PROJECT_NAME','USE_BETA_HOST'],{USE_BETA_HOST:'false'}),{PROJECT_NAME:'sample',USE_BETA_HOST:'false'});
 assert.throws(()=>port.read([file+'.missing'],['PROJECT_NAME']),/missing/);
});
test('typed render preserves candidate fragments and carries exact Compose selectors and logging',t=>{
 const f=fixture(t);f.service.run({...f.command,action:'start'});
 const template=fs.readFileSync(path.join(f.root,'templates/default.conf.template'),'utf8');
 assert(template.includes('127.0.0.1:8071'));assert(template.includes('wizard-environments/*.conf'));
 assert.equal(fs.readFileSync(path.join(f.root,'templates/wizard-environments/beta.conf'),'utf8'),'owned candidate fragment');
 assert.equal(f.calls.at(-1).options.env.NGINX_IMAGE,'selected-nginx');assert.equal(f.calls.at(-1).options.env.PERSISTENT_DIR,'/selected/data');assert.equal(f.calls.at(-1).options.env.SYSTEM_LOG_MAX_SIZE,'7m');
 f.service.run({...f.command,action:'recovery'});const recovered=fs.readFileSync(path.join(f.root,'templates/default.conf.template'),'utf8');
 assert(!recovered.includes('8071'));assert(!recovered.includes('wizard-environments'));assert(recovered.includes('5050'));
});
test('invalid alias configuration fails before Docker or template writes',t=>{
 const f=fixture(t),saved=path.join(f.root,'templates/default.conf.template');fs.writeFileSync(saved,'previous');
 fs.appendFileSync(path.join(f.root,'system/.docker.env'),'WIZARD_ALIASES="wizard.example.test"\nWIZARD_SSL=/ssl/cert\nWIZARD_SSL_KEY=/ssl/key\n');
 assert.throws(()=>f.service.run(f.command),/itself/);assert.equal(f.calls.length,0);assert.equal(fs.readFileSync(saved,'utf8'),'previous');
});
test('uncertain reload failure restores template bytes and candidate fragments',t=>{
 const f=fixture(t),saved=path.join(f.root,'templates/default.conf.template');fs.writeFileSync(saved,'previous');
 const run=f.process.run;f.process.run=(binary,args,options)=>{if(binary==='docker')throw new ProcessFailure(binary,null,'SIGKILL',true);return run(binary,args,options);};
 assert.throws(()=>f.service.run(f.command),error=>error.uncertain===true);
 assert.equal(fs.readFileSync(saved,'utf8'),'previous');assert.equal(fs.readFileSync(path.join(f.root,'templates/wizard-environments/beta.conf'),'utf8'),'owned candidate fragment');
});

test('stop uses selected Compose environment and skips managed Wizard proxy ownership',t=>{
 const f=fixture(t);f.service.run({...f.command,action:'stop'});
 assert.deepEqual(f.calls.at(-1).args,['--host=unix:///var/run/docker.sock','compose','--compatibility','-f','../system/docker-compose.yml','stop','web']);
 assert.equal(f.calls.at(-1).options.env.PERSISTENT_DIR,'/selected/data');
 fs.writeFileSync(path.join(f.root,'system/.projects.env/.wizard.env'),'PROJECT_NAME=wizard\nPROJECT_TEMPLATE=wizard\n');
 fs.writeFileSync(path.join(f.root,'system/.projects.env/.sample.env'),'PROJECT_NAME=sample\n');
 f.calls.length=0;f.service.run({...f.command,action:'stop-proxies'});
 assert.deepEqual(f.calls.map(row=>row.args),[['--host=unix:///var/run/docker.sock','compose','--compatibility','-p','sample','down']]);
 assert.throws(()=>f.service.run({...f.command,root:'relative'}),/Absolute/);
});
