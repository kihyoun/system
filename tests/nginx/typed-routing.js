'use strict';
require('../../operations/node_modules/reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ProjectsRoutingService}=require('../../operations/dist/projects-routing/projects-routing.service');
const {LiteralConfiguration}=require('../../operations/dist/projects-routing/ports');
const {ProcessFailure}=require('../../operations/dist/runtime/process');
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
 const calls=[];
 const process={run(binary,args,options){assert.notEqual(binary,'bash');calls.push({binary,args,options});return {stdout:'172.20.0.2\n',stderr:'',status:0};}};
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
test('start/reload retain one Wizard route, optional fragments, HTTP01 bytes and exact Compose settings',t=>{
 const f=fixture(t);
 fs.writeFileSync(path.join(f.root,'system/.projects.env/.wizard.env'),'PROJECT_NAME=wizard\nPROJECT_TEMPLATE=wizard\nUSE_PROD_HOST=true\nUSE_BETA_HOST=true\nUSE_REVIEW_HOST=true\n');
 f.service.run({...f.command,action:'proxies'});f.service.run({...f.command,action:'stop-proxies'});assert.equal(f.calls.length,0);
 const acme=fs.readFileSync(path.join(f.root,'nginx/.templates/acme-http01.conf.template'));
 for(const action of ['start','reload']){
  f.calls.length=0;f.service.run({...f.command,action});
  const template=fs.readFileSync(path.join(f.root,'templates/default.conf.template'),'utf8');
  assert(template.includes('127.0.0.1:8071'));assert.equal(template.split('include /etc/nginx/templates/wizard-environments/*.conf;').length-1,1);
  assert.equal(template.split('server_name wizard.example.test;').length-1,1);assert(!/wizard_(prod|beta|review)/.test(template));
  assert(fs.readFileSync(path.join(f.root,'templates/00-acme-http01.conf.template')).equals(acme));
  assert.equal(fs.readFileSync(path.join(f.root,'templates/wizard-environments/beta.conf'),'utf8'),'owned candidate fragment');
  if(action==='start'){assert.equal(f.calls.at(-1).options.env.NGINX_IMAGE,'selected-nginx');assert.equal(f.calls.at(-1).options.env.PERSISTENT_DIR,'/selected/data');assert.equal(f.calls.at(-1).options.env.SYSTEM_LOG_MAX_SIZE,'7m');}
  assert(!JSON.stringify(f.calls).includes('system_wizard_1'));assert(!JSON.stringify(f.calls).includes('system_gitlab_1'));
 }
 f.service.run({...f.command,action:'recovery'});const recovered=fs.readFileSync(path.join(f.root,'templates/default.conf.template'),'utf8');
 assert(!recovered.includes('8071'));assert(!recovered.includes('wizard-environments'));assert(!recovered.includes('server_name wizard.example.test;'));assert(!recovered.includes('server_name sync.example.test;'));
 assert(recovered.includes('server_name gitlab.example.test;'));assert(recovered.includes('server_name registry.example.test;'));assert(recovered.includes('5050'));
});
test('aliases regenerate on start/reload, clear on recovery/disable and conflicts preserve prior templates',t=>{
 const f=fixture(t),main=path.join(f.root,'system/.docker.env'),base=fs.readFileSync(main,'utf8');
 const configured=base.replace('WIZARD_DOMAIN_MODE=0','WIZARD_DOMAIN_MODE=2')+'WIZARD_SSL=/ssl/live/example/fullchain.pem\nWIZARD_SSL_KEY=/ssl/live/example/privkey.pem\nWIZARD_ALIASES="example.test old.example.test"\n';
 fs.writeFileSync(main,configured);
 const read=name=>fs.readFileSync(path.join(f.command.templates,name),'utf8');
 for(const action of ['start','reload']){
  f.service.run({...f.command,action});
  const aliases=read('zz-wizard-aliases.conf.template');
  assert.equal(aliases.split('return 308 https://wizard.example.test$request_uri;').length-1,2);
  assert.equal(aliases.split('location ^~ /.well-known/acme-challenge/').length-1,2);
 }
 const original=read('default.conf.template'),aliases=read('zz-wizard-aliases.conf.template');
 for(const override of ['GITLAB_HOST=example.test\n','WIZARD_ALIASES="wizard.example.test"\n']){
  const key=override.slice(0,override.indexOf('='));fs.writeFileSync(main,configured.replace(new RegExp('^'+key+'=.*$','m'),override.trimEnd()));f.calls.length=0;
  assert.throws(()=>f.service.run(f.command));assert.equal(f.calls.length,0);
  assert.equal(read('default.conf.template'),original);assert.equal(read('zz-wizard-aliases.conf.template'),aliases);
 }
 fs.writeFileSync(main,configured);f.service.run({...f.command,action:'recovery'});assert.equal(read('zz-wizard-aliases.conf.template').trim(),'');
 f.service.run({...f.command,action:'start'});assert.equal(read('zz-wizard-aliases.conf.template'),aliases);
 fs.writeFileSync(main,configured.replace(/^WIZARD_ALIASES=.*$/m,'WIZARD_ALIASES=""'));f.service.run(f.command);assert.equal(read('zz-wizard-aliases.conf.template').trim(),'');
 assert(f.calls.some(call=>call.args.some(arg=>arg.includes('nginx -t'))));assert(f.calls.some(call=>call.args.some(arg=>arg.includes('nginx -s reload'))));
});
test('all eight application environment combinations render on start/reload and missing enabled TLS templates fail before Docker',t=>{
 const f=fixture(t),names=['PROD','BETA','REVIEW'];
 function configure(flags,mode){
  const selection='PROJECT_NAME=application\n'+names.map((name,index)=>'USE_'+name+'_HOST='+flags[index]+'\n').join('');
  fs.writeFileSync(path.join(f.root,'system/.projects.env/.application.env'),selection);
  fs.writeFileSync(path.join(f.root,'nginx-proxy/.projects/.application.env'),selection+names.map(name=>name+'_DOMAIN_MODE='+mode+'\n'+name+'_PROXY=127.0.0.1\n'+name+'_HOST='+name+'.localhost\n').join(''));
 }
 for(let mask=0;mask<8;mask++)for(const action of ['start','reload']){
  const flags=names.map((_,index)=>!!(mask&(1<<index)));configure(flags,0);f.calls.length=0;
  f.service.run({...f.command,action});const rendered=fs.readFileSync(path.join(f.command.templates,'default.conf.template'),'utf8');
  names.forEach((name,index)=>assert.equal(rendered.split('server_name '+name+'.localhost;').length-1,Number(flags[index])));
  const trace=JSON.stringify(f.calls.map(call=>call.args));
  if(action==='reload'){assert(trace.includes('nginx -t'));assert(trace.includes('nginx -s reload'));assert(!trace.includes('"--build"'));}
  else{assert(trace.includes('"up","--build","--remove-orphans","--force-recreate","-d","web"'));assert(!trace.includes('nginx -s reload'));}
  assert(rendered.includes('server_name wizard.example.test;'));assert(rendered.includes('server_name sync.example.test;'));
 }
 fs.unlinkSync(path.join(f.root,'nginx/.templates/default.ssl.conf.template'));
 for(let index=0;index<3;index++)for(const action of ['start','reload']){
  configure(names.map((_,other)=>other===index),2);f.calls.length=0;
  assert.throws(()=>f.service.run({...f.command,action}),/ENOENT/);assert.equal(f.calls.length,0);
 }
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
