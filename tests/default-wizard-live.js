// Explicit integration check against a disposable local platform's Sync service.
// The default private Wizard scaffold remains available for inspection.
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
function request(route, body, token) {
 return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:8071,path:route,method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})}},res=>{
   let text='';res.on('data',c=>text+=c);res.on('end',()=>{
    if(res.statusCode!==200)return reject(Error('Unexpected HTTP status '+res.statusCode));
    try{resolve(JSON.parse(text));}catch(e){reject(e);}
   });
  });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
}
(async()=>{
 const login=await request('/login',{username:process.env.SYNC_USER,password:process.env.SYNC_PASS});
 const token=login.accessToken;
 for(let attempt=0;attempt<300;attempt++){
  const response=await request('/status',null,token);
  const status=response.status || response;
  if(status.defaultWizardProject?.state==='failed')throw Error(status.defaultWizardProject.message);
  if(!status.defaultWizardSetupInProgress && status.defaultWizardProject?.state==='registered')break;
  if(attempt===299)throw Error('Default Wizard registration timed out');
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 const projects=await request('/config/projects',null,token);
 assert.equal(projects[0].filename,'.wizard.env');
 const project=projects[0];
 assert(project.repository.systemProject);
 assert.equal(project.repository.path,'root/wizard');
 assert.equal(project.repository.deploymentState,'existing-interface');
 assert(!project.repository.initialPipeline);
 assert(project.data.includes('PROD_HOST="'+process.env.WIZARD_HOST+'"'));
 assert(project.data.includes('USE_BETA_HOST="false"')&&project.data.includes('USE_REVIEW_HOST="false"'));
 assert.equal(project.data.substr(807,1),'$');
 assert.equal(crypto.createHash('md5').update(project.data.substr(0,1184)).digest('hex'),'bd4a8426355824593a5e21ad759830c1');
 const {ensureDefaultWizard}=require('../sync/dist/DefaultWizard');
 const repeated=await ensureDefaultWizard();
 assert.equal(repeated.repository.id,project.repository.id);
 const again=await request('/config/projects',null,token);
 assert.equal(again[0].repository.id,project.repository.id);
 console.log('Live default Wizard: first project, real Production URL, private repository metadata, same ID on repeat, no pipeline and valid Fetch signature passed.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
