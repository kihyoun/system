'use strict';
// An ordinary application created through Sync inside the owned candidate only.
const APP_HOST='app.candidate.test', APP_ALIAS='oldapp.candidate.test', BETA_HOST='betaapp.candidate.test';
const certificateHosts=[APP_HOST,APP_ALIAS];
const PROJECT='routingproof';
const challenge='/.well-known/acme-challenge/application-alias-check';
const route='/nested%20application/path?one=1&two=a%2Fb&one=2';
async function controller(candidate,action,input){
  const script="let text='';process.stdin.on('data',part=>text+=part);process.stdin.on('end',async()=>{try{const result=await ("+action.toString()+")(JSON.parse(text));if(result!==undefined)process.stdout.write(JSON.stringify(result));}catch{process.exitCode=1;}});";
  const result=await candidate.inner(['exec','-i','system_bootstrapper_1','node','-e',script],{input:JSON.stringify(input),timeout:180000});
  return result?JSON.parse(result):undefined;
}
async function session(candidate,connection){
  const probe=require('./recovery').tlsProbe;
  const login=await probe(candidate,'sync.candidate.test','/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:candidate.secrets.user,password:candidate.secrets.password})},connection);
  if(login.status!==200)throw Error('application-routing-login-failed');
  const token=JSON.parse(login.body).accessToken;
  return {token,request:async(path,data)=>{
    const response=await probe(candidate,'sync.candidate.test',path,{headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},
      ...(data?{method:'POST',body:JSON.stringify(data)}:{})},connection);
    if(![200,202].includes(response.status))throw Error('application-routing-api-failed');
    return JSON.parse(response.body);
  }};
}
async function upload(candidate,token,path,archive,fingerprint){
  return controller(candidate,async function(input){
    const fs=require('fs'),http=require('http'),boundary='application-routing-fixture';
    const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="bootstrapper.zip"; filename="bootstrapper.zip"\r\nContent-Type: application/zip\r\n\r\n'),
      fs.readFileSync(input.archive),Buffer.from('\r\n'+(input.fingerprint?'--'+boundary+'\r\nContent-Disposition: form-data; name="impact"\r\n\r\n'+input.fingerprint+'\r\n':'')+'--'+boundary+'--\r\n')]);
    return new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port:8071,path:input.path,method:'POST',timeout:150000,headers:{Authorization:'Bearer '+input.token,
        'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':body.length}},res=>{
        let raw='';res.on('data',part=>raw+=part);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(raw)});}catch{reject(Error());}});
      });req.on('error',reject);req.on('timeout',()=>req.destroy(Error()));req.end(body);
    });
  },{token,path,archive,fingerprint});
}
async function snapshot(candidate){
  const names=(await candidate.inner(['ps','--format','{{.Names}}'])).split('\n').filter(Boolean).sort();
  const rows=JSON.parse(await candidate.inner(['inspect',...names]));
  return Object.fromEntries(rows.map(row=>[row.Name,{id:row.Id,image:row.Image,started:row.State.StartedAt,restarts:row.RestartCount}]));
}
async function verify(candidate,connection={},dependencies={}){
  const recovery=require('./recovery');
  const tlsProbe=dependencies.tlsProbe||recovery.tlsProbe,httpProbe=dependencies.httpProbe||recovery.httpProbe,readyResponse=recovery.readyResponse;
  const execute=dependencies.controller||controller,authenticate=dependencies.session||session;
  await execute(candidate,function(input){const fs=require('fs'),path=require('path'),file='/ssl/acme-http01'+input.challenge;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'application-http01-proof');},{challenge});
  try{
    for(const probe of [httpProbe,tlsProbe]){
      const response=await readyResponse(candidate,()=>probe(candidate,APP_ALIAS,route,{},connection));
      if(response.status!==308||response.headers?.location!=='https://'+APP_HOST+route||connection.serial&&probe===tlsProbe&&response.serial!==connection.serial)
        throw Error('application-alias-redirect-failed');
      const responseChallenge=await probe(candidate,APP_ALIAS,challenge,{},connection);
      if(responseChallenge.status!==200||responseChallenge.body!=='application-http01-proof'||responseChallenge.headers?.location!==undefined)
        throw Error('application-alias-http01-failed');
    }
    const sync=await authenticate(candidate,connection),files=await sync.request('/config/projects');
    const application=files.find(file=>file.filename==='.'+PROJECT+'.env');
    if(!application||!application.data.includes('PROD_ALIASES="'+APP_ALIAS+'"')||!application.repository?.id||application.data[807]!=='$')throw Error('application-alias-fetch-roundtrip-failed');
    candidate.applicationAliasesVerified=true;
  }finally{await execute(candidate,function(input){require('fs').rmSync('/ssl/acme-http01'+input.challenge,{force:true});},{challenge});}
}
function assertPreserved(before,after){
  for(const [name,identity]of Object.entries(before))if(JSON.stringify(after[name])!==JSON.stringify(identity))throw Error('application-routing-existing-container-changed');
}
async function setup(candidate,connection={}){
  await candidate.stage('application-routing-native-project-and-selective-push',async()=>{
    const sync=await session(candidate,connection),namespaces=await sync.request('/projects/namespaces');
    const namespace=namespaces.namespaces.find(row=>row.path==='root');if(!namespace)throw Error('application-routing-namespace-required');
    const data=await controller(candidate,function(input){
      const fs=require('fs'),cube=fs.readFileSync('/state/.docker.env','utf8').slice(0,1184);
      const values={PROJECT_NAME:input.project,PROJECT_TEMPLATE:'empty',USE_PROD_HOST:'true',PROD_HOST:input.host,PROD_DOMAIN_MODE:'2',PROD_DEPLOY_MODE:'0',
        PROD_SSL:'/ssl/live/recovery-fixture/fullchain.pem',PROD_SSL_KEY:'/ssl/live/recovery-fixture/privkey.pem',
        USE_BETA_HOST:'true',BETA_HOST:input.beta,BETA_DOMAIN_MODE:'0',BETA_DEPLOY_MODE:'0',USE_REVIEW_HOST:'false',REVIEW_DEPLOY_MODE:'0',GITLAB_RUNNER_SCALE:'0',GITLAB_RUNNER_TOKEN:''};
      return cube+'\n'+Object.entries(values).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n';
    },{project:PROJECT,host:APP_HOST,beta:BETA_HOST});
    let job=await sync.request('/projects',{projectKey:PROJECT,namespaceId:namespace.id,template:'empty',data,ci:'workflow:\n  rules:\n    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH\n'});
    await candidate.wait(async()=>{if(job.state==='running')job=await sync.request('/projects/jobs/'+job.id);if(job.state==='failed')throw Error('application-routing-project-failed');return job.state==='complete';},180000);
    // Exercise stable Production/Beta application images while only Review
    // routing and the Production alias change through the native Wizard export.
    for(const [environment,host]of [['prod',APP_HOST],['beta',BETA_HOST]])
      await candidate.inner(['run','--pull','never','-d','--name','application-routing-'+environment,'--network',PROJECT+'_'+environment,'--env','VIRTUAL_HOST='+host,'nginx:latest']);
    const {tlsProbe,httpProbe}=require('./recovery');
    await candidate.wait(async()=>{const prod=await tlsProbe(candidate,APP_HOST,'/',{},connection),beta=await httpProbe(candidate,BETA_HOST,'/',{},connection);return prod.status===200&&beta.status===200;},30000);
    const before=await snapshot(candidate);
    for(const environment of ['prod','beta'])if(before['/application-routing-'+environment]?.image!==candidate.spec.images.nginx.id)throw Error('application-routing-preloaded-image-mismatch');
    const fetched=await require('./recovery').syncFetch(candidate,connection);
    const application=fetched.projects.find(file=>file.filename==='.'+PROJECT+'.env');
    if(!application)throw Error('application-routing-fetch-required');
    application.data=application.data.replace('USE_REVIEW_HOST="false"','USE_REVIEW_HOST="true"')+'\nREVIEW_HOST="reviewapp.candidate.test"\nREVIEW_DOMAIN_MODE="1"\nPROD_ALIASES="'+APP_ALIAS+'"\n';
    await controller(candidate,function(input){require('fs').writeFileSync('/tmp/application-routing-fetch.json',JSON.stringify(input),{mode:0o600});},fetched);
    await candidate.inner(['exec','system_bootstrapper_1','node','/opt/system-bootstrapper/export-configuration.cjs','/tmp/application-routing-fetch.json','/tmp/application-routing.zip']);
    const plan=await upload(candidate,sync.token,'/config/impact','/tmp/application-routing.zip');
    if(plan.status!==200||plan.data.mode!=='routing'||JSON.stringify(plan.data.projects)!==JSON.stringify([PROJECT]))throw Error('application-routing-impact-mismatch');
    let completed=false;
    const applying=upload(candidate,sync.token,'/config/zip','/tmp/application-routing.zip',plan.data.fingerprint).then(result=>{completed=true;return {result};},error=>{completed=true;return {error};});
    let readinessChecks=0;
    while(!completed){
      await candidate.inner(['exec','system_gitlab_1','curl','-fsS','--max-time','3','http://127.0.0.1/-/readiness']);readinessChecks++;
      if(!completed)await new Promise(resolve=>setTimeout(resolve,100));
    }
    const outcome=await applying;if(outcome.error)throw outcome.error;const applied=outcome.result;
    if(!readinessChecks||applied.status!==200||applied.data.applyMode!=='routing'||applied.data.status.needRestart)throw Error('application-routing-push-restarted-platform');
    const after=await snapshot(candidate);
    assertPreserved(before,after);
    for(const [probe,host]of [[tlsProbe,APP_HOST],[httpProbe,BETA_HOST]])if((await probe(candidate,host,'/',{},connection)).status!==200)throw Error('application-routing-existing-route-changed');
    await verify(candidate,connection);
    await candidate.inner(['restart','system_web_1']);await verify(candidate,connection);
    const unchangedDuringProxyRestart=Object.fromEntries(Object.entries(after).filter(([name])=>name!=='/system_web_1'));
    assertPreserved(unchangedDuringProxyRestart,await snapshot(candidate));
    candidate.evidence.applicationRouting={selectivePush:true,gitlabIdentityPreserved:true,existingContainersPreserved:true,readinessChecks,aliasHttp01Verified:true,proxyRestartVerified:true};
    await controller(candidate,function(){const fs=require('fs');for(const file of ['/tmp/application-routing-fetch.json','/tmp/application-routing.zip'])fs.rmSync(file,{force:true});},{});
  });
}
module.exports={certificateHosts,APP_HOST,APP_ALIAS,BETA_HOST,PROJECT,verify,setup,snapshot,upload,assertPreserved};
