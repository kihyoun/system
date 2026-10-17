'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawnSync} = require('child_process');

const LABEL = 'com.system-bootstrapper.test-run';
const SIGNATURE = 'bd4a8426355824593a5e21ad759830c1';
function signature(text) {
  if (text[807] !== '$' || crypto.createHash('md5').update(text.slice(0,1184)).digest('hex') !== SIGNATURE) {
    throw new Error('invalid-cube-signature');
  }
}
function configuration(example, secrets) {
  signature(example);
  const settings = {SEED_DIR:'/seed', GITLAB_INITIAL_ROOT_PASSWORD:secrets.root,
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
  const result = spawnSync('docker', args, {encoding:'utf8', timeout:options.timeout || 120000,
    maxBuffer:1024*1024, input:options.input, windowsHide:true});
  // Docker output can contain credentials: never propagate its text into reports/errors.
  if (result.error || result.status !== 0) throw new Error('docker-command-failed');
  return result.stdout.trim();
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
    if(spec.readinessMilliseconds!==undefined && (!Number.isInteger(spec.readinessMilliseconds) || spec.readinessMilliseconds<1000 || spec.readinessMilliseconds>1200000)) throw new Error('invalid-readiness-budget');
    if (!/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(spec.daemonImage || '')) throw new Error('digest-pinned-daemon-required');
    const roles = ['candidate','wizard','gitlab','runner','nginx'];
    if (!spec.images || Object.keys(spec.images).sort().join() !== roles.sort().join()) throw new Error('five-image-roles-required');
    for (const image of Object.values(spec.images)) {
      if (!/^sha256:[a-f0-9]{64}$/.test(image.id || '') || !path.isAbsolute(image.archive || '')) throw new Error('invalid-image-input');
    }
    this.spec=spec; this.exec=options.docker || docker;
    this.request=options.request || ((url,requestOptions)=>this.httpFromCandidate(url,requestOptions));
    this.sleep=options.sleep || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    this.now=options.now || Date.now;
    this.id=crypto.randomBytes(12).toString('hex'); this.name='system-candidate-'+this.id;
    this.resources=[]; this.canceled=false; this.deadline=this.now()+3600000;
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
    return this.exec(args,options);
  }
  inner(args, options) { return this.call(['exec','-i',this.daemon,'docker',...args],options); }
  async stage(name, action) {
    const start=this.now();
    try { const value=await action(); this.results.push({name,status:'passed',milliseconds:this.now()-start}); return value; }
    catch(error) { this.results.push({name,status:'failed',milliseconds:this.now()-start}); throw error; }
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
        '--privileged','--memory','12g','--cpus','4','--network',network,'--publish','127.0.0.1::80',
        '--mount','type=volume,source='+volume+',target=/var/lib/docker',
        '--env','DOCKER_TLS_CERTDIR=',this.spec.daemonImage,'dockerd','--host=unix:///var/run/docker.sock']);
      await this.call(['start',this.daemon]);
      await this.wait(async()=>{await this.inner(['info','--format','{{.ID}}']);return true;},90000);
      const ports=JSON.parse(await this.call(['inspect','--format','{{json .NetworkSettings.Ports}}',this.daemon]));
      const binding=ports['80/tcp'];
      if (!binding || binding.length!==1 || binding[0].HostIp!=='127.0.0.1' || !/^\d+$/.test(binding[0].HostPort)) throw new Error('invalid-loopback-binding');
      this.url='http://127.0.0.1:'+binding[0].HostPort;
    });
    await this.stage('candidate-images',async()=>{
      const tags={candidate:'system-candidate:under-test',wizard:'systembootstrapper/wizard',gitlab:'candidate-gitlab:under-test',runner:'candidate-runner:under-test',nginx:'nginx:latest'};
      for (const [role,image] of Object.entries(this.spec.images)) {
        await this.call(['cp',image.archive,this.daemon+':/tmp/'+role+'.tar'],{timeout:600000});
        await this.inner(['load','--input','/tmp/'+role+'.tar'],{timeout:600000});
        if(await this.inner(['image','inspect','--format','{{.Id}}',image.id])!==image.id) throw new Error('image-identity-mismatch');
        await this.inner(['tag',image.id,tags[role]]);
        await this.call(['exec',this.daemon,'rm','-f','/tmp/'+role+'.tar']);
      }
    });
    await this.stage('bootstrap',async()=>{
      const config=configuration(this.spec.example,this.secrets);
      const mounts=['templates:/templates','synctemplates:/synctemplates','ssl:/ssl',
        'gitlabConfig:/srv/gitlab/config','gitlabLogs:/srv/gitlab/log','gitlabData:/srv/gitlab/data'];
      const args=['create','--name','system_bootstrapper_1','--env','SEED_DIR=/seed','--env','COMPOSE_COMPATIBILITY=1',
        '--env','GITLAB_IMAGE=candidate-gitlab:under-test','--env','GITLAB_RUNNER_IMAGE=candidate-runner:under-test',
        '--env','GITLAB_SSH_BIND=2222','--env','GITLAB_REGISTRY_BIND=5050',
        '--volume','/var/run/docker.sock:/var/run/docker.sock','--volume','system_seed:/seed'];
      for (const mount of mounts) args.push('--volume','system_'+mount);
      await this.inner([...args,'system-candidate:under-test']);
      // stdin avoids host bind paths and writes credentials only inside the private daemon.
      await this.call(['exec','-i',this.daemon,'sh','-c','umask 077; cat > /tmp/candidate.env'],{input:config});
      await this.inner(['cp','/tmp/candidate.env','system_bootstrapper_1:/system/system/.docker.env']);
      await this.call(['exec',this.daemon,'rm','-f','/tmp/candidate.env']);
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
      if(!config.includes('SYNC_USER='+this.secrets.user) || !config.includes('SYNC_PASS='+this.secrets.password)) throw new Error('configuration-round-trip-mismatch');
    });
  }
  async httpFromCandidate(url,options={}) {
    // The CI driver may itself be a container using an outer Docker socket.
    // Its loopback is not the daemon host's loopback. Probe from the private
    // bootstrapper instead, through that daemon's bridge gateway/host NGINX.
    const gateway=await this.inner(['inspect','--format','{{.NetworkSettings.Gateway}}','system_bootstrapper_1']);
    if(!/^\d+\.\d+\.\d+\.\d+$/.test(gateway)) throw new Error('missing-private-gateway');
    const input={url:'http://'+gateway+new URL(url).pathname,options};
    const script="let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',async()=>{try{const {url,options}=JSON.parse(input);const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});const chunks=[];let size=0;for await(const x of r.body){size+=x.length;if(size>524288)throw Error();chunks.push(Buffer.from(x));}process.stdout.write(JSON.stringify({status:r.status,body:Buffer.concat(chunks).toString('utf8')}));}catch{process.exitCode=1;}});";
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
    const safe={runId:this.id,results:this.results,resources:this.resources,
      images:this.spec?.images ? Object.fromEntries(Object.entries(this.spec.images).map(([role,image])=>[role,image.id])) : undefined,
      daemonImage:this.spec?.daemonImage,
      acceptance:'lifecycle-and-http-smoke-only; registry/runner/seed/CI acceptance pending'};
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
  const names=['private-daemon','candidate-images','bootstrap','routed-wizard','authenticated-fetch','cleanup'];
  const results=(Array.isArray(report.results)?report.results:[]).filter(item=>names.includes(item.name) && ['passed','failed'].includes(item.status))
    .map(item=>({name:item.name,status:item.status}));
  Object.assign(instance,{id:report.runId,name,resources:report.resources,results,exec});
  return instance;
}
module.exports={Candidate,configuration,signature,recover,atomicReplace,LABEL};
