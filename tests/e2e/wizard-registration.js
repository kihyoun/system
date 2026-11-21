'use strict';
function requireValue(value,code){if(!value)throw Object.assign(Error(code),{noRetry:true});}
function syncSession(candidate,host=new URL(candidate.url).host) {
  let accessToken,issuedAt=0;
  const now=()=>candidate.now?candidate.now():Date.now();
  const login=async()=>{
    const response=await candidate.request(candidate.url+'/login',{method:'POST',headers:{Host:host,'Content-Type':'application/json'},
      body:JSON.stringify({username:candidate.secrets.user,password:candidate.secrets.password})});
    requireValue(response.status===200,'guided-preview-sync-login-failed');
    let value;try{value=JSON.parse(response.body);}catch{throw Error('guided-preview-sync-login-failed');}
    requireValue(typeof value.accessToken==='string'&&value.accessToken.length>0,'guided-preview-sync-login-failed');
    accessToken=value.accessToken;issuedAt=now();
  };
  return async(route,payload)=>{
    if(!accessToken||now()-issuedAt>=15*60000)await login();
    const send=()=>candidate.request(candidate.url+route,{method:payload===undefined?'GET':'POST',headers:{Host:host,
      Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    let response=await send();
    if(payload===undefined&&[401,403].includes(response.status)){await login();response=await send();}
    requireValue(response.status>=200&&response.status<300,'guided-preview-sync-request-failed');
    try{return JSON.parse(response.body);}catch{throw Error('guided-preview-sync-result-invalid');}
  };
}
async function registrationReason(candidate,message){
  const known=new Map([
    ['Namespace lookup failed','namespace-unavailable'],
    ['The local administrator namespace could not be found.','namespace-unavailable'],
    ['Repository already exists in the selected namespace.','project-rejected'],
    ['Default branch not ready; retry Save','default-branch-missing'],
    ['CI installation failed; retry Save','ci-installation-failed'],
    ['Repository ready; routing failed. Retry Save.','routing-failed'],
    ...[400,401,403,404,409,422,500,502,503,504].map(code=>[
      `GitLab rejected project creation (HTTP ${code}); check namespace permissions, reserved names or a competing creation.`,
      'project-rejected']),
  ]);
  const reason='system-beta-registration-'+(known.get(message)||'unknown-failure');
  if(known.get(message)==='ci-installation-failed')try{
    const logs=await candidate.inner(['logs','--tail','200','system_bootstrapper_1'],{timeout:10000,maxBuffer:65536});
    if(typeof logs==='string'&&Buffer.byteLength(logs)<=65536){
      const matches=[...logs.matchAll(/^BOOTSTRAPPER_PROJECT_CI_COMMIT_HTTP:([1-5][0-9]{2})\r?$/gm)];
      if(matches.length===1&&matches[0][1]!=='201')return reason+'-http-'+matches[0][1];
    }
  }catch{/* Retain the original bounded refusal when diagnostic logs are unavailable. */}
  return reason;
}
async function waitForRegistration(candidate,session=syncSession(candidate,'sync.candidate.test')){
  await candidate.wait(async()=>{
    const response=await session('/status'),status=response.status||response;
    if(status.defaultWizardProject?.state==='failed')requireValue(false,await registrationReason(candidate,status.defaultWizardProject.message));
    return status.defaultWizardSetupInProgress===false&&status.defaultWizardProject?.state==='registered';
  },candidate.spec.readinessMilliseconds||600000);
}
module.exports={syncSession,waitForRegistration};
