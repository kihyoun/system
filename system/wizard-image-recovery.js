'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
function execute(command,args,options={}) {
  const result=spawnSync(command,args,{encoding:'utf8',timeout:180000,maxBuffer:1024*1024,...options});
  if(result.error||result.status!==0)throw Error('Wizard registry recovery command failed; inspect service readiness and the configured image.');
  return result.stdout.trim();
}
function syncDirectory(directory){
  const descriptor=fs.openSync(directory,'r');
  try{fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
}
function localRegistry(registryUrl,domainMode) {
  const registry=new URL(registryUrl);
  if(!['http:','https:'].includes(registry.protocol)||registry.username||registry.password||registry.pathname!=='/'||registry.search||registry.hash)throw Error('Invalid local registry URL.');
  if(Number(domainMode||0)<2)registry.port='5050';
  return registry;
}
function projectForImage(content,image,registryUrl,domainMode=2) {
  if(content[807]!=='$'||crypto.createHash('md5').update(content.slice(0,1184)).digest('hex')!=='bd4a8426355824593a5e21ad759830c1')throw Error('Invalid Wizard configuration signature.');
  const registry=localRegistry(registryUrl,domainMode);
  const match=/^([a-z0-9.-]+(?::[0-9]+)?)\/([a-z0-9._/-]+)@sha256:([a-f0-9]{64})$/.exec(image);
  if(!match||match[1]!==registry.host||match[2].split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Wizard recovery requires an immutable image from the local registry.');
  const marker='# BOOTSTRAPPER_PROJECT=';
  const markers=content.split('\n').filter(value=>value.startsWith(marker));
  if(markers.length!==1)throw Error('Managed Wizard receipt is missing or ambiguous.');
  const line=markers[0];
  let receipt;
  try {receipt=JSON.parse(Buffer.from(line.slice(marker.length),'base64').toString('utf8'));}catch{throw Error('Managed Wizard receipt is missing.');}
  const repository=receipt.repository;
  if(receipt.defaultProject!==true||receipt.state!=='complete'||receipt.template!=='wizard'||repository?.systemProject!==true||!Number.isInteger(repository?.id)||repository.id<1||typeof repository.path!=='string'||
    (match[2]!==repository.path&&!match[2].startsWith(repository.path+'/')))throw Error('Registry image does not belong to the managed Wizard project.');
  return {projectId:repository.id,projectPath:repository.path,registry:registry.host,image};
}
async function recoverImage(settings=process.env,dependencies={}) {
  const run=dependencies.execute||execute;
  const env={...settings};
  for(const name of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[name];
  const docker=(args,options={})=>run('docker',['--host=unix:///var/run/docker.sock',...args],{env,...options});
  const image=settings.WIZARD_IMAGE||'systembootstrapper/wizard';
  if(settings.WIZARD_ENABLE!=='true')return {state:'disabled'};
  let available=false;
  try {docker(['image','inspect',image]);available=true;}catch{ /* exact pin is absent */ }
  const registry=localRegistry(settings.GITLAB_REGISTRY_URL,settings.GITLAB_REGISTRY_DOMAIN_MODE);
  if(!image.startsWith(registry.host+'/'))return {state:available?'available':'external-image'};
  const state=settings.SYSTEM_CONFIG_DIR||'/state';
  const syncState=dependencies.syncState||(()=>syncDirectory(state));
  const project=projectForImage(fs.readFileSync(path.join(state,'.projects.env/.wizard.env'),'utf8'),image,settings.GITLAB_REGISTRY_URL,settings.GITLAB_REGISTRY_DOMAIN_MODE);
  const lock=path.join(state,'.wizard-image-recovery.lock');
  const pending=path.join(state,'.wizard-image-recovery.pending');
  if(fs.existsSync(lock))throw Error('Interrupted Wizard image recovery lease requires operator inspection.');
  if(available&&!fs.existsSync(pending))return {state:'available'};
  fs.mkdirSync(lock,{mode:0o700});
  let credential,privateConfig,primaryFailure,mintAttempted=false,cleanupFailure;
  const ruby=fs.readFileSync(path.join(__dirname,'wizard-registry-token.rb'),'utf8');
  const rails=input=>{
    const script="WIZARD_RECOVERY_INPUT='"+Buffer.from(JSON.stringify(input)).toString('base64')+"'\n"+ruby;
    const text=docker(['exec','-i','system_gitlab_1','gitlab-rails','runner','-'],{input:script});
    try{return JSON.parse(text.split('\n').at(-1));}catch{throw Error('Invalid registry recovery credential response.');}
  };
  try {
    // A fresh host cannot authenticate to its own registry until GitLab and a
    // routing-only proxy exist. This mode never pulls/starts Wizard or Sync.
    run('bash',['-e','start.sh','recovery'],{cwd:path.join(__dirname,'../nginx'),env});
    const waitReady=dependencies.waitReady||(async()=>{
      const until=Date.now()+300000;
      do {
        try {docker(['exec','system_gitlab_1','curl','-fsS','--max-time','3','http://127.0.0.1/-/readiness']);return;}
        catch{ /* bounded internal readiness retry */ }
        await new Promise(resolve=>setTimeout(resolve,2500));
      } while(Date.now()<until);
      throw Error('GitLab did not become ready for registry recovery.');
    });
    await waitReady();
    fs.writeFileSync(pending,JSON.stringify({projectId:project.projectId,image:project.image}),{mode:0o600,flush:true});
    // Persist both the pending file and the lease's directory entry before a
    // credential can be minted, including after a host power loss.
    syncState();
    mintAttempted=true;
    if(available){rails({...project,action:'cleanup'});}
    else{
    credential=rails({...project,action:'create'});
    if(!Number.isInteger(credential.id)||!/^gitlab\+deploy-token-[0-9]+$/.test(credential.username)||typeof credential.token!=='string'||!credential.token)throw Error('Invalid registry recovery credential.');
    privateConfig=fs.mkdtempSync(path.join(os.tmpdir(),'wizard-registry-'));fs.chmodSync(privateConfig,0o700);
    const privateEnv={...env,DOCKER_CONFIG:privateConfig};
    docker(['--config',privateConfig,'login',project.registry,'--username',credential.username,'--password-stdin'],{env:privateEnv,input:credential.token+'\n'});
    docker(['--config',privateConfig,'pull',project.image],{env:privateEnv});
    const digests=JSON.parse(docker(['image','inspect','--format','{{json .RepoDigests}}',project.image]));
    if(!Array.isArray(digests)||!digests.includes(project.image))throw Error('Recovered Wizard image digest does not match its configured pin.');
    }
  } catch(error) {primaryFailure=error;}
  finally {
    if(mintAttempted)try{
      const result=rails({...project,action:credential?.id?'revoke':'cleanup',...(credential?.id?{tokenId:credential.id}:{})});
      if(result.revoked!==true)throw Error();
    }catch{cleanupFailure=Error('Registry recovery credential revocation failed.');}
    if(privateConfig)try{fs.rmSync(privateConfig,{recursive:true,force:true});}catch{cleanupFailure=Error('Cannot remove private registry login state.');}
    if(mintAttempted&&!cleanupFailure&&fs.existsSync(pending))fs.unlinkSync(pending);
    fs.rmdirSync(lock);
    try{syncState();}catch{cleanupFailure=Error('Cannot persist registry recovery cleanup state.');}
    if(cleanupFailure)throw cleanupFailure;
  }
  if(primaryFailure)throw primaryFailure;
  return {state:'recovered'};
}
module.exports={localRegistry,projectForImage,recoverImage,syncDirectory};
if(require.main===module)recoverImage().then(result=>console.log('Wizard image recovery: '+result.state)).catch(error=>{console.error(error.message);process.exitCode=1;});
