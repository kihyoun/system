'use strict';
const {ProxyReloadService}=require('../../dist/modules/projects-routing/proxyReload.service');
require('../../node_modules/reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ProjectsRoutingService}=require('../../dist/modules/projects-routing/projectsRouting.service');
const {LiteralConfiguration}=require('../../dist/modules/projects-routing/ports');
const {ProcessFailure}=require('../../dist/common/runtime/process');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'typed-project-routing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const directory of ['config/system/.projects.env','config/system','config/gitlab','wizard','config/nginx-proxy/.projects','templates/wizard-environments'])fs.mkdirSync(path.join(root,directory),{recursive:true});
 fs.cpSync(path.resolve(__dirname,'../../templates/nginx'),path.join(root,'templates/nginx'),{recursive:true});
 fs.writeFileSync(path.join(root,'.docker.env'),'BOOTSTRAPPER_IP=127.0.0.1\n');
 fs.writeFileSync(path.join(root,'config/gitlab/.docker.env'),'GITLAB_IP=127.0.0.2\n');
 fs.writeFileSync(path.join(root,'wizard/.docker.env'),'WIZARD_IP=127.0.0.3\n');
 fs.writeFileSync(path.join(root,'config/system/.docker.env'),'GITLAB_HOST=gitlab.example.test\nGITLAB_DOMAIN_MODE=0\nGITLAB_REGISTRY_HOST=registry.example.test\nGITLAB_REGISTRY_DOMAIN_MODE=0\nSYNC_ENABLE=true\nSYNC_DOMAIN_MODE=0\nSYNC_HOST=sync.example.test\nWIZARD_ENABLE=true\nWIZARD_DOMAIN_MODE=0\nWIZARD_HOST=wizard.example.test\nPERSISTENT_DIR=/selected/data\nNGINX_IMAGE=selected-nginx\nSYSTEM_LOG_MAX_SIZE=7m\n');
 fs.writeFileSync(path.join(root,'config/system/docker-compose.yml'),'services: {web: {image: "${NGINX_IMAGE}", volumes: ["${PERSISTENT_DIR}/templates:/templates"], logging: {options: {max-size: "${SYSTEM_LOG_MAX_SIZE}"}}}}');
 fs.writeFileSync(path.join(root,'templates/wizard-environments/beta.conf'),'owned candidate fragment');
 const calls=[];
 const process={run(binary,args,options){assert.notEqual(binary,'bash');calls.push({binary,args,options});return {stdout:args.includes('{{.Id}}')?'a'.repeat(64):'172.20.0.2\n',stderr:'',status:0};}};
 return {root,calls,process,service:new ProjectsRoutingService(process,new LiteralConfiguration(),new ProxyReloadService(process)),command:{action:'reload',root,templates:path.join(root,'templates')}};
}
test('Nest routing module resolves the typed service and bounded configuration port',async()=>{
 const {NestFactory}=require('../../node_modules/@nestjs/core'),{ProjectsRoutingModule}=require('../../dist/modules/projects-routing/projectsRouting.module');
 const app=await NestFactory.createApplicationContext(ProjectsRoutingModule,{logger:false});
 try{assert(app.get(ProjectsRoutingService) instanceof ProjectsRoutingService);}finally{await app.close();}
});
test('literal configuration adapter reads settings without executing them and clears omitted per-project flags',t=>{
 const f=fixture(t),file=path.join(f.root,'project.env');fs.writeFileSync(file,'PROJECT_NAME=sample\n');
 const port=new LiteralConfiguration();assert.deepEqual(port.read([file],['PROJECT_NAME','USE_BETA_HOST'],{USE_BETA_HOST:'false'}),{PROJECT_NAME:'sample',USE_BETA_HOST:'false'});
 assert.throws(()=>port.read([file+'.missing'],['PROJECT_NAME']),/missing/);
});
test('start/reload/apply retain the signed default Wizard, one route, optional fragments and exact Compose settings',async t=>{
 const f=fixture(t);
 const {wizardConfiguration}=require('../../dist/api/projects/defaultWizard');
 const {readReceipt}=require('../../dist/modules/project-workflow/projectWorkflow');
 const crypto=require('node:crypto');
 const receipt={operation:'b'.repeat(48),defaultProject:true,template:'wizard',state:'pending',repository:{id:1,namespaceId:1,path:'root/wizard',defaultBranch:'main',systemProject:true}};
 const project=path.join(f.root,'config/system/.projects.env/.wizard.env');
 const content=wizardConfiguration({WIZARD_HOST:'wizard.example.test',WIZARD_DOMAIN_MODE:'0'})+'\n# BOOTSTRAPPER_PROJECT='+Buffer.from(JSON.stringify(receipt)).toString('base64')+'\n';
 assert.equal(content[807],'$');assert.equal(crypto.createHash('md5').update(content.slice(0,1184)).digest('hex'),'bd4a8426355824593a5e21ad759830c1');
 fs.writeFileSync(project,content);assert.deepEqual(readReceipt(content),receipt);
 const {NestFactory}=require('../../node_modules/@nestjs/core');
 let closed=0;
 t.mock.method(NestFactory,'createApplicationContext',async()=>({get(token){assert.equal(token,ProjectsRoutingService);return f.service;},async close(){closed++;}}));
 const {main}=require('../../dist/modules/projects-routing/entry');
 f.service.run({...f.command,action:'proxies'});f.service.run({...f.command,action:'stop-proxies'});assert.equal(f.calls.length,0);
 const acme=fs.readFileSync(path.join(f.root,'templates/nginx/acme-http01.conf.template'));
 let originalTemplate;
 for(const action of ['start','reload','apply']){
  f.calls.length=0;
  if(action==='apply')await main('routing',['apply',f.root,f.command.templates]);
  else f.service.run({...f.command,action});
  const template=fs.readFileSync(path.join(f.root,'templates/default.conf.template'),'utf8');
  if(originalTemplate===undefined)originalTemplate=template;else assert.equal(template,originalTemplate);
  assert.equal(fs.readFileSync(project,'utf8'),content,'routing preserves the pending authoritative default-project receipt');
  assert.deepEqual(fs.readdirSync(path.join(f.root,'config/nginx-proxy/.projects')),[],'default Wizard never creates an application proxy record');
  assert(template.includes('127.0.0.1:8071'));assert.equal(template.split('include /etc/nginx/templates/wizard-environments/*.conf;').length-1,1);
  assert.equal(template.split('server_name wizard.example.test;').length-1,1);assert(!/wizard_(prod|beta|review)/.test(template));
  assert(fs.readFileSync(path.join(f.root,'templates/00-acme-http01.conf.template')).equals(acme));
  assert.equal(fs.readFileSync(path.join(f.root,'templates/wizard-environments/beta.conf'),'utf8'),'owned candidate fragment');
  if(action==='start'){assert.equal(f.calls.at(-1).options.env.NGINX_IMAGE,'selected-nginx');assert.equal(f.calls.at(-1).options.env.PERSISTENT_DIR,'/selected/data');assert.equal(f.calls.at(-1).options.env.SYSTEM_LOG_MAX_SIZE,'7m');}
  if(action!=='start'){assert(f.calls.some(call=>call.args.slice(-2).join(' ')==='nginx -t'));assert(f.calls.some(call=>call.args.slice(-3).join(' ')==='nginx -s reload'));assert(!f.calls.some(call=>call.args.includes('compose')));}
  assert(!JSON.stringify(f.calls).includes('system_wizard_1'));assert(!JSON.stringify(f.calls).includes('system_gitlab_1'));
 }
 assert.equal(closed,1,'apply executes and closes the native routing entry application');
 f.service.run({...f.command,action:'recovery',environment:{PATH:'/prepared/bin'}});
 assert.equal(f.calls.at(-1).options.env.PATH,'/prepared/bin');assert.equal(f.calls.at(-1).options.env.HOME,undefined);
 const recovered=fs.readFileSync(path.join(f.root,'templates/default.conf.template'),'utf8');
 assert(!recovered.includes('8071'));assert(!recovered.includes('wizard-environments'));assert(!recovered.includes('server_name wizard.example.test;'));assert(!recovered.includes('server_name sync.example.test;'));
 assert(recovered.includes('server_name gitlab.example.test;'));assert(recovered.includes('server_name registry.example.test;'));assert(recovered.includes('5050'));
});
test('aliases regenerate on start/reload, clear on recovery/disable and conflicts preserve prior templates',t=>{
 const f=fixture(t),main=path.join(f.root,'config/system/.docker.env'),base=fs.readFileSync(main,'utf8');
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
 assert(f.calls.some(call=>call.args.slice(-2).join(' ')==='nginx -t'));assert(f.calls.some(call=>call.args.slice(-3).join(' ')==='nginx -s reload'));
});
test('all eight application environment combinations render on start/reload and missing enabled TLS templates fail before Docker',t=>{
 const f=fixture(t),names=['PROD','BETA','REVIEW'];
 const projectDirectory=path.join(f.root,'config/system/.projects.env'),cache=path.join(f.root,'config/nginx-proxy/.projects');
 const selection='PROJECT_NAME=application\n'+names.map(name=>'USE_'+name+'_HOST=true\n'+name+'_DOMAIN_MODE=0\n'+name+'_HOST='+name+'.localhost\n').join('');
 fs.writeFileSync(path.join(projectDirectory,'.application.env'),selection);
 fs.writeFileSync(path.join(projectDirectory,'.disabled.env'),'PROJECT_NAME=disabled\n'+names.map(name=>'USE_'+name+'_HOST=false\n').join(''));
 fs.writeFileSync(path.join(projectDirectory,'.nohost.env'),'PROJECT_NAME=nohost\n');
 fs.writeFileSync(path.join(projectDirectory,'.wizard.env'),'PROJECT_NAME=wizard\nPROJECT_TEMPLATE=wizard\nUSE_PROD_HOST=true\n');
 assert.throws(()=>f.service.run(f.command),/ENOENT/,'fresh helpers cannot render before reconstructing ephemeral proxy records');
 assert.equal(f.calls.length,0);
 const originalRun=f.process.run,addresses=['172.20.0.4','172.21.0.5','172.22.0.6'];
 let change=value=>value;
 const observations=names.map((prefix,index)=>({Id:String(index+1).repeat(64),Name:'/application_'+prefix.toLowerCase()+'_1',State:{Running:true},Config:{Labels:{'com.docker.compose.project':'application','com.docker.compose.service':prefix.toLowerCase()}},NetworkSettings:{Networks:{['application_'+prefix.toLowerCase()]:{IPAddress:addresses[index]}}}}));
 f.process.run=(binary,args,options)=>{
  if(args.includes('{{json .}}')){
   f.calls.push({binary,args,options});
   const value=observations.find(item=>args.at(-1)===item.Name.slice(1)||args.at(-1)===item.Id);
   if(!value)throw new ProcessFailure(binary,1,null,false);
   return {stdout:JSON.stringify(change(structuredClone(value),args.at(-1))),stderr:'',status:0};
  }
  return originalRun(binary,args,options);
 };
 f.service.reconstructProxyRuntime(f.root);
 assert.equal(fs.readFileSync(path.join(cache,'.application.env'),'utf8'),names.map((name,index)=>name+'_PROXY='+addresses[index]+'\n').join(''));
 for(const name of ['disabled','nohost'])assert.equal(fs.readFileSync(path.join(cache,'.'+name+'.env'),'utf8'),'');
 assert(!fs.existsSync(path.join(cache,'.wizard.env')));
 assert.deepEqual(f.calls.map(call=>call.args.at(-1)),observations.flatMap(item=>[item.Name.slice(1),item.Id]));
 assert(f.calls.every(call=>call.binary==='docker'&&call.args.slice(0,5).join(' ')==='--host=unix:///var/run/docker.sock container inspect --format {{json .}}'));
 f.service.run(f.command);
 const routed=fs.readFileSync(path.join(f.command.templates,'default.conf.template'),'utf8');
 names.forEach((name,index)=>assert(routed.includes('server '+addresses[index]+':80;'),'reconstructed '+name+' uses its exact running proxy address'));
 const retained=fs.readdirSync(cache).map(name=>[name,fs.readFileSync(path.join(cache,name),'utf8')]);
 for(const mutation of [
  value=>({...value,Id:'short'}),value=>({...value,Name:'/foreign_prod_1'}),
  value=>({...value,Config:{Labels:{...value.Config.Labels,'com.docker.compose.project':'foreign'}}}),
  value=>({...value,Config:{Labels:{...value.Config.Labels,'com.docker.compose.service':'foreign'}}}),
  value=>({...value,State:{Running:false}}),value=>({...value,State:{Running:true,Paused:true}}),
  value=>({...value,State:{Running:true,Restarting:true}}),
  (value,identifier)=>identifier===value.Id?{...value,Id:'f'.repeat(64)}:value,
  value=>({...value,NetworkSettings:{Networks:{proxy:{IPAddress:'0.0.0.0'}}}}),
  value=>({...value,NetworkSettings:{Networks:{proxy:{IPAddress:'999.20.0.4'}}}}),
  value=>({...value,NetworkSettings:{Networks:{}}}),
  value=>({...value,NetworkSettings:{Networks:{one:{IPAddress:'172.20.0.4'},two:{IPAddress:'172.20.0.5'}}}}),
  ()=>{throw new ProcessFailure('docker',1,null,false);},
 ]){
  change=(value,identifier)=>value.Id===observations.at(-1).Id?mutation(value,identifier):{...value,NetworkSettings:{Networks:{proxy:{IPAddress:'172.30.0.9'}}}};f.calls.length=0;
  assert.throws(()=>f.service.reconstructProxyRuntime(f.root));
  assert.deepEqual(fs.readdirSync(cache).map(name=>[name,fs.readFileSync(path.join(cache,name),'utf8')]),retained,'invalid enabled proxy cannot replace any cache records');
  assert.equal(fs.readFileSync(path.join(f.command.templates,'default.conf.template'),'utf8'),routed);
  assert(f.calls.every(call=>call.args.includes('{{json .}}')),'reconstruction never performs Compose, project lifecycle or routing mutation');
 }
 change=value=>value;f.process.run=originalRun;
 for(const name of ['disabled','nohost','wizard'])fs.unlinkSync(path.join(projectDirectory,'.'+name+'.env'));
 function configure(flags,mode){
  const selection='PROJECT_NAME=application\n'+names.map((name,index)=>'USE_'+name+'_HOST='+flags[index]+'\n').join('');
  fs.writeFileSync(path.join(f.root,'config/system/.projects.env/.application.env'),selection);
  fs.writeFileSync(path.join(f.root,'config/nginx-proxy/.projects/.application.env'),selection+names.map(name=>name+'_DOMAIN_MODE='+mode+'\n'+name+'_PROXY=127.0.0.1\n'+name+'_HOST='+name+'.localhost\n').join(''));
 }
 for(let mask=0;mask<8;mask++)for(const action of ['start','reload']){
  const flags=names.map((_,index)=>!!(mask&(1<<index)));configure(flags,0);f.calls.length=0;
  f.service.run({...f.command,action});const rendered=fs.readFileSync(path.join(f.command.templates,'default.conf.template'),'utf8');
  names.forEach((name,index)=>assert.equal(rendered.split('server_name '+name+'.localhost;').length-1,Number(flags[index])));
  const trace=JSON.stringify(f.calls.map(call=>call.args));
  if(action==='reload'){assert(trace.includes('"nginx","-t"'));assert(trace.includes('"nginx","-s","reload"'));assert(!trace.includes('"--build"'));}
  else{assert(trace.includes('"up","--build","--remove-orphans","--force-recreate","-d","web"'));assert(!trace.includes('"nginx","-s","reload"'));}
  assert(rendered.includes('server_name wizard.example.test;'));assert(rendered.includes('server_name sync.example.test;'));
 }
 fs.unlinkSync(path.join(f.root,'templates/nginx/default.ssl.conf.template'));
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
 assert.deepEqual(f.calls.at(-1).args,['--host=unix:///var/run/docker.sock','compose','--compatibility','-f','docker-compose.yml','stop','web']);
 assert.equal(f.calls.at(-1).options.env.PERSISTENT_DIR,'/selected/data');
 fs.writeFileSync(path.join(f.root,'config/system/.projects.env/.wizard.env'),'PROJECT_NAME=wizard\nPROJECT_TEMPLATE=wizard\n');
 fs.writeFileSync(path.join(f.root,'config/system/.projects.env/.sample.env'),'PROJECT_NAME=sample\n');
 f.calls.length=0;f.service.run({...f.command,action:'stop-proxies'});
 assert.deepEqual(f.calls.map(row=>row.args),[['--host=unix:///var/run/docker.sock','compose','--compatibility','-p','sample','down']]);
 assert.throws(()=>f.service.run({...f.command,root:'relative'}),/Absolute/);
});
