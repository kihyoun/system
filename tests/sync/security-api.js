'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {allowedBrowserOrigin}=require('../../sync/dist/HttpSecurity');
const {projectConfigPath}=require('../../sync/dist/StatePaths');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync-security-'));
const previous=process.env.SYSTEM_CONFIG_DIR;process.env.SYSTEM_CONFIG_DIR=root;
fs.writeFileSync(path.join(root,'.docker.env'), "WIZARD_HOST='wizard.example.test'\nWIZARD_DOMAIN_MODE=2\nSYNC_ALLOWED_ORIGINS='http://127.0.0.1:5173'\n");
function origin(value,host='sync.example.test') {return allowedBrowserOrigin({protocol:'https',get:key=>key==='Origin'?value:host});}
function request(route,body,extra={},method=body===undefined?'GET':'POST') {return new Promise((resolve,reject)=>{
 const req=http.request({host:'127.0.0.1',port:8071,path:route,method,headers:{'Content-Type':'application/json',...extra}},res=>{
  let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));
 });req.on('error',reject);req.end(body);
});}
(async()=>{
 assert(origin('https://wizard.example.test'));assert(origin('http://127.0.0.1:5173'));
 for(const bad of ['null','https://wizard.example.test.attacker.test','https://wizard.example.test@attacker.test','https://attacker.test/#https://wizard.example.test'])assert(!origin(bad));
 assert.throws(()=>projectConfigPath('../outside'));assert.throws(()=>projectConfigPath(['foo']));
 const child=spawn(process.execPath,[path.resolve(__dirname,'../../sync/dist/index.js')],{cwd:path.resolve(__dirname,'../../sync'),stdio:'ignore',env:{...process.env,SYNC_USER:'fixture',SYNC_PASS:'fixture-secret'}});
 const closed=new Promise(resolve=>child.once('exit',resolve));
 try {
  let ready=false;for(let i=0;i<100;i++){try{await request('/status');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}
  assert(ready);
  const rejected=await request('/login',JSON.stringify({username:'fixture',password:'fixture-secret'}),{Origin:'https://attacker.test'});
  assert.equal(rejected.status,403);assert.equal(rejected.headers['access-control-allow-origin'],undefined);
  const login=await request('/login',JSON.stringify({username:'fixture',password:'fixture-secret'}),{Origin:'https://wizard.example.test'});
  assert.equal(login.status,200);assert.equal(login.headers['access-control-allow-origin'],'https://wizard.example.test');
  const auth={Authorization:'Bearer '+JSON.parse(login.text).accessToken};
  const allowedOptions=await request('/config/main',undefined,{Origin:'https://wizard.example.test','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'},'OPTIONS');
  assert.equal(allowedOptions.status,204);assert.equal(allowedOptions.text,'');
  assert.equal(allowedOptions.headers['access-control-allow-origin'],'https://wizard.example.test');
  assert.equal(allowedOptions.headers['access-control-allow-methods'],'GET,HEAD,PUT,PATCH,POST,DELETE');
  assert.equal(allowedOptions.headers['access-control-allow-headers'],'Authorization,Content-Type');
  assert.equal((await request('/config/main',undefined,{Origin:'https://attacker.test'},'OPTIONS')).status,403);
  assert.equal((await request('/status',undefined,{},'HEAD')).status,401);
  const head=await request('/status',undefined,auth,'HEAD');assert.equal(head.status,200);assert.equal(head.text,'');assert.match(head.headers['content-type'],/application\/json/);
  for(const [route,method] of [['/login','GET'],['/status','POST'],['/token','PATCH'],['/config/main','PUT']]) {
    assert.equal((await request(route,method==='GET'?undefined:'{}',auth,method)).status,404,method+' '+route+' must not acquire another route method');
  }
  const oversized=await request('/login',JSON.stringify({padding:'x'.repeat(5*1024*1024)}));
  assert.equal(oversized.status,400);assert.equal(oversized.text,'{"message":"Invalid request."}');

  const parser=await request('/login','{"broken":');assert.equal(parser.status,400);assert.match(parser.headers['content-type'],/application\/json/);assert.equal(parser.text,'{"message":"Invalid request."}');
  const error=await request('/config/projects',undefined,auth);assert.equal(error.status,500);assert(!error.text.includes(root));assert(!error.text.includes('Error:'));assert.match(error.headers['content-type'],/application\/json/);
  assert.equal((await request('/projects/availability?projectKey=..%2Foutside&namespaceId=1',undefined,auth)).status,400);
  let limited;for(let i=0;i<22;i++){limited=await request('/login','{}',{'X-Forwarded-For':'192.0.2.'+(i+1)});if(limited.status===429)break;}
  assert.equal(limited.status,429);assert(Number(limited.headers['retry-after'])>0);
  assert.equal((await request('/status',undefined,auth)).status,200,'failed-login limit must preserve authenticated status access');
  console.log('PASS: exact CORS origins, preflight/HEAD/method compatibility, bounded bodies/authentication, safe errors and project paths');
 } finally {child.kill();await closed;}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(previous===undefined)delete process.env.SYSTEM_CONFIG_DIR;else process.env.SYSTEM_CONFIG_DIR=previous;fs.rmSync(root,{recursive:true,force:true});});
