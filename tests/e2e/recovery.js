'use strict';
// Backup-only integration adapter. Every path below belongs to an owned DinD
// daemon or a private temporary driver directory; Production is never an input.
const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');
const {signature}=require('../shared/disposable-candidate');
const BASE='/recovered-data/platform';
const SEED='/recovered-data/seed';
const LEAF='/ssl/live/recovery-fixture/fullchain.pem';
const KEY='/ssl/live/recovery-fixture/privkey.pem';
const PRIVATE_MARKER='/opt/system-bootstrapper/private-recovery-proof';
function privateWizardDescriptor(value,spec) {
  if(!value||!Number.isInteger(value.projectId)||value.projectId<1||!/^[-a-z0-9_/]+\/wizard$/.test(value.projectPath||'')||
    !/^sha256:[a-f0-9]{64}$/.test(value.imageDigest||'')||!/^sha256:[a-f0-9]{64}$/.test(value.imageId||'')||
    value.sourceImageId!==spec.images?.wizard?.id||Object.values(spec.images||{}).some(image=>image.id===value.imageId)||
    value.imageRef!=='registry.candidate.test:5050/'+value.projectPath+'/recovery-wizard@'+value.imageDigest||
    !/^[a-f0-9]{24}$/.test(value.marker||'')||value.markerPath!==PRIVATE_MARKER||
    !Number.isInteger(value.pipelineId)||value.pipelineId<1||!Number.isInteger(value.jobId)||value.jobId<1)throw Error('private-wizard-recovery-descriptor-invalid');
  return value;
}
function hashFile(filename) {
  const descriptor=fs.openSync(filename,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);
  try {let count;while((count=fs.readSync(descriptor,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,count));}
  finally {fs.closeSync(descriptor);}
  return hash.digest('hex');
}

function exporter(spec) {
  const item=spec.configurationExporter;
  if(!item || !path.isAbsolute(item.archive||'') || !/^[a-f0-9]{64}$/.test(item.sha256||'')) throw Error('configuration-exporter-required');
  const stat=fs.lstatSync(item.archive);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>50000000 || hashFile(item.archive)!==item.sha256) throw Error('configuration-exporter-identity-mismatch');
  return item.archive;
}
function updateConfiguration(config, settings) {
  const preserve=new Set(['GITLAB_IMAGE','GITLAB_RUNNER_IMAGE','BOOTSTRAPPER_IMAGE','WIZARD_IMAGE','NGINX_IMAGE','GITLAB_SSH_BIND','GITLAB_REGISTRY_BIND']);
  const quote=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
  for(const [name,value]of Object.entries(settings)) {
    const expression=new RegExp('^(?:export )?'+name+'=.*$','m');
    if(preserve.has(name)&&expression.test(config))continue;
    const assignment='export '+name+'='+quote(value);
    config=expression.test(config)?config.replace(expression,()=>assignment):config+'\n'+assignment+'\n';
  }
  return config;
}
async function node(candidate, action, input, options={}) {
  return candidate.inner(['exec','-i','system_bootstrapper_1','node','-e',
    "let text='';process.stdin.on('data',x=>text+=x);process.stdin.on('end',async()=>{try{const input=JSON.parse(text);const updateConfiguration=("+updateConfiguration.toString()+");await ("+action.toString()+")(input);}catch{process.exitCode=1;}});"],
  {...options,input:JSON.stringify(input)});
}
async function syncFetch(candidate) {
  const login=await candidate.request(candidate.url+'/login',{method:'POST',headers:{Host:'sync.candidate.test','Content-Type':'application/json'},
    body:JSON.stringify({username:candidate.secrets.user,password:candidate.secrets.password})});
  if(login.status!==200) throw Error('recovery-sync-login-failed');
  const token=JSON.parse(login.body).accessToken;
  const headers={Host:'sync.candidate.test',Authorization:'Bearer '+token};
  const main=await candidate.request(candidate.url+'/config/main',{headers});
  const projects=await candidate.request(candidate.url+'/config/projects',{headers});
  if(main.status!==200 || projects.status!==200) throw Error('recovery-fetch-failed');
  const result={main:JSON.parse(main.body),projects:JSON.parse(projects.body)};
  signature(result.main.data);
  if(!Array.isArray(result.projects)||!result.projects.some(project=>project.filename==='.wizard.env')) throw Error('recovery-project-export-missing');
  return result;
}
async function transferToController(candidate, source, destination) {
  await candidate.inner(['exec','-i','system_bootstrapper_1','sh','-c','umask 077; cat > "$1"','sh',destination],{inputFile:source});
}
async function fromController(candidate, source, target) {
  await candidate.inner(['exec','system_bootstrapper_1','cat',source],{outputFile:target});
  fs.chmodSync(target,0o600);
}
async function rootToken(candidate) {
  const result=await candidate.rails("require 'json'; u=User.find_by_username('root'); t=u.personal_access_tokens.create!(name:'disposable-backup-recovery',scopes:['api'],expires_at:Date.tomorrow); puts JSON.generate(token:t.token,root_id:u.id)");
  if(typeof result.token!=='string'||!Number.isInteger(result.root_id)) throw Error('recovery-test-credential-failed');
  return result;
}
async function revoke(candidate,token) {
  try {await candidate.api('/personal_access_tokens/self',token,'DELETE');}
  catch {await candidate.rails("User.find_by_username('root').personal_access_tokens.where(name:'disposable-backup-recovery',revoked:false).find_each(&:revoke!); puts '{}'");}
}
async function capture(original,dependencies={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'system-recovery-'));
  fs.chmodSync(directory,0o700);
  const inputs={directory,configArchive:path.join(directory,'bootstrapper.zip'),seedArchive:path.join(directory,'seed.tgz'),base:BASE,seed:SEED};
  try {
    await original.stage('recovery-record-service-identity',async()=>{
      const auth=await rootToken(original);
      try {
        const projectId=original.evidence?.projectId;
        if(!Number.isInteger(projectId))throw Error('successful-original-project-required');
        const project=await original.api('/projects/'+projectId,auth.token);
        const branch=await original.api('/projects/'+projectId+'/repository/branches/'+encodeURIComponent(project.default_branch),auth.token);
        const pipeline=await original.api('/projects/'+projectId+'/pipelines/'+original.evidence.pipelineId,auth.token);
        const nonce=crypto.randomBytes(24).toString('hex');
        const issue=await original.api('/projects/'+projectId+'/issues',auth.token,'POST',{title:'Backup-only recovery proof',description:nonce});
        await original.api('/projects/'+projectId+'/variables',auth.token,'POST',{key:'RECOVERY_ENCRYPTED_PROOF',value:nonce,masked:true});
        const user=await original.api('/users',auth.token,'POST',{username:'recovery_'+original.id.slice(0,8),name:'Recovery fixture',email:'recovery-'+original.id+'@example.invalid',password:crypto.randomBytes(24).toString('hex'),skip_confirmation:true});
        const repositories=await original.api('/projects/'+projectId+'/registry/repositories',auth.token);
        const registry=repositories.find(item=>item.path.endsWith('/probe'));
        if(!registry || pipeline.status!=='success')throw Error('original-registry-proof-required');
        const tag=await original.api('/registry/repositories/'+registry.id+'/tags/'+pipeline.sha,auth.token);
        inputs.expected={rootId:auth.root_id,projectId,path:project.path_with_namespace,branch:project.default_branch,head:branch.commit.id,
          issueIid:issue.iid,nonce,userId:user.id,userName:user.username,registryId:registry.id,registryDigest:tag.digest,imageCommit:pipeline.sha};
      } finally {await revoke(original,auth.token);}
    });
    if(original.spec.privateWizardRecovery)await original.stage('recovery-publish-uncached-private-wizard',async()=>{
      const publish=dependencies.publishWizard||require('./wizard-pin-fixture').publish;
      inputs.expected.privateWizard=privateWizardDescriptor(await publish(original),original.spec);
    });
    await original.stage('recovery-backup-wizard-configuration',async()=>{
      // Generate a real test certificate, then place its deploy/renewal state in
      // the declared persistent sources before Harvest. This is not ACME proof.
      await original.inner(['exec','system_gitlab_1','/opt/gitlab/embedded/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','2',
        '-subj','/CN=wizard.candidate.test','-addext','subjectAltName=DNS:wizard.candidate.test,DNS:sync.candidate.test',
        '-keyout','/seed/.recovery-fixture-key','-out','/seed/.recovery-fixture-cert']);
      const settings={GITLAB_IMAGE:'candidate-gitlab:under-test',GITLAB_RUNNER_IMAGE:'candidate-runner:under-test',
        BOOTSTRAPPER_IMAGE:'system-candidate:under-test',WIZARD_IMAGE:'systembootstrapper/wizard',NGINX_IMAGE:'nginx:latest',
        GITLAB_SSH_BIND:'2222',GITLAB_REGISTRY_BIND:'5050',SYNC_DOMAIN_MODE:'2',WIZARD_DOMAIN_MODE:'2',
        SYNC_SSL:LEAF,SYNC_SSL_KEY:KEY,WIZARD_SSL:LEAF,WIZARD_SSL_KEY:KEY,RECOVERY_RUNTIME_PROOF:'literal=one=two $HOME'};
      await node(original,function(input){
        const fs=require('fs'),path=require('path');
        const leaf=fs.readFileSync('/seed/.recovery-fixture-cert'),key=fs.readFileSync('/seed/.recovery-fixture-key');
        fs.mkdirSync('/ssl/live/recovery-fixture',{recursive:true,mode:0o700});
        fs.writeFileSync('/ssl/live/recovery-fixture/fullchain.pem',leaf,{mode:0o644});
        fs.writeFileSync('/ssl/live/recovery-fixture/privkey.pem',key,{mode:0o600});
        const state='/host-letsencrypt';
        for(const name of ['archive/recovery-fixture','live/recovery-fixture','accounts/fixture','renewal'])fs.mkdirSync(path.join(state,name),{recursive:true,mode:0o700});
        fs.writeFileSync(state+'/archive/recovery-fixture/fullchain1.pem',leaf);
        fs.writeFileSync(state+'/archive/recovery-fixture/privkey1.pem',key,{mode:0o600});
        fs.symlinkSync('../../archive/recovery-fixture/fullchain1.pem',state+'/live/recovery-fixture/fullchain.pem');
        fs.symlinkSync('../../archive/recovery-fixture/privkey1.pem',state+'/live/recovery-fixture/privkey.pem');
        fs.writeFileSync(state+'/accounts/fixture/account.json',JSON.stringify({testOnly:true,identity:input.identity}),{mode:0o600});
        fs.writeFileSync(state+'/renewal/recovery-fixture.conf','[renewalparams]\nauthenticator = webroot\nwebroot_path = /candidate-data/platform/ssl/acme-http01,\n[[webroot_map]]\nwizard.candidate.test = /candidate-data/platform/ssl/acme-http01\n');
        let config=updateConfiguration(fs.readFileSync('/state/.docker.env','utf8'),input.settings);
        if(input.privateWizard){
          // Deliberately promote this scenario's actual CI-published artifact
          // before the real Wizard backup; restore must retain this exact pin.
          const assignment="export WIZARD_IMAGE='"+input.privateWizard+"'";
          const expression=/^(?:export )?WIZARD_IMAGE=.*$/m;
          config=expression.test(config)?config.replace(expression,()=>assignment):config+'\n'+assignment+'\n';
        }
        fs.writeFileSync('/state/.docker.env',config,{mode:0o600});
      },{settings,identity:original.id,privateWizard:inputs.expected.privateWizard?.imageRef});
      inputs.expected.certificateHash=await node(original,function(){process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync('/ssl/live/recovery-fixture/fullchain.pem')).digest('hex'));},{});
      inputs.expected.accountIdentity=original.id;
      const fetched=await syncFetch(original);
      await node(original,function(input){require('fs').writeFileSync('/tmp/recovery-fetch.json',JSON.stringify(input),{mode:0o600});},fetched);
      await transferToController(original,exporter(original.spec),'/tmp/export-configuration.cjs');
      await original.inner(['exec','system_bootstrapper_1','node','/tmp/export-configuration.cjs','/tmp/recovery-fetch.json','/tmp/bootstrapper.zip']);
      await fromController(original,'/tmp/bootstrapper.zip',inputs.configArchive);
    });
    await original.stage('recovery-completed-cold-seed',async()=>{
      await original.inner(['exec','-w','/system/gitlab-runner','system_bootstrapper_1','bash','stop.sh']);
      await original.inner(['exec','-w','/system/system','system_bootstrapper_1','bash','harvest.sh'],{timeout:180000});
      const current=await original.inner(['exec','system_bootstrapper_1','node','/system/system/seed-manifest.js','current','/seed']);
      if(!/^\/seed\/snapshots\/[A-Za-z0-9.-]+$/.test(current))throw Error('completed-snapshot-required');
      await original.call(['exec',original.daemon,'tar','-czf','-','-C','/candidate-data/seed','current',current.slice('/seed/'.length)],{outputFile:inputs.seedArchive,timeout:180000});
      fs.chmodSync(inputs.seedArchive,0o600);
      inputs.configHash=hashFile(inputs.configArchive);
      inputs.seedHash=hashFile(inputs.seedArchive);
    });
    return inputs;
  } catch(error) {fs.rmSync(directory,{recursive:true,force:true});throw error;}
}

