'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function validate(receipt,metadata,env,bytes){
  if(env.GITLAB_CI!=='true'||env.NPM_PUBLISH_ENABLED!=='true'||env.CI_COMMIT_REF_PROTECTED!=='true'||env.CI_PIPELINE_SOURCE!=='push'||env.CI_COMMIT_TAG||env.CI_COMMIT_BRANCH!==env.CI_DEFAULT_BRANCH)throw Error('Protected accepted release required.');
  if(receipt.format!=='system-cli-source-v1'||receipt.name!=='@systembootstrapper/cli'||receipt.version!==metadata.version||metadata.format!=='system-accepted-release-v1'||metadata.source?.revision!==receipt.sourceRevision||metadata.source?.tree!==receipt.sourceTree||receipt.sourceRevision!==env.CI_COMMIT_SHA||receipt.pipelineId!==Number(env.CI_PIPELINE_ID)||!Number.isSafeInteger(receipt.packageJobId)||receipt.packageJobId<=0||!/^[a-z0-9.-]+\.tgz$/.test(receipt.filename)||receipt.sha256!==hash(bytes)||receipt.integrity!=='sha512-'+crypto.createHash('sha512').update(bytes).digest('base64'))throw Error('Exact accepted package identity required.');
}
async function publish(env=process.env,root=process.cwd(),request=fetch){
  const directory=path.join(root,'test-results/npm-package');
  const receipt=JSON.parse(fs.readFileSync(path.join(directory,'receipt.json')));
  if(!/^[a-z0-9.-]+\.tgz$/.test(receipt.filename||''))throw Error('Invalid package artifact.');
  const bytes=fs.readFileSync(path.join(directory,receipt.filename));
  const releasePath='test-results/public-release/system-release-v'+receipt.version+'.json';
  if(!/^\d+\.\d+\.\d+$/.test(receipt.version||''))throw Error('Invalid release version.');
  const metadata=JSON.parse(fs.readFileSync(path.join(root,releasePath)));
  validate(receipt,metadata,env,bytes);
  const github=require('./publish-github-release');
  const ci=github.context(env,root);
  const origin=new URL(env.CI_API_V4_URL);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)throw Error('Trusted GitLab API required.');
  const gitlab=github.api(origin.href.replace(/\/$/,''),github.token(env,'SYSTEM_RELEASE_GITLAB_TOKEN'),'PRIVATE-TOKEN',request);
  const jobs=await github.gates(ci,env,root,gitlab,metadata.source.sourceLayout);
  for(const [name,files] of [['test:npm-package',['test-results/npm-package/receipt.json','test-results/npm-package/'+receipt.filename]],['deploy:github-release',[releasePath]]]){
    const rows=jobs.filter(row=>row.name===name);
    if(rows.length!==1||rows[0].status!=='success'||rows[0].allow_failure!==false||rows[0].commit?.id!==ci.sourceRevision||rows[0].pipeline?.id!==ci.pipelineId||name==='test:npm-package'&&rows[0].id!==receipt.packageJobId)throw Error('Successful same-attempt package and release jobs required.');
    for(const file of files){const remote=await gitlab('/projects/'+ci.projectId+'/jobs/'+rows[0].id+'/artifacts/'+file,{raw:true});if(!remote||hash(remote)!==hash(fs.readFileSync(path.join(root,file))))throw Error('Package artifact ownership mismatch.');}
  }
  const endpoint='https://registry.npmjs.org/'+encodeURIComponent(receipt.name)+'/'+receipt.version;
  const existing=await request(endpoint,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(existing.ok){if((await existing.json()).dist?.integrity!==receipt.integrity)throw Error('Existing public npm version differs.');return receipt;}
  if(existing.status!==404)throw Error('npm registry unavailable.');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'system-npm-'));fs.chmodSync(temporary,0o700);
  try{
    const npmrc=path.join(temporary,'npmrc');
    const credential=github.token(env,'NPM_TOKEN');
    fs.writeFileSync(npmrc,'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken='+credential+'\n',{mode:0o600});
    const childEnv={...env,NPM_CONFIG_USERCONFIG:npmrc};delete childEnv.NPM_TOKEN;delete childEnv.NPM_TOKEN_FILE;
    execFileSync('npm',['publish',path.join(directory,receipt.filename),'--access','public','--ignore-scripts','--provenance=false'],{cwd:temporary,env:childEnv,stdio:'pipe',timeout:120000});
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
  const published=await request(endpoint,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!published.ok||(await published.json()).dist?.integrity!==receipt.integrity)throw Error('Public npm package verification failed.');
  return receipt;
}
module.exports={validate,publish};
if(require.main===module)publish().then(value=>console.log('Published '+value.name+'@'+value.version)).catch(()=>{console.error('npm publication refused; verify accepted artifacts and protected publisher credentials.');process.exitCode=1;});
