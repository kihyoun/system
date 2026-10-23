'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const jobDiagnostics = require('./job-diagnostics');
const stageDiagnostics = require('./stage-diagnostics');
const {configurationValues} = require('./literal-configuration');

const LABEL = 'com.system-bootstrapper.test-run';
const SIGNATURE = 'bd4a8426355824593a5e21ad759830c1';
function exitDetails(error) {
  return {
    ...(Number.isInteger(error.exitCode)&&error.exitCode>=0&&error.exitCode<=255?{exitCode:error.exitCode}:{}),
    ...(['ETIMEDOUT','ENOBUFS','ENOENT','EACCES'].includes(error.systemCode)?{systemCode:error.systemCode}:{})
  };
}
function signature(text) {
  if (text[807] !== '$' || crypto.createHash('md5').update(text.slice(0,1184)).digest('hex') !== SIGNATURE) {
    throw new Error('invalid-cube-signature');
  }
}
function configuration(example, secrets) {
  signature(example);
  const settings = {SEED_DIR:'/candidate-data/seed', GITLAB_INITIAL_ROOT_PASSWORD:secrets.root,
    GITLAB_EXTERNAL_URL:'http://gitlab.candidate.test', GITLAB_REGISTRY_URL:'http://registry.candidate.test',
    GITLAB_HOST:'gitlab.candidate.test', GITLAB_REGISTRY_HOST:'registry.candidate.test',
    GITLAB_RUNNER_TOKEN:'', GITLAB_RUNNER_SCALE:'1', SYNC_ENABLE:'true',
    SYNC_HOST:'sync.candidate.test', SYNC_USER:secrets.user, SYNC_PASS:secrets.password,
    WIZARD_ENABLE:'true', WIZARD_HOST:'wizard.candidate.test'};
  let result = example;
  for (const [key,value] of Object.entries(settings)) {
    const pattern = new RegExp('^((?:export )?'+key+'=).*$', 'm');
    if (!pattern.test(result)) throw new Error('missing-config-assignment');
    result = result.replace(pattern, (_,prefix)=>prefix+value);
  }
  signature(result);
  return result;
}
function docker(args, options={}) {
  let descriptor,outputDescriptor,result;
  try {
    if(options.inputFile) descriptor=fs.openSync(options.inputFile,'r');
    if(options.outputFile) outputDescriptor=fs.openSync(options.outputFile,'wx',0o600);
    result = spawnSync('docker', args, {encoding:'utf8', timeout:options.timeout || 120000,
      maxBuffer:1024*1024,input:options.input,windowsHide:true,
      ...(descriptor===undefined&&outputDescriptor===undefined?{}:{stdio:[descriptor??'pipe',outputDescriptor??'pipe','pipe']})});
  } finally {if(descriptor!==undefined)fs.closeSync(descriptor);if(outputDescriptor!==undefined)fs.closeSync(outputDescriptor);}
  // Docker output can contain credentials: never propagate its text into reports/errors.
  if (result.error || result.status !== 0) {
    // Preserve only operation/error codes, never potentially private output.
    let reason='docker-'+args[0]+'-failed';
    const lines=new Set(((result.stderr||'')+'\n'+(result.stdout||'')).split(/\r?\n/));
    for(const [message,code]of Object.entries(options.failureCodes||{})) {
      if(message.length>0&&message.length<=1024&&stageDiagnostics.failureReason(code)===code&&lines.has(message)) {
        reason=code;break;
      }
    }
    const error=new Error(reason);
    error.exitCode=result.status;error.systemCode=result.error?.code;
    throw error;
  }
  return (result.stdout||'').trim();
}
function syncDirectory(directory,io,platform) {
  // The actual candidate driver runs on Linux. Windows does not expose the
  // same directory-fsync contract through Node's filesystem API.
  if(platform!=='linux') return;
  const descriptor=io.openSync(directory,'r');
  try {io.fsyncSync(descriptor);} finally {io.closeSync(descriptor);}
}
function prepareReportDirectory(directory,io,platform) {
  io.mkdirSync(directory,{recursive:true,mode:0o700});
  if(platform!=='linux') return;
  // Include existing ancestors: a previous interrupted/failed checkpoint may
  // have created them without persisting their entries. mkdir's return value
  // alone cannot establish that an already-existing path is durable.
  for(let current=path.resolve(directory);;current=path.dirname(current)) {
    syncDirectory(current,io,platform);
    if(current===path.dirname(current)) break;
  }
}
function atomicReplace(filename,content,io=fs,platform=process.platform) {
  const temporary=path.join(path.dirname(filename),'.'+path.basename(filename)+'.'+crypto.randomBytes(12).toString('hex')+'.tmp');
  let descriptor;
  try {
    descriptor=io.openSync(temporary,'wx',0o600);
    io.writeFileSync(descriptor,content);
    io.fsyncSync(descriptor);
    io.closeSync(descriptor); descriptor=undefined;
    // Never truncate the previous recovery receipt. Both files are in the same
    // directory, so replacement is atomic; interrupted writes leave it intact.
    io.renameSync(temporary,filename);
    // File fsync alone does not make the renamed directory entry durable.
    // A failure here must abort the checkpoint before the next Docker action.
    syncDirectory(path.dirname(filename),io,platform);
  } finally {
    if(descriptor!==undefined) io.closeSync(descriptor);
    try {io.unlinkSync(temporary);} catch(error) {if(error.code!=='ENOENT') throw error;}
  }
}
class Candidate {
  constructor(spec, options={}) {
    signature(spec.example);
    if(spec.sourceRevision!==undefined&&!/^[a-f0-9]{40}$/.test(spec.sourceRevision))throw Error('invalid-candidate-source-revision');
    if(spec.readinessMilliseconds!==undefined && (!Number.isInteger(spec.readinessMilliseconds) || spec.readinessMilliseconds<1000 || spec.readinessMilliseconds>1200000)) throw new Error('invalid-readiness-budget');
    if (!/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(spec.daemonImage || '')) throw new Error('digest-pinned-daemon-required');
    const roles = ['candidate','wizard','gitlab','runner','nginx'];
    if (!spec.images || Object.keys(spec.images).sort().join() !== roles.sort().join()) throw new Error('five-image-roles-required');
    for (const image of Object.values(spec.images)) {
      if (!/^sha256:[a-f0-9]{64}$/.test(image.id || '') || !path.isAbsolute(image.archive || '')) throw new Error('invalid-image-input');
    }
    for(const [role,image] of Object.entries(spec.supportImages || {})) {
      if(!['helper','previousGitlab'].includes(role) || !/^sha256:[a-f0-9]{64}$/.test(image.id || '') || !path.isAbsolute(image.archive || '')) throw new Error('invalid-support-image');
    }
    this.spec=spec; this.exec=options.docker || docker;
    this.request=options.request || ((url,requestOptions)=>this.httpFromCandidate(url,requestOptions));
    this.sleep=options.sleep || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    this.now=options.now || Date.now;
    this.id=crypto.randomBytes(12).toString('hex'); this.name='system-candidate-'+this.id;
    this.resources=[]; this.canceled=false; this.startedAt=this.now();
    this.deadline=this.startedAt+(spec.gitlabUpgradeAcceptance===true?2400000:spec.acmeRenewalAcceptance===true?1500000:1200000);
    this.checkpoint=options.checkpoint || (()=>{});
    this.secrets={user:'test'+crypto.randomBytes(8).toString('hex'),
      password:crypto.randomBytes(24).toString('hex'),root:crypto.randomBytes(24).toString('hex')};
    this.results=[];
  }
  async call(args, options) {
    // Promise/microtask-only awaits do not deliver queued OS signal callbacks.
    // Yield to the event loop before EVERY bounded synchronous Docker operation.
    await new Promise(resolve=>setImmediate(resolve));
    if(this.canceled || this.now()>this.deadline) throw new Error('canceled-or-overall-timeout');
    return this.exec(args,{...options,timeout:Math.max(1,Math.min(options?.timeout || 120000,this.deadline-this.now()))});
  }
  inner(args, options) { return this.call(['exec','-i',this.daemon,'docker',...args],options); }
  async stage(name, action) {
    const start=this.now();
    try { const value=await action(); this.results.push({name,status:'passed',milliseconds:this.now()-start}); this.checkpoint(this); return value; }
    catch(error) { this.results.push({name,status:'failed',milliseconds:this.now()-start,reason:stageDiagnostics.failureReason(error.message),...exitDetails(error)}); this.checkpoint(this); throw error; }
  }
  async wait(check, milliseconds) {
    const until=this.now()+milliseconds;
    do { if(this.canceled || this.now()>this.deadline) throw new Error('canceled-or-overall-timeout'); try { if(await check()) return; } catch { /* bounded readiness retry */ }
      await this.sleep(1000);
    } while(this.now()<until);
    throw new Error('readiness-timeout');
  }
  async create(kind,args) {
    // Journal the unique intended name BEFORE creation: a Docker timeout may
    // occur after creation succeeds but before its ID reaches this process.
    const resource={kind,id:null,name:this.name};
    this.resources.push(resource); this.checkpoint(this);
    const id=await this.call(args);
    if(kind==='volume' ? id!==this.name : !/^[a-f0-9]{64}$/.test(id)) throw new Error('invalid-created-resource-id');
    resource.id=id; this.checkpoint(this); return id;
  }
  async start() {
    await this.stage('private-daemon',async()=>{
      const network=await this.create('network',['network','create','--internal','--label',LABEL+'='+this.id,this.name]);
      const volume=await this.create('volume',['volume','create','--label',LABEL+'='+this.id,this.name]);
      this.daemon=await this.create('container',['create','--name',this.name,'--label',LABEL+'='+this.id,
        '--privileged','--memory','12g','--cpus','4','--network',network,
        '--mount','type=volume,source='+volume+',target=/var/lib/docker',
        '--add-host','registry.candidate.test:127.0.0.1','--add-host','gitlab.candidate.test:127.0.0.1',
        '--env','DOCKER_TLS_CERTDIR=',this.spec.daemonImage,'dockerd','--host=unix:///var/run/docker.sock',
        '--insecure-registry','registry.candidate.test','--insecure-registry','registry.candidate.test:5050']);
      await this.call(['start',this.daemon]);
      await this.wait(async()=>{await this.inner(['info','--format','{{.ID}}']);return true;},90000);
      // All HTTP probes execute inside the owned daemon; publish no outer port.
      this.url='http://candidate.invalid';
    });
    await this.stage('candidate-images',async()=>{
      const tags={candidate:'system-candidate:under-test',wizard:'systembootstrapper/wizard',gitlab:'candidate-gitlab:under-test',runner:'candidate-runner:under-test',nginx:'nginx:latest',helper:'candidate-helper:under-test',previousGitlab:'candidate-gitlab:previous'};
      for (const [role,image] of Object.entries({...this.spec.images,...this.spec.supportImages})) {
        // Stream the explicit archive from an open descriptor. No buffering a
        // multi-gigabyte image in Node and no outer-host bind path assumptions.
        await this.inner(['load'],{inputFile:image.archive,timeout:600000});
        if(await this.inner(['image','inspect','--format','{{.Id}}',image.id])!==image.id) throw new Error('image-identity-mismatch');
        await this.inner(['tag',image.id,tags[role]]);
      }
      if(this.spec.gitlabUpgradeAcceptance===true){
        if(!this.spec.supportImages?.previousGitlab)throw Error('upgrade-previous-image-required');
        await this.inner(['tag',this.spec.images.gitlab.id,'candidate-gitlab:target']);
        await this.inner(['tag',this.spec.supportImages.previousGitlab.id,'candidate-gitlab:under-test']);
      }
    });
    await this.stage('bootstrap',async()=>{
      if(this.spec.restore)return require('../e2e/recovery').bootstrapRestore(this);
      const config=configuration(this.spec.example,this.secrets);
      // These paths live on the owned private daemon's writable layer, never
      // on the outer host. Compose service volumes resolve to the same paths.
      const base='/candidate-data/platform';
      const directories=['configuration','wizard-public','templates','synctemplates','ssl','runners','gitlab/config','gitlab/logs','gitlab/data','host/letsencrypt'];
      await this.call(['exec',this.daemon,'mkdir','-p','/candidate-data/seed',...directories.map(name=>base+'/'+name)]);
      const mounts={configuration:'configuration',wizardPublic:'wizard-public',templates:'templates',synctemplates:'synctemplates',ssl:'ssl',
        gitlabConfig:'gitlab/config',gitlabLogs:'gitlab/logs',gitlabData:'gitlab/data'};
      for(const [name,directory] of Object.entries(mounts)) {
        await this.inner(['volume','create','--driver','local','--opt','type=none','--opt','o=bind',
          '--opt','device='+base+'/'+directory,'system_'+name]);
      }
      const args=['create','--name','system_bootstrapper_1','--env','SEED_DIR=/candidate-data/seed',
        '--env','PERSISTENT_DIR='+base,'--env','SYSTEM_CONFIG_DIR=/state','--env','COMPOSE_COMPATIBILITY=1',
        '--env','GITLAB_IMAGE=candidate-gitlab:under-test','--env','GITLAB_RUNNER_IMAGE=candidate-runner:under-test',
        '--env','NGINX_IMAGE=nginx:latest','--env','WIZARD_IMAGE=systembootstrapper/wizard',
        '--env','GITLAB_SSH_BIND=2222','--env','GITLAB_REGISTRY_BIND=5050',
        '--volume','/var/run/docker.sock:/var/run/docker.sock',
        '--volume','/candidate-data/seed:/seed','--volume',base+'/runners:'+base+'/runners',
        '--volume',base+'/host/letsencrypt:/host-letsencrypt',
        '--volume','system_configuration:/state','--volume','system_wizardPublic:/wizard-public','--volume','system_templates:/templates',
        '--volume','system_synctemplates:/synctemplates','--volume','system_ssl:/ssl',
        '--volume','system_gitlabConfig:/srv/gitlab/config','--volume','system_gitlabLogs:/srv/gitlab/log',
        '--volume','system_gitlabData:/srv/gitlab/data'];
      await this.inner([...args,'system-candidate:under-test']);
      await this.call(['exec','-i',this.daemon,'sh','-c','umask 077; cat > /candidate-data/platform/configuration/.docker.env'],{input:config});
      await this.inner(['start','system_bootstrapper_1']);
    });
  }
  async smoke() {
    await this.stage('routed-wizard',()=>this.wait(async()=>{
      const response=await this.request(this.url+'/',{headers:{Host:'wizard.candidate.test'}});
      return response.status===200 && /<html/i.test(response.body);
    },this.spec.readinessMilliseconds || 1200000));
    await this.stage('authenticated-fetch',async()=>{
      let token;
      await this.wait(async()=>{
        const response=await this.request(this.url+'/login',{method:'POST',headers:{Host:'sync.candidate.test','Content-Type':'application/json'},
          body:JSON.stringify({username:this.secrets.user,password:this.secrets.password})});
        if(response.status!==200) return false;
        token=JSON.parse(response.body).accessToken;
        return typeof token==='string' && token.length>0;
      },this.spec.readinessMilliseconds || 1200000);
      const response=await this.request(this.url+'/config/main',{headers:{Host:'sync.candidate.test',Authorization:'Bearer '+token}});
      if(response.status!==200) throw new Error('fetch-failed');
      const config=JSON.parse(response.body).data;
      if(typeof config!=='string') throw new Error('missing-configuration');
      signature(config);
      const values=configurationValues(config,['SYNC_USER','SYNC_PASS']);
      if(values.SYNC_USER!==this.secrets.user || values.SYNC_PASS!==this.secrets.password) throw new Error('configuration-round-trip-mismatch');
    });
  }
  async rails(script) {
    const raw=await this.inner(['exec','-i','system_gitlab_1','gitlab-rails','runner','-'],{input:script,timeout:180000});
    try {return JSON.parse(raw.split('\n').at(-1));} catch {throw new Error('invalid-rails-result');}
  }
  async api(route,token,method='GET',payload) {
    const response=await this.request(this.url+'/api/v4'+route,{method,headers:{Host:'gitlab.candidate.test',
      'PRIVATE-TOKEN':token,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    if(response.status<200||response.status>=300) throw new Error('gitlab-api-request-failed');
    if(!response.body) return null;
    try {return JSON.parse(response.body);} catch {return response.body;}
  }
  async platform() {
    if(!this.spec.supportImages?.helper) throw new Error('runner-helper-image-required');
    await this.stage('gitlab-and-runner-ready',async()=>{
      await this.wait(async()=>{
        const response=await this.request(this.url+'/users/sign_in',{headers:{Host:'gitlab.candidate.test'}});
        if(response.status!==200) return false;
        await this.inner(['exec','system_gitlab_1','curl','-fsS','--max-time','3','http://127.0.0.1/-/readiness']);
        await this.inner(['exec','runner_docker_1','gitlab-runner','verify']);return true;
      },this.spec.readinessMilliseconds||600000);
    });
    let token;
    try {
      await this.stage('runner-registration-idempotent',async()=>{
        const before=await this.rails("require 'json'; u=User.find_by_username('root'); t=u.personal_access_tokens.create!(name: 'disposable-candidate-acceptance',scopes:['api'],expires_at:Date.tomorrow); puts JSON.generate(token:t.token,pools:Ci::Runner.instance_type.where(description:'System Bootstrapper Docker pool').count,active_setup:u.personal_access_tokens.where(name:'system-bootstrapper-runner-setup',revoked:false).count)");
        token=before.token;
        if(before.pools!==1||before.active_setup!==0) throw new Error('runner-setup-state-mismatch');
        await this.inner(['exec','-w','/system/gitlab-runner','system_bootstrapper_1','bash','register.sh','main'],{timeout:180000});
        const after=await this.rails("require 'json'; puts JSON.generate(pools:Ci::Runner.instance_type.where(description:'System Bootstrapper Docker pool').count,active_setup:User.find_by_username('root').personal_access_tokens.where(name:'system-bootstrapper-runner-setup',revoked:false).count)");
        if(after.pools!==1||after.active_setup!==0) throw new Error('runner-idempotency-failed');
        const script='('+function(base){
          const fs=require('fs');const p=base+'/runners/runner/1/config/config.toml';
          let t=fs.readFileSync(p,'utf8');
          if((t.match(/\[runners\.docker\]\r?\n/g)||[]).length!==1)throw Error('candidate-runner-docker-section-required');
          t=t.replace(/(\[runners\.docker\]\r?\n)/,'$1    helper_image = "candidate-helper:under-test"\n    pull_policy = "if-not-present"\n    allowed_pull_policies = ["never", "if-not-present"]\n');
          fs.writeFileSync(p,t,{mode:0o600});
        }.toString()+')('+JSON.stringify(this.spec.restore?.base||'/candidate-data/platform')+')';
        await this.inner(['exec','system_bootstrapper_1','node','-e',script]);
        await this.inner(['exec','runner_docker_1','sh','-c','grep -F \'allowed_pull_policies = ["never", "if-not-present"]\' /etc/gitlab-runner/config.toml >/dev/null && grep -F \'helper_image = "candidate-helper:under-test"\' /etc/gitlab-runner/config.toml >/dev/null']);
        await this.sleep(4000);
        await this.inner(['exec','runner_docker_1','gitlab-runner','verify']);
      });
      let project,branch;
      await this.stage('registry-build-push-pull-run',async()=>{
        project=await this.api('/projects',token,'POST',{name:'candidate-acceptance-'+this.id.slice(0,8),path:'candidate-acceptance-'+this.id.slice(0,8),visibility:'private',initialize_with_readme:true});
        if(!Number.isInteger(project.id)) throw new Error('invalid-created-project');
        branch=project.default_branch||'main';
        const content=`stages: [verify, deliver]
registry-round-trip:
  stage: verify
  image:
    name: system-candidate:under-test
    pull_policy: never
  tags: [docker]
  script:
    - echo 'FROM system-candidate:under-test' > Dockerfile
    - echo 'RUN printf candidate-registry-ok > /candidate-proof' >> Dockerfile
    - docker build --network none --provenance=false --sbom=false -t "$CI_REGISTRY_IMAGE/probe:$CI_COMMIT_SHA" .
    - printf '%s' "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" --username "$CI_REGISTRY_USER" --password-stdin
    - docker push "$CI_REGISTRY_IMAGE/probe:$CI_COMMIT_SHA"
    - docker image rm "$CI_REGISTRY_IMAGE/probe:$CI_COMMIT_SHA"
    - docker pull "$CI_REGISTRY_IMAGE/probe:$CI_COMMIT_SHA"
    - docker run --rm --network none "$CI_REGISTRY_IMAGE/probe:$CI_COMMIT_SHA" node -e "if(require('fs').readFileSync('/candidate-proof','utf8')!=='candidate-registry-ok')process.exit(1)"
    - printf candidate-registry-ok > proof.txt
  artifacts:
    paths: [proof.txt]
delivery-gate:
  stage: deliver
  image:
    name: system-candidate:under-test
    pull_policy: never
  tags: [docker]
  script: ["test -s proof.txt"]
`;
        await this.api('/projects/'+project.id+'/repository/files/.gitlab-ci.yml',token,'POST',{branch,content,commit_message:'Exercise candidate registry and delivery gate'});
        let pipeline;
        await this.wait(async()=>{
          const runs=await this.api('/projects/'+project.id+'/pipelines',token);
          if(!runs.length)return false;pipeline=runs[0];
          return ['failed','canceled','skipped','success'].includes(pipeline.status);
        },300000);
        const jobs=await this.api('/projects/'+project.id+'/pipelines/'+pipeline.id+'/jobs',token);
        this.evidence={projectId:project.id,pipelineId:pipeline.id,pipelineStatus:pipeline.status,jobs:jobs.map(job=>({id:job.id,name:job.name,status:job.status,failureReason:job.failure_reason,runnerId:job.runner?.id,duration:job.duration,queuedSeconds:job.queued_duration,startedAt:job.started_at,finishedAt:job.finished_at}))};
        if(pipeline.status!=='success') {
          for(const job of jobs.filter(item=>item.status==='failed')) {
            let diagnostics;
            try {diagnostics=jobDiagnostics.classify(await this.api('/projects/'+project.id+'/jobs/'+job.id+'/trace',token));}
            catch {diagnostics={codes:['trace-unavailable']};}
            this.evidence.jobs.find(item=>item.id===job.id).diagnostics=diagnostics;
          }
          throw new Error('candidate-pipeline-failed');
        }
        if(jobs.length!==2||jobs.some(job=>job.status!=='success'||!job.runner?.id))throw new Error('candidate-jobs-not-successful');
        const proof=jobs.find(job=>job.name==='registry-round-trip');
        const artifact=await this.api('/projects/'+project.id+'/jobs/'+proof.id+'/artifacts/proof.txt',token);
        if(artifact!=='candidate-registry-ok')throw new Error('candidate-artifact-mismatch');
        this.evidence={projectId:project.id,pipelineId:pipeline.id,jobs:jobs.map(job=>({id:job.id,name:job.name,status:job.status,runnerId:job.runner.id,duration:job.duration,queuedSeconds:job.queued_duration,startedAt:job.started_at,finishedAt:job.finished_at}))};
      });
      await this.stage('deliberate-failure-blocks-delivery',async()=>{
        const content=`stages: [verify, deliver]
deliberate-failure:
  stage: verify
  image: {name: system-candidate:under-test, pull_policy: never}
  tags: [docker]
  script: ["exit 37"]
delivery-must-not-run:
  stage: deliver
  image: {name: system-candidate:under-test, pull_policy: never}
  tags: [docker]
  script: ["exit 0"]
`;
        await this.api('/projects/'+project.id+'/repository/files/.gitlab-ci.yml',token,'PUT',{branch,content,commit_message:'Verify deliberate failure blocks downstream delivery'});
        const commit=await this.api('/projects/'+project.id+'/repository/files/.gitlab-ci.yml?ref='+branch,token);
        let pipeline;
        await this.wait(async()=>{
          const runs=await this.api('/projects/'+project.id+'/pipelines',token);
          pipeline=runs.find(run=>run.sha===commit.last_commit_id);
          if(!pipeline)return false;
          return ['failed','success','canceled','skipped'].includes(pipeline.status);
        },180000);
        if(pipeline.status!=='failed')throw new Error('deliberate-failure-did-not-fail');
        const jobs=await this.api('/projects/'+project.id+'/pipelines/'+pipeline.id+'/jobs',token);
        if(jobs.find(job=>job.name==='deliberate-failure')?.status!=='failed' || jobs.find(job=>job.name==='delivery-must-not-run')?.status!=='skipped') throw new Error('downstream-delivery-was-not-blocked');
        this.evidence.failurePipelineId=pipeline.id;
      });
      await this.stage('temporary-credential-revoked',async()=>{
        await this.api('/personal_access_tokens/self',token,'DELETE');
        const response=await this.request(this.url+'/api/v4/user',{headers:{Host:'gitlab.candidate.test','PRIVATE-TOKEN':token}});
        if(response.status!==401)throw new Error('temporary-credential-still-active');
        token=undefined;
      });
      if(!this.spec.recoveryAcceptance) await this.stage('seed-cycle',async()=>{
        // Cleanly stop the private services before taking a filesystem seed.
        await this.inner(['exec','-w','/system/gitlab-runner','system_bootstrapper_1','bash','stop.sh']);
        await this.inner(['stop','system_gitlab_1'],{timeout:120000});
        await this.inner(['exec','system_bootstrapper_1','sh','-c','printf candidate-seed-proof > /srv/gitlab/config/.candidate-proof']);
        await this.inner(['exec','-w','/system/system','system_bootstrapper_1','bash','harvest.sh'],{timeout:120000});
        await this.inner(['exec','system_bootstrapper_1','sh','-c','rm /srv/gitlab/config/.candidate-proof']);
        await this.inner(['exec','-w','/system/system','system_bootstrapper_1','bash','seed.sh'],{timeout:120000});
        const proof=await this.inner(['exec','system_bootstrapper_1','cat','/srv/gitlab/config/.candidate-proof']);
        if(proof!=='candidate-seed-proof')throw new Error('seed-restore-mismatch');
      });
    } finally {
      if(token) await this.stage('temporary-credential-revoked',async()=>{
        // Revocation is tested before GitLab stops for the seed cycle when possible.
        try {await this.api('/personal_access_tokens/self',token,'DELETE');}
        catch {await this.rails("User.find_by_username('root').personal_access_tokens.where(name:'disposable-candidate-acceptance',revoked:false).find_each(&:revoke!); puts '{}'");}
      });
    }
  }
  async httpFromCandidate(url,options={}) {
    // The CI driver may itself be a container using an outer Docker socket.
    // Its loopback is not the daemon host's loopback. Probe from the private
    // bootstrapper instead, through that daemon's bridge gateway/host NGINX.
    const networks=JSON.parse(await this.inner(['inspect','--format','{{json .NetworkSettings.Networks}}','system_bootstrapper_1']));
    const gateway=networks.bridge?.Gateway;
    if(!/^\d+\.\d+\.\d+\.\d+$/.test(gateway)) throw new Error('missing-private-gateway');
    const input={url:'http://'+gateway+new URL(url).pathname+new URL(url).search,options};
    const script='('+function(){
      const http=require('http');let input='';
      process.stdin.on('data',chunk=>input+=chunk);
      process.stdin.on('end',()=>{
        try {
          const {url,options}=JSON.parse(input);
          const request=http.request(url,{method:options.method||'GET',headers:options.headers,
            signal:AbortSignal.timeout(10000)},response=>{
            const chunks=[];let size=0;
            response.on('data',chunk=>{size+=chunk.length;if(size>524288)request.destroy();else chunks.push(chunk);});
            response.on('error',()=>{process.exitCode=1;});
            response.on('end',()=>{if(size<=524288)process.stdout.write(JSON.stringify({status:response.statusCode,body:Buffer.concat(chunks).toString('utf8')}));else process.exitCode=1;});
          });
          request.on('error',()=>{process.exitCode=1;});request.end(options.body);
        } catch {process.exitCode=1;}
      });
    }.toString()+')()';
    return JSON.parse(await this.inner(['exec','-i','system_bootstrapper_1','node','-e',script],{input:JSON.stringify(input),timeout:20000}));
  }
  cleanup() {
    const failures=[];
    for(const resource of [...this.resources].reverse()) {
      try {
        // Listing distinguishes confirmed absence from a broken/unreachable daemon.
        const listed=this.exec([resource.kind,'ls',...(resource.kind==='container'?['--all']:[]),'--format','{{json .}}'],{timeout:10000});
        const entries=listed.split('\n').filter(Boolean).map(line=>JSON.parse(line));
        const found=entries.some(item=>resource.id ? (resource.kind==='volume' ? item.Name===resource.id :
          typeof item.ID==='string' && resource.id.startsWith(item.ID)) :
          (item.Name===resource.name || item.Names===resource.name));
        if(!found) continue;
        const item=JSON.parse(this.exec([resource.kind,'inspect',resource.id || resource.name],{timeout:10000}))[0];
        const provenId=resource.kind==='volume' ? item?.Name : item?.Id;
        if(!item || (resource.id && provenId!==resource.id) ||
          (resource.kind==='container' ? item.Name!=='/'+this.name : item.Name!==this.name) ||
          (item.Labels || item.Config?.Labels || {})[LABEL]!==this.id) throw new Error('foreign-resource');
        if(resource.kind!=='volume' && !/^[a-f0-9]{64}$/.test(provenId)) throw new Error('invalid-resource-id');
        resource.id=provenId;
        this.exec([resource.kind,'rm',...(resource.kind==='container'?['--force']:[]),provenId],{timeout:30000});
      } catch {
        failures.push({kind:resource.kind,status:'failed'});
        // Do not tear down dependencies while the owned daemon may still run.
        if(resource.kind==='container') break;
      }
    }
    this.results.push({name:'cleanup',status:failures.length?'failed':'passed',failures});
    return failures.length===0;
  }
  report(directory,io=fs,platform=process.platform) {
    prepareReportDirectory(directory,io,platform);
    const safe={runId:this.id,startedAt:this.startedAt===undefined?undefined:new Date(this.startedAt).toISOString(),results:this.results,resources:this.resources,
      images:this.spec?.images ? Object.fromEntries(Object.entries(this.spec.images).map(([role,image])=>[role,image.id])) : undefined,
      daemonImage:this.spec?.daemonImage,sourceRevision:this.spec?.sourceRevision,evidence:this.evidence,fullAcceptance:this.spec?.fullAcceptance===true,
      acceptance:this.spec?.fullAcceptance===true?'explicit-private-platform-scenarios; see individual stage outcomes':'lifecycle-and-http-smoke-only'};
    atomicReplace(path.join(directory,'results.json'),JSON.stringify(safe,null,2),io,platform);
    atomicReplace(path.join(directory,'junit.xml'),'<?xml version="1.0"?><testsuite name="disposable-candidate" tests="'+this.results.length+'" failures="'+this.results.filter(x=>x.status==='failed').length+'">'+this.results.map(x=>'<testcase name="'+x.name+'">'+(x.status==='failed'?'<failure message="stage failed; inspect sanitized JSON"/>':'')+'</testcase>').join('')+'</testsuite>',io,platform);
  }
}
function recover(report,exec=docker) {
  if(!/^[a-f0-9]{24}$/.test(report.runId || '') || !Array.isArray(report.resources) || report.resources.length>3) throw new Error('invalid-recovery-receipt');
  const name='system-candidate-'+report.runId;
  const seen=new Set();
  for(const item of report.resources) {
    if(!['network','volume','container'].includes(item.kind) || seen.has(item.kind) || item.name!==name ||
      (item.id!==null && (item.kind==='volume' ? item.id!==name : !/^[a-f0-9]{64}$/.test(item.id || '')))) throw new Error('invalid-recovery-resource');
    seen.add(item.kind);
  }
  const instance=Object.create(Candidate.prototype);
  const results=(Array.isArray(report.results)?report.results:[]).filter(item=>
    /^[a-z][a-z0-9-]{0,80}$/.test(item.name||'') && ['passed','failed'].includes(item.status))
    .map(item=>({name:item.name,status:item.status,
      ...(Number.isFinite(item.milliseconds)&&item.milliseconds>=0?{milliseconds:item.milliseconds}:{}),
      ...(item.status==='failed'&&item.reason!==undefined?{reason:stageDiagnostics.failureReason(item.reason)}:{}),
      ...(item.status==='failed'?exitDetails(item):{})}));
  const images=Object.fromEntries(Object.entries(report.images||{}).filter(([role,id])=>
    ['candidate','wizard','gitlab','runner','nginx'].includes(role)&&/^sha256:[a-f0-9]{64}$/.test(id)).map(([role,id])=>[role,{id}]));
  const evidence={};
  for(const key of ['projectId','pipelineId','failurePipelineId']) if(Number.isInteger(report.evidence?.[key])&&report.evidence[key]>0)evidence[key]=report.evidence[key];
  if(Array.isArray(report.evidence?.jobs)) evidence.jobs=report.evidence.jobs.filter(job=>
    Number.isInteger(job.id)&&['registry-round-trip','delivery-gate'].includes(job.name)&&['success','failed','skipped'].includes(job.status)).map(job=>({id:job.id,name:job.name,status:job.status,
      ...(Number.isInteger(job.runnerId)?{runnerId:job.runnerId}:{}),
      ...(jobDiagnostics.failureReason(job.failureReason)?{failureReason:jobDiagnostics.failureReason(job.failureReason)}:{}),
      ...(Number.isFinite(job.duration)?{duration:job.duration}:{}),
      ...(Number.isFinite(job.queuedSeconds)?{queuedSeconds:job.queuedSeconds}:{}),
      ...(jobDiagnostics.sanitize(job.diagnostics)?{diagnostics:jobDiagnostics.sanitize(job.diagnostics)}:{})}));
  if(report.evidence?.recovery && /^[a-f0-9]{24}$/.test(report.evidence.recovery.runId||'')) {
    const recovery={runId:report.evidence.recovery.runId};
    for(const key of ['backupOnly','originalHostRemoved','syntheticTlsVerified','acmeRenewalVerified','privateWizardPinVerified','mergeRequestRecoveryVerified'])if(typeof report.evidence.recovery[key]==='boolean')recovery[key]=report.evidence.recovery[key];
    evidence.recovery=recovery;
  }
  if(report.evidence?.gitlabUpgrade){const clean=require('../e2e/gitlab-upgrade').sanitizeEvidence(report.evidence.gitlabUpgrade);if(clean)evidence.gitlabUpgrade=clean;}
  Object.assign(instance,{id:report.runId,name,resources:report.resources,results,exec,
    startedAt:typeof report.startedAt==='string'&&Number.isFinite(Date.parse(report.startedAt))?Date.parse(report.startedAt):undefined,
    evidence:Object.keys(evidence).length?evidence:undefined,
    spec:{images,sourceRevision:/^[a-f0-9]{40}$/.test(report.sourceRevision||'')?report.sourceRevision:undefined,daemonImage:/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(report.daemonImage||'')?report.daemonImage:undefined,fullAcceptance:report.fullAcceptance===true}});
  return instance;
}
module.exports={Candidate,configuration,signature,configurationValues,recover,atomicReplace,LABEL};