async function bootstrapRestore(candidate,dependencies={}) {
  const input=candidate.spec.restore;
  if(input.base!==BASE || input.seed!==SEED || input.configHash!==hashFile(input.configArchive) || input.seedHash!==hashFile(input.seedArchive))throw Error('recovery-input-identity-mismatch');
  const privateWizard=input.expected?.privateWizard;
  if(!!candidate.spec.privateWizardRecovery!==!!privateWizard)throw Error('private-wizard-recovery-scenario-mismatch');
  if(privateWizard)privateWizardDescriptor(privateWizard,candidate.spec);
  const directories=['configuration','templates','synctemplates','ssl','runners','gitlab/config','gitlab/logs','gitlab/data','host/letsencrypt'];
  await candidate.call(['exec',candidate.daemon,'mkdir','-p',SEED,...directories.map(name=>BASE+'/'+name)]);
  const mounts={configuration:'configuration',templates:'templates',synctemplates:'synctemplates',ssl:'ssl',gitlabConfig:'gitlab/config',gitlabLogs:'gitlab/logs',gitlabData:'gitlab/data'};
  for(const [name,directory]of Object.entries(mounts))await candidate.inner(['volume','create','--driver','local','--opt','type=none','--opt','o=bind','--opt','device='+BASE+'/'+directory,'system_'+name]);
  const args=['create','--name','system_bootstrapper_1','--env','SEED_DIR='+SEED,'--env','PERSISTENT_DIR='+BASE,'--env','SYSTEM_CONFIG_DIR=/state','--env','COMPOSE_COMPATIBILITY=1',
    '--env','GITLAB_IMAGE=candidate-gitlab:under-test','--env','GITLAB_RUNNER_IMAGE=candidate-runner:under-test','--env','NGINX_IMAGE=nginx:latest','--env','WIZARD_IMAGE=systembootstrapper/wizard',
    '--env','GITLAB_SSH_BIND=2222','--env','GITLAB_REGISTRY_BIND=5050','--volume','/var/run/docker.sock:/var/run/docker.sock',
    '--volume',SEED+':/seed','--volume',BASE+'/runners:'+BASE+'/runners','--volume',BASE+'/host/letsencrypt:/host-letsencrypt',
    '--volume','system_configuration:/state','--volume','system_templates:/templates','--volume','system_synctemplates:/synctemplates','--volume','system_ssl:/ssl',
    '--volume','system_gitlabConfig:/srv/gitlab/config','--volume','system_gitlabLogs:/srv/gitlab/log','--volume','system_gitlabData:/srv/gitlab/data'];
  await candidate.inner([...args,'--entrypoint','/bin/sh','system-candidate:under-test','-c','sleep infinity']);
  await candidate.inner(['start','system_bootstrapper_1']);
  await transferToController(candidate,input.configArchive,'/system/bootstrapper.zip');
  await candidate.inner(['exec','-w','/system/system','system_bootstrapper_1','bash','push.sh']);
  const wizardImage=await candidate.inner(['exec','system_bootstrapper_1','bash','-c','source /state/.docker.env; printf "%s" "${WIZARD_IMAGE:-systembootstrapper/wizard}"']);
  if(wizardImage!==(privateWizard?.imageRef||'systembootstrapper/wizard'))throw Error('wizard-pin-recovery-artifact-not-declared');
  if(privateWizard)for(const identity of [privateWizard.imageRef,privateWizard.imageId]){
    let present=false;try{await candidate.inner(['image','inspect',identity]);present=true;}catch{/* the new private layer must genuinely be absent */}
    if(present)throw Error('private-wizard-recovery-image-already-cached');
  }
  // Rebind the one declared host-specific setting; preserve every Cube byte and
  // every unrelated value. Runners/routing/source are never copied from old live data.
  await node(candidate,function(input){
    const fs=require('fs'),crypto=require('crypto');const name='/state/.docker.env';let config=fs.readFileSync(name,'utf8');
    if(config[807]!=='$'||crypto.createHash('md5').update(config.slice(0,1184)).digest('hex')!=='bd4a8426355824593a5e21ad759830c1')throw Error();
    if(!/^(?:export )?SEED_DIR=.*$/m.test(config))throw Error();
    config=config.replace(/^(?:export )?SEED_DIR=.*$/m,"export SEED_DIR='"+input.seed+"'");
    fs.writeFileSync(name,config,{mode:0o600});
  },{seed:SEED});
  await candidate.call(['exec','-i',candidate.daemon,'tar','-xzf','-','-C',SEED],{inputFile:input.seedArchive,timeout:180000});
  await candidate.inner(['exec','-w','/system/system','system_bootstrapper_1','bash','seed.sh'],{timeout:180000});
  // Execute the actual fresh-source host rewriter, using the already declared
  // GitLab image's embedded Python; never install/download an undeclared tool.
  const rewriter=dependencies.rewriter || fs.readFileSync(path.join(__dirname,'../../bootstrapper/rebind-renewal.py'),'utf8');
  await candidate.inner(['run','--rm','-i','--network','none','--entrypoint','/opt/gitlab/embedded/bin/python3','--volume',BASE+'/host/letsencrypt:/renewal-state',
    'candidate-gitlab:under-test','-','/renewal-state/renewal',BASE+'/ssl/acme-http01'],{input:rewriter});
  await candidate.inner(['rm','--force','system_bootstrapper_1']);
  await candidate.inner([...args,'system-candidate:under-test']);
  await candidate.inner(['start','system_bootstrapper_1']);
}

