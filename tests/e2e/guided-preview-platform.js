'use strict';
// Configure the original owned disposable platform before taking the guided
// baseline. Source CI bytes and TLS verification remain unchanged.
const {settings: desiredSettings}=require('../../project-bootstrap/preview-setup/settings');
const recovery=require('./recovery');
const {ISSUANCE_CA,issuanceDomains}=require('./local-acme');
const LEAF='/ssl/live/recovery-fixture/fullchain.pem',KEY='/ssl/live/recovery-fixture/privkey.pem';
const TRUST='/run/system-bootstrapper/guided-preview-ca.pem';
const JOB_TRUST='/etc/system-bootstrapper/guided-preview-ca.pem';
const HOSTS={gitlab:'gitlab.candidate.test',registry:'registry.candidate.test',wizard:'wizard.candidate.test',sync:'sync.candidate.test',
  review:'review.candidate.test',beta:'beta.candidate.test'};
function requireValue(value,code){if(!value)throw Error(code);}
function settings(candidate){
  const spec=candidate.spec;
  requireValue(spec.fullAcceptance===true&&spec.guidedPreviewAcceptance===true&&/^[a-f0-9]{24}$/.test(candidate.id),'guided-preview-owned-platform-required');
  requireValue(['sourceRevision','sourceTree','wizardSourceRevision'].every(key=>/^[a-f0-9]{40}$/.test(spec[key]||''))&&
    ['candidate','wizard'].every(role=>/^sha256:[a-f0-9]{64}$/.test(spec.images?.[role]?.id||'')),'guided-preview-source-identities-required');
  const desired=desiredSettings(spec.guidedPreviewSettings);
  for(const kind of ['review','beta'])requireValue(desired[kind].enabled&&desired[kind].host===HOSTS[kind]&&
    desired[kind].ssl===LEAF&&desired[kind].sslKey===KEY,'guided-preview-owned-tls-settings-required');
  return desired;
}
async function node(candidate,action,input){
  const script="let raw='';process.stdin.on('data',part=>raw+=part);process.stdin.on('end',async()=>{try{const input=JSON.parse(raw);const result=await ("+action.toString()+")(input);if(result!==undefined)process.stdout.write(JSON.stringify(result));}catch{process.exitCode=1;}});";
  const result=await candidate.inner(['exec','-i','system_bootstrapper_1','node','-e',script],{input:JSON.stringify(input),timeout:30000});
  return result?JSON.parse(result):undefined;
}
function runnerTrust(content){
  requireValue(typeof content==='string'&&(content.match(/^\s*\[\[runners\]\]\s*$/gm)||[]).length===1&&
    (content.match(/^\s*\[runners\.docker\]\s*$/gm)||[]).length===1,'guided-preview-single-managed-runner-required');
  const variables=['SSL_CERT_FILE','GIT_SSL_CAINFO','CURL_CA_BUNDLE','NODE_EXTRA_CA_CERTS','REQUESTS_CA_BUNDLE'].map(name=>name+'='+JOB_TRUST);
  const array=(block,name,required)=>{
    const expression=new RegExp('^(\\s*)'+name+' = (\\[[^\\r\\n]*\\])[ \\t]*$','m');
    const found=expression.exec(block);let values=[];
    if(found){try{values=JSON.parse(found[2]);}catch{throw Error('guided-preview-managed-runner-array-required');}}
    requireValue(Array.isArray(values)&&values.every(value=>typeof value==='string'),'guided-preview-managed-runner-array-required');
    for(const value of required){
      const prefix=name==='environment'?value.split('=')[0]+'=':null;
      requireValue(!values.some(existing=>prefix?existing.startsWith(prefix)&&existing!==value:
        existing.split(':')[1]===JOB_TRUST&&existing!==value),'guided-preview-runner-trust-conflict');
      if(!values.includes(value))values.push(value);
    }
    const assignment=(found?.[1]||'  ')+name+' = '+JSON.stringify(values);
    return found?block.replace(expression,()=>assignment):block.trimEnd()+'\n'+assignment+'\n';
  };
  const firstNested=content.search(/^\s*\[runners\.[^\]]+\]/m);
  requireValue(firstNested>=0,'guided-preview-managed-runner-sections-required');
  const top=array(content.slice(0,firstNested),'environment',variables),rest=content.slice(firstNested);
  const dockerStart=rest.search(/^\s*\[runners\.docker\]/m),tail=rest.slice(dockerStart);
  const nextSection=tail.slice(tail.indexOf(']')+1).search(/^\s*\[/m);
  const dockerEnd=nextSection<0?tail.length:tail.indexOf(']')+1+nextSection;
  return top+rest.slice(0,dockerStart)+array(tail.slice(0,dockerEnd),'volumes',[TRUST+':'+JOB_TRUST+':ro'])+tail.slice(dockerEnd);
}
function installAnchor(input){
  const fs=require('fs'),path=require('path'),crypto=require('crypto');
  const directory=input.directory||'/etc/ssl/certs';
  const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
  const publicFile=path.join(directory,'ca-certificates.crt');
  const before=fs.readFileSync(publicFile);
  if(sha(before)!==input.publicBundleSha256||!/^[a-f0-9]{8}$/.test(input.subjectHash))throw Error('guided-preview-public-trust-required');
  const root=new crypto.X509Certificate(input.root);
  if(!root.ca||!root.verify(root.publicKey))throw Error('guided-preview-public-trust-required');
  const name='guided-preview-'+sha(input.root)+'.pem',filename=path.join(directory,name);
  try{fs.writeFileSync(filename,input.root,{flag:'wx',mode:0o644});}
  catch(error){if(error.code!=='EEXIST'||!fs.lstatSync(filename).isFile()||fs.readFileSync(filename,'utf8')!==input.root)throw error;}
  let linked=false;
  for(let index=0;index<100;index++){
    const link=path.join(directory,input.subjectHash+'.'+index);
    try{fs.symlinkSync(name,link);linked=true;break;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      if(fs.lstatSync(link).isSymbolicLink()&&fs.readlinkSync(link)===name){linked=true;break;}
    }
  }
  if(!linked||!fs.readFileSync(publicFile).equals(before))throw Error('guided-preview-public-trust-required');
}
async function installTrust(candidate,dependencies={}){
  const execute=dependencies.node||node;
  const trust=await execute(candidate,function(input){
    const fs=require('fs'),crypto=require('crypto');
    const root=fs.readFileSync(input.root,'utf8');
    const certificate=new crypto.X509Certificate(root);
    if(!certificate.ca||!certificate.verify(certificate.publicKey))throw Error();
    const publicBundle=fs.readFileSync('/system/bootstrapper/ca/cacert-2026-10-20.crt','utf8');
    const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
    if(sha(publicBundle)!=='796f1389bfea13c0ed78f663b765baaff54a508e5483786bd6ece73c5e3e3cbe')throw Error();
    const bundle=publicBundle.trimEnd()+'\n'+root.trim()+'\n';
    if(sha(fs.readFileSync('/etc/ssl/certs/ca-certificates.crt'))!==sha(publicBundle))throw Error();
    return {root,bundle,rootSha256:sha(root),publicBundleSha256:sha(publicBundle)};
  },{root:ISSUANCE_CA});
  requireValue(typeof trust.root==='string'&&trust.root.startsWith('-----BEGIN CERTIFICATE-----')&&typeof trust.bundle==='string'&&
    /^[a-f0-9]{64}$/.test(trust.rootSha256||''),'guided-preview-public-trust-required');
  // The controller intentionally need not include the OpenSSL CLI. Use the
  // already declared GitLab image as a bounded offline certificate utility.
  const subjectHash=(await candidate.inner(['run','--rm','-i','--network','none','--memory','64m','--cpus','0.25',
    '--entrypoint','/opt/gitlab/embedded/bin/openssl','candidate-gitlab:under-test','x509','-subject_hash','-noout'],{input:trust.root,timeout:30000})).trim();
  requireValue(/^[a-f0-9]{8}$/.test(subjectHash),'guided-preview-public-trust-required');
  await execute(candidate,installAnchor,{root:trust.root,subjectHash,publicBundleSha256:trust.publicBundleSha256});
  // These files live only on the owned inner daemon. The job bind contains
  // public CA certificates; no platform TLS key or host configuration is shared.
  await candidate.call(['exec','-i',candidate.daemon,'sh','-ec',
    'mkdir -p /run/system-bootstrapper; umask 022; cat > "$1"; chmod 644 "$1"','sh',TRUST],{input:trust.bundle});
  await candidate.call(['exec','-i',candidate.daemon,'sh','-ec',
    'set -eu; before=$(sha256sum /etc/ssl/certs/ca-certificates.crt); mkdir -p /etc/docker/certs.d/registry.candidate.test:5050; umask 022; '+
    'cat > /etc/docker/certs.d/registry.candidate.test:5050/ca.crt; name=guided-preview-$1.pem; '+
    'cp /etc/docker/certs.d/registry.candidate.test:5050/ca.crt /etc/ssl/certs/"$name"; '+
    'index=0; while [ "$index" -lt 100 ]; do link=/etc/ssl/certs/$2.$index; '+
    'if [ ! -e "$link" ] && [ ! -L "$link" ]; then ln -s "$name" "$link"; break; fi; '+
    'if [ -L "$link" ] && [ "$(readlink "$link")" = "$name" ]; then break; fi; index=$((index+1)); done; '+
    '[ "$index" -lt 100 ]; [ "$before" = "$(sha256sum /etc/ssl/certs/ca-certificates.crt)" ]',
    'sh',trust.rootSha256,subjectHash],{input:trust.root});
  return {rootSha256:trust.rootSha256,publicBundleSha256:trust.publicBundleSha256};
}
async function restoreTrust(candidate,dependencies={}){
  requireValue(candidate.spec.guidedPreviewAcceptance===true,'guided-preview-owned-platform-required');
  return candidate.stage('guided-preview-restored-public-trust',()=>installTrust(candidate,dependencies));
}
async function bindingProof(candidate,dependencies={}){
  return (dependencies.node||node)(candidate,function(){
    const fs=require('fs'),crypto=require('crypto');
    const binding=require('/system/project-bootstrap/wizard-source-primary/binding');
    const source=require('/system/project-bootstrap/wizard-environments/source-primary');
    const state=require('/system/project-bootstrap/wizard-environments/state');
    const file='/state/.projects.env/.wizard.env',current=binding.read(file),receipt=current.receipt;
    if(!binding.primary(receipt))throw Error();binding.validate(receipt);
    const environment=receipt.wizardWorkflow?.environments;
    if(environment?.phase!=='ready'||environment.recipeHash!==source.reservation(environment).recipeHash)throw Error();
    for(const kind of ['review','beta']){
      const settings=environment.settings[kind],slot=environment.deployments?.[kind],stopped=slot?.tombstone;
      if(!settings?.enabled||slot.active||slot.pending||slot.retired?.length||stopped?.state!=='stopped'||
        stopped.projectId!==receipt.repository.id||stopped.operation!==environment.operation||stopped.kind!==kind||
        stopped.host!==settings.host||!Number.isSafeInteger(slot.lastPipelineId)||slot.lastPipelineId<stopped.pipelineId||
        !Number.isSafeInteger(slot.stoppedThroughPipelineId)||slot.stoppedThroughPipelineId<stopped.pipelineId)throw Error();
      state.validRequest(stopped);
    }
    const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
    if(fs.readFileSync(file,'utf8')!==current.text)throw Error();
    return {projectId:receipt.repository.id,operation:environment.operation,receiptSha256:sha(JSON.stringify(receipt)),settingsSha256:sha(JSON.stringify(environment.settings))};
  },{});
}
async function configureRunner(candidate){
  const runner='runner_docker_1';
  const before=await candidate.inner(['exec',runner,'cat','/etc/gitlab-runner/config.toml']);
  const after=runnerTrust(before);
  if(after!==before)await candidate.inner(['exec','-i',runner,'sh','-ec',
    'umask 077; cat > /etc/gitlab-runner/config.toml.guided-tmp; mv /etc/gitlab-runner/config.toml.guided-tmp /etc/gitlab-runner/config.toml'],{input:after});
  await candidate.inner(['exec',runner,'gitlab-runner','verify']);
  await candidate.rails("require 'json';r=Ci::Runner.instance_type.find_by!(description:'System Bootstrapper Docker pool');r.update!(tag_list:(r.tag_list+['wizard-source-primary']).uniq);puts JSON.generate(id:r.id,tags:r.tag_list)");
}
async function bootstrapTls(candidate,domains,execute){
  const key='/tmp/.guided-bootstrap-key',certificate='/tmp/.guided-bootstrap-certificate';
  let leaf,privateKey;
  try{
    await candidate.inner(['exec','system_gitlab_1','/opt/gitlab/embedded/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','2',
      '-subj','/CN=wizard.candidate.test','-addext','subjectAltName='+domains.map(host=>'DNS:'+host).join(','),'-keyout',key,'-out',certificate]);
    leaf=await candidate.inner(['exec','system_gitlab_1','cat',certificate]);privateKey=await candidate.inner(['exec','system_gitlab_1','cat',key]);
  }finally{await candidate.inner(['exec','system_gitlab_1','rm','-f',key,certificate]);}
  const settings={GITLAB_EXTERNAL_URL:'https://'+HOSTS.gitlab,GITLAB_DOMAIN_MODE:'2',GITLAB_SSL:LEAF,GITLAB_SSL_KEY:KEY,
    SYNC_DOMAIN_MODE:'2',SYNC_SSL:LEAF,SYNC_SSL_KEY:KEY,WIZARD_DOMAIN_MODE:'2',WIZARD_SSL:LEAF,WIZARD_SSL_KEY:KEY,
    WIZARD_ALIASES:recovery.WIZARD_ALIAS};
  await execute(candidate,function(input){
    const fs=require('fs'),path=require('path');
    const {signature}=require('/system/project-bootstrap/wizard-production/run');
    fs.mkdirSync(path.dirname(input.leaf),{recursive:true,mode:0o700});
    fs.writeFileSync(input.leaf,input.certificate+'\n',{mode:0o644});fs.writeFileSync(input.key,input.privateKey+'\n',{mode:0o600});
    let config=fs.readFileSync('/state/.docker.env','utf8');signature(config);
    for(const [name,value]of Object.entries(input.settings)){
      const expression=new RegExp('^(?:export )?'+name+'=.*$','m');
      const assignment='export '+name+"='"+String(value).replace(/'/g,"'\\''")+"'";
      config=expression.test(config)?config.replace(expression,()=>assignment):config+'\n'+assignment+'\n';
    }
    signature(config);fs.writeFileSync('/state/.docker.env',config,{mode:0o600});
  },{leaf:LEAF,key:KEY,certificate:leaf,privateKey,settings});
}
async function prepare(candidate,acme,dependencies={}){
  settings(candidate);
  requireValue(acme&&acme.original===candidate&&acme.ready===true,'guided-preview-existing-acme-authority-required');
  const execute=dependencies.node||node,probe=dependencies.tlsProbe||recovery.tlsProbe;
  const domains=issuanceDomains([HOSTS.gitlab,HOSTS.review,HOSTS.beta]);
  await candidate.stage('guided-preview-bootstrap-tls',()=>bootstrapTls(candidate,domains,execute));
  candidate.guidedAcmeIdentity=await acme.issue(candidate,{domains});
  await candidate.stage('guided-preview-public-trust',async()=>{
    candidate.guidedTrust=await installTrust(candidate,{node:execute});await configureRunner(candidate);
  });
  await candidate.stage('guided-preview-native-https-configuration',async()=>{
    await candidate.inner(['exec','-w','/system/gitlab','system_bootstrapper_1','bash','-e','start.sh'],{timeout:180000});
    await candidate.wait(async()=>{try{return (await candidate.inner(['exec','system_gitlab_1','curl','-fsS','--max-time','3','http://127.0.0.1/-/readiness'])).includes('ok');}catch{return false;}},600000);
    await candidate.inner(['exec','-w','/system/nginx','system_bootstrapper_1','bash','-e','start.sh','reload']);
    for(const [host,route]of [[HOSTS.gitlab,'/-/readiness'],[HOSTS.sync,'/'],[HOSTS.wizard,'/']]){
      await candidate.wait(async()=>{try{const result=await probe(candidate,host,route,{},{certificate:ISSUANCE_CA});return result.status===200||host===HOSTS.sync&&result.status===404;}catch{return false;}},60000);
    }
  });
  await candidate.stage('guided-preview-native-source-installation-record',()=>candidate.inner(['exec','system_bootstrapper_1','node',
    '/system/bootstrapper/record-source-installation.js','--controller',candidate.spec.images.candidate.id,'--wizard',candidate.spec.images.wizard.id,
    '--source-revision',candidate.spec.sourceRevision,'--source-tree',candidate.spec.sourceTree,'--wizard-revision',candidate.spec.wizardSourceRevision]));
  return {acmeIdentity:candidate.guidedAcmeIdentity,trust:candidate.guidedTrust,domains};
}
module.exports={prepare,restoreTrust,installTrust,installAnchor,bindingProof,runnerTrust,settings,node,HOSTS,LEAF,KEY,TRUST,JOB_TRUST};