async function tlsProbe(candidate,host,route,options={},connection={}) {
  const networks=JSON.parse(await candidate.inner(['inspect','--format','{{json .NetworkSettings.Networks}}','system_bootstrapper_1']));
  const gateway=networks.bridge?.Gateway;
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(gateway))throw Error('missing-private-gateway');
  const raw=await node(candidate,async function(input){
    const https=require('https'),fs=require('fs');
    const response=await new Promise((resolve,reject)=>{
      const request=https.request({hostname:input.host,servername:input.host,port:input.port,path:input.route,
        lookup:(_host,options,done)=>options.all?done(null,[{address:input.gateway,family:4}]):done(null,input.gateway,4),ca:fs.readFileSync(input.certificate),rejectUnauthorized:true,
        method:input.options.method||'GET',headers:input.options.headers||{},timeout:10000},response=>{
        const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>524288){request.destroy();reject(Error());}else chunks.push(chunk);});
        response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
      });
      request.on('error',reject);request.on('timeout',()=>request.destroy(Error()));
      request.end(input.options.body);
    });
    process.stdout.write(JSON.stringify(response));
  },{host,gateway,route,options,certificate:connection.certificate||LEAF,port:connection.port||443},{timeout:20000});
  return JSON.parse(raw);
}
async function verifyRestore(candidate,input) {
  await candidate.stage('recovery-synthetic-tls-and-config',async()=>{
    await candidate.wait(async()=>{
      const page=await tlsProbe(candidate,'wizard.candidate.test','/');
      return page.status===200&&/<html/i.test(page.body);
    },candidate.spec.readinessMilliseconds||600000);
    const login=await tlsProbe(candidate,'sync.candidate.test','/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:candidate.secrets.user,password:candidate.secrets.password})});
    if(login.status!==200)throw Error('restored-sync-credentials-failed');
    const response=await tlsProbe(candidate,'sync.candidate.test','/config/main',{headers:{Authorization:'Bearer '+JSON.parse(login.body).accessToken}});
    if(response.status!==200)throw Error('restored-configuration-fetch-failed');
    const config=JSON.parse(response.body).data;signature(config);
    if(!config.includes("export SEED_DIR='"+SEED+"'") || !config.includes('RECOVERY_RUNTIME_PROOF='))throw Error('restored-runtime-configuration-mismatch');
    const proof=JSON.parse(await node(candidate,function(){
      const fs=require('fs'),crypto=require('crypto');
      process.stdout.write(JSON.stringify({certificate:crypto.createHash('sha256').update(fs.readFileSync('/ssl/live/recovery-fixture/fullchain.pem')).digest('hex'),
        account:JSON.parse(fs.readFileSync('/host-letsencrypt/accounts/fixture/account.json','utf8')).identity,
        renewal:fs.readFileSync('/host-letsencrypt/renewal/recovery-fixture.conf','utf8'),
        oldLivePresent:fs.existsSync('/candidate-data/platform')}));
    },{}));
    if(proof.certificate!==input.expected.certificateHash || proof.account!==input.expected.accountIdentity || proof.oldLivePresent ||
      !proof.renewal.includes(BASE+'/ssl/acme-http01') || proof.renewal.includes('/candidate-data/platform'))throw Error('restored-renewal-path-or-identity-mismatch');
  });
  if(input.expected.privateWizard)await verifyPrivateWizard(candidate,input.expected.privateWizard);
  await candidate.stage('recovery-gitlab-data-identity',async()=>{
    await candidate.wait(async()=>{await candidate.inner(['exec','system_gitlab_1','curl','-fsS','--max-time','3','http://127.0.0.1/-/readiness']);return true;},candidate.spec.readinessMilliseconds||600000);
    const auth=await rootToken(candidate);
    try {
      const expected=input.expected;
      const project=await candidate.api('/projects/'+expected.projectId,auth.token);
      const branch=await candidate.api('/projects/'+expected.projectId+'/repository/branches/'+encodeURIComponent(expected.branch),auth.token);
      const issue=await candidate.api('/projects/'+expected.projectId+'/issues/'+expected.issueIid,auth.token);
      const variable=await candidate.api('/projects/'+expected.projectId+'/variables/RECOVERY_ENCRYPTED_PROOF',auth.token);
      const user=await candidate.api('/users/'+expected.userId,auth.token);
      const tag=await candidate.api('/registry/repositories/'+expected.registryId+'/tags/'+expected.imageCommit,auth.token);
      if(auth.root_id!==expected.rootId || project.path_with_namespace!==expected.path || branch.commit.id!==expected.head || issue.description!==expected.nonce ||
        variable.value!==expected.nonce || user.username!==expected.userName || tag.digest!==expected.registryDigest)throw Error('restored-service-identity-mismatch');
    } finally {await revoke(candidate,auth.token);}
  });
}
async function verifyPrivateWizard(candidate,expected){
  await candidate.stage('recovery-private-wizard-image-and-credential-cleanup',async()=>{
    const identity=await candidate.inner(['inspect','--format','{{.Image}}','system_wizard_1']);
    const marker=await candidate.inner(['exec','system_wizard_1','cat',PRIVATE_MARKER]);
    const cleanup=await candidate.rails("require 'json';p=Project.find("+expected.projectId+");raise unless p.full_path=="+JSON.stringify(expected.projectPath)+";puts JSON.generate(active:p.deploy_tokens.where(name:'system-bootstrapper-wizard-image-recovery',revoked:false).count)");
    if(identity!==expected.imageId||marker!==expected.marker||cleanup.active!==0)throw Error('private-wizard-restoration-or-credential-cleanup-failed');
    candidate.privateWizardPinVerified=true;
  });
}
async function verifyRegistryBlob(candidate,input) {
  await candidate.stage('recovery-original-registry-blob-ci',async()=>{
    const auth=await rootToken(candidate);
    try {
      const expected=input.expected;
      const content=`stages: [verify]\nrestored-registry-blob:\n  stage: verify\n  image: {name: system-candidate:under-test, pull_policy: never}\n  tags: [docker]\n  script:\n    - printf '%s' "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" --username "$CI_REGISTRY_USER" --password-stdin\n    - docker pull "$CI_REGISTRY_IMAGE/probe:${expected.imageCommit}"\n    - docker run --rm --network none "$CI_REGISTRY_IMAGE/probe:${expected.imageCommit}" node -e "if(require('fs').readFileSync('/candidate-proof','utf8')!=='candidate-registry-ok')process.exit(1)"\n`;
      await candidate.api('/projects/'+expected.projectId+'/repository/files/.gitlab-ci.yml',auth.token,'PUT',{branch:expected.branch,content,commit_message:'Verify restored original registry blob'});
      const commit=await candidate.api('/projects/'+expected.projectId+'/repository/files/.gitlab-ci.yml?ref='+encodeURIComponent(expected.branch),auth.token);
      let pipeline;
      await candidate.wait(async()=>{const runs=await candidate.api('/projects/'+expected.projectId+'/pipelines',auth.token);pipeline=runs.find(run=>run.sha===commit.last_commit_id);return pipeline&&['success','failed','skipped','canceled'].includes(pipeline.status);},180000);
      if(pipeline.status!=='success')throw Error('restored-registry-ci-failed');
      const jobs=await candidate.api('/projects/'+expected.projectId+'/pipelines/'+pipeline.id+'/jobs',auth.token);
      if(jobs.length!==1||jobs[0].status!=='success'||!jobs[0].runner?.id)throw Error('restored-registry-job-not-successful');
      candidate.evidence.recovery={originalProjectId:expected.projectId,originalRegistryPreserved:true,pipelineId:pipeline.id,jobId:jobs[0].id,syntheticTlsVerified:true,acmeRenewalVerified:false,privateWizardPinVerified:candidate.privateWizardPinVerified===true};
    } finally {await revoke(candidate,auth.token);}
  });
}
async function run(original,reportDirectory,dependencies={}) {
  const input=await (dependencies.capture || capture)(original);
  let second;
  try {
    await original.stage('recovery-original-host-removed',async()=>{if(!original.cleanup())throw Error('original-host-cleanup-failed');});
    const Candidate=dependencies.Candidate || require('../shared/disposable-candidate').Candidate;
    second=new Candidate({...original.spec,recoveryAcceptance:true,restore:input},{checkpoint:instance=>instance.report(reportDirectory(instance))});
    second.deadline=original.deadline;
    let canceled=false;
    Object.defineProperty(second,'canceled',{configurable:true,get:()=>canceled||original.canceled,set:value=>{canceled=value;}});
    // Expected credentials are test oracles, never recovery input. Bootstrap
    // installs only the actual exported ZIP and completed Seed into the new host.
    second.secrets={...original.secrets};
    second.report(reportDirectory(second));
    await second.start();
    await (dependencies.verifyRestore || verifyRestore)(second,input);
    await second.platform();
    await (dependencies.verifyRegistryBlob || verifyRegistryBlob)(second,input);
    original.evidence.recovery={runId:second.id,backupOnly:true,originalHostRemoved:true,syntheticTlsVerified:true,acmeRenewalVerified:false,privateWizardPinVerified:second.privateWizardPinVerified===true};
  } finally {
    let clean=true;
    if(second){clean=second.cleanup();second.report(reportDirectory(second));}
    if(clean)fs.rmSync(input.directory,{recursive:true,force:true});
    if(!clean)throw Error('restored-host-cleanup-failed');
  }
}
module.exports={capture,bootstrapRestore,verifyRestore,verifyPrivateWizard,verifyRegistryBlob,run,exporter,tlsProbe,hashFile,updateConfiguration,privateWizardDescriptor,BASE,SEED};
