#!/usr/bin/env node
'use strict';
// A deliberately approved, same-minor CE transition. Run from the tested System
// controller, detached from GitLab CI: promotion stops its own GitLab server.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const release=require('./security-release.json');
const ROOT=path.resolve(__dirname,'..');
const childJournal=require('./upgrade-child');
const QUIESCE_SCRIPT='read -r uptime rest </proc/uptime; remaining=$(($1 - ${uptime%%.*})); if [ "$remaining" -le 0 ] || [ "$remaining" -gt 110 ]; then exit 124; fi; timeout -k 2 "$remaining" gitlab-ctl stop';
const SCHEDULING_QUIESCE_SCRIPT='for service in nginx gitlab-workhorse puma; do read -r uptime rest </proc/uptime; remaining=$(($1 - ${uptime%%.*})); if [ "$remaining" -le 0 ] || [ "$remaining" -gt 110 ]; then exit 124; fi; timeout -k 2 "$remaining" gitlab-ctl stop "$service"; state=$(/opt/gitlab/embedded/bin/sv status "/opt/gitlab/service/$service"); case "$state" in down:*) ;; *) exit 1 ;; esac; done';
const INPUT_JSON_MAX_BYTES=4*1024*1024;
// Checkpoint inventories grow with retained files; options/evidence keep their
// smaller budget. Both checkpoint publication and reading use this same ceiling.
const CHECKPOINT_JSON_MAX_BYTES=64*1024*1024;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const cube=text=>{if(text[807]!=='$'||crypto.createHash('md5').update(text.slice(0,1184)).digest('hex')!=='bd4a8426355824593a5e21ad759830c1')throw Error('upgrade-cube-invalid');};
function regular(filename){const s=fs.lstatSync(filename);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0)throw Error('upgrade-private-regular-file-required');return filename;}
function jsonBytes(filename,maximum=INPUT_JSON_MAX_BYTES,tooLarge='upgrade-input-too-large'){
  regular(filename);const descriptor=fs.openSync(filename,'r');
  try{
    const metadata=fs.fstatSync(descriptor);
    if(!metadata.isFile()||(metadata.mode&0o077)!==0)throw Error('upgrade-private-regular-file-required');
    if(metadata.size>maximum)throw Error(tooLarge);
    // A fixed-size read also bounds allocation if the file grows after fstat.
    const bytes=Buffer.alloc(metadata.size+1);let length=0,count;
    while(length<bytes.length&&(count=fs.readSync(descriptor,bytes,length,bytes.length-length,null)))length+=count;
    if(length>metadata.size)throw Error(tooLarge);
    return bytes.subarray(0,length);
  }finally{fs.closeSync(descriptor);}
}
function json(filename){return JSON.parse(jsonBytes(filename).toString('utf8'));}
function atomic(filename,value){const tmp=filename+'.'+crypto.randomBytes(8).toString('hex');let fd;try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,value);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,filename);fd=fs.openSync(path.dirname(filename),'r');fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
function run(binary,args,options={}){const r=spawnSync(binary,args,{encoding:'utf8',timeout:options.timeout||180000,maxBuffer:8*1024*1024,input:options.input,cwd:options.cwd,env:options.env,detached:options.detached});if(r.error||r.status!==0)throw Error('upgrade-operation-failed');return (r.stdout||'').trim();}
function imageAssignment(text,image,aliases={}){cube(text);if(![release.fromImage,release.toImage,...Object.values(aliases)].includes(image))throw Error('upgrade-image-not-approved');const re=/^(?:export )?GITLAB_IMAGE=.*$/gm;const matches=[...text.matchAll(re)];if(matches.length>1)throw Error('upgrade-duplicate-image-assignment');const line="export GITLAB_IMAGE='"+image+"'";const result=matches.length?text.replace(re,()=>line):text.replace(/\n?$/,'\n')+line+'\n';cube(result);return result;}
function durableDirectory(directory){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function durableAncestors(directory){for(let current=path.resolve(directory);;current=path.dirname(current)){durableDirectory(current);if(current===path.dirname(current))break;}}
function inventoryAt(roots,ignore=new Set()){
  const entries=[];
  function visit(full,relative){
    if(ignore.has(relative))return;
    const s=fs.lstatSync(full),e={path:relative,mode:s.mode&0o7777,uid:s.uid,gid:s.gid};
    if(s.isSymbolicLink()){e.type='link';e.target=fs.readlinkSync(full);}
    else if(s.isDirectory())e.type='directory';
    else if(s.isFile()){
      e.type='file';e.size=s.size;const h=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024),fd=fs.openSync(full,'r');
      try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))h.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}e.sha256=h.digest('hex');
    }else throw Error('upgrade-checkpoint-entry-invalid');
    entries.push(e);if(s.isDirectory())for(const name of fs.readdirSync(full).sort())visit(path.join(full,name),path.posix.join(relative,name));
  }
  for(const root of roots)visit(root.full,root.path);return entries;
}
function inventory(directory){return inventoryAt(['gitlab','configuration'].map(name=>({full:path.join(directory,name),path:name})));}

function options(value){if(!value||Object.keys(value).some(k=>!['sourceRevision','evidence','stateDir','persistentDir','checkpointDir','readyTimeoutSeconds'].includes(k))||!/^[a-f0-9]{40}$/.test(value.sourceRevision||''))throw Error('upgrade-options-invalid');for(const key of ['evidence','stateDir','persistentDir','checkpointDir'])if(!path.isAbsolute(value[key]||'')||path.resolve(value[key])!==value[key])throw Error('upgrade-options-invalid');if(value.stateDir!=='/state'||!value.checkpointDir.startsWith('/state/gitlab-upgrades/'))throw Error('upgrade-state-boundary-invalid');if(!Number.isInteger(value.readyTimeoutSeconds)||value.readyTimeoutSeconds<60||value.readyTimeoutSeconds>1800)throw Error('upgrade-readiness-budget-invalid');return value;}
class Upgrade {
  constructor(input,dependencies={}){this.options=options(input);this.run=dependencies.run||((binary,args,opts)=>this.ownedRun(binary,args,opts));this.sleep=dependencies.sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));this.now=dependencies.now||Date.now;this.serviceData=dependencies.serviceData||'/srv/gitlab';this.seed=dependencies.seed||'/seed';this.certbot=dependencies.certbot||'/host-letsencrypt';this.imageIds=dependencies.imageIds;this.aliases=dependencies.aliases||{};this.state=input.stateDir;this.config=path.join(this.state,'.docker.env');this.checkpoints=input.checkpointDir;}
  ownedRun(binary,args,opts={}){if(!this.owner)return run(binary,args,opts);const timeout=opts.timeout||180000;return run(process.execPath,[path.join(__dirname,'upgrade-child.js'),'watchdog',path.join(this.state,'.gitlab-upgrade-lock')],{timeout:timeout+5000,detached:true,input:JSON.stringify({binary,args,timeout,cwd:opts.cwd,env:opts.env,input:opts.input})});}
  docker(args,opts){return this.run('docker',args,opts);}
  inspect(name){return JSON.parse(this.docker(['inspect',name]))[0];}
  image(reference){const prepared=this.imageIds?.[reference];const image=JSON.parse(this.docker(['image','inspect',prepared||reference]))[0];if(prepared){if(image.Id!==prepared)throw Error('upgrade-image-pin-mismatch');return prepared;}if(!/^sha256:[a-f0-9]{64}$/.test(image.Id||'')||!image.RepoDigests?.some(ref=>ref.split('@')[1]===reference.split('@')[1]))throw Error('upgrade-image-pin-mismatch');return image.Id;}
  configuration(){regular(this.config);const text=fs.readFileSync(this.config,'utf8');cube(text);return text;}
  verifyMounts(container){for(const [target,suffix,volume] of [['/etc/gitlab','gitlab/config','system_gitlabConfig'],['/var/log/gitlab','gitlab/logs','system_gitlabLogs'],['/var/opt/gitlab','gitlab/data','system_gitlabData']]){const mount=container.Mounts?.find(m=>m.Destination===target),expected=path.posix.join(this.options.persistentDir,suffix);if(!mount||mount.RW!==true)throw Error('upgrade-persistent-mount-mismatch');if(mount.Type==='volume'){const v=JSON.parse(this.docker(['volume','inspect',mount.Name]))[0];if(mount.Name!==volume||v.Options?.device!==expected||v.Options?.type!=='none'||v.Options?.o!=='bind')throw Error('upgrade-persistent-mount-mismatch');}else if(mount.Type!=='bind'||mount.Source!==expected)throw Error('upgrade-persistent-mount-mismatch');}if(container.Config?.Labels?.['com.docker.compose.project']!=='system'||container.Config.Labels['com.docker.compose.service']!=='gitlab')throw Error('upgrade-owned-gitlab-required');}
  async preflight(version){const gitlab=this.inspect('system_gitlab_1');this.verifyMounts(gitlab);if(!gitlab.State?.Running||gitlab.State?.OOMKilled)throw Error('upgrade-running-gitlab-required');const raw=this.docker(['exec','-i','system_gitlab_1','gitlab-rails','runner','-'],{input:fs.readFileSync(path.join(__dirname,'upgrade-preflight.rb'),'utf8')});const proof=JSON.parse(raw.split('\n').at(-1));if(proof.version!==version||proof.edition!=='CE'||!Number.isInteger(proof.runningJobs)||proof.runningJobs<0||proof.unfinishedBackgroundMigrations!==0)throw Error('upgrade-preflight-refused');if(proof.runningJobs!==0)throw Error('upgrade-jobs-active');return gitlab;}
  evidence(){const bytes=jsonBytes(this.options.evidence),value=JSON.parse(bytes.toString('utf8')),p=value.evidence?.gitlabUpgrade;if(value.sourceRevision!==this.options.sourceRevision||!Array.isArray(value.results)||!value.results.length||value.results.some(r=>r.status!=='passed')||value.fullAcceptance!==true||p?.fromImage!==release.fromImage||p?.toImage!==release.toImage||p.migrationVerified!==true||p.rollbackVerified!==true||p.registryVerified!==true||p.checkpointVerified!==true||!/^sha256:[a-f0-9]{64}$/.test(value.images?.candidate||'')||(value.images.gitlab!==this.image(release.toImage)||p.toImageId!==value.images.gitlab||p.fromImageId!==this.image(release.fromImage)))throw Error('upgrade-passing-successor-evidence-required');for(const stage of ['gitlab-upgrade-migrated-data','gitlab-upgrade-registry-ci','gitlab-upgrade-restored-checkpoint'])if(!value.results.some(r=>r.name===stage&&r.status==='passed'))throw Error('upgrade-passing-successor-evidence-required');if(this.inspect('system_bootstrapper_1').Image!==value.images.candidate)throw Error('upgrade-tested-controller-required');return {sha256:hash(bytes),candidateImage:value.images.candidate};}
  async plan(){const evidence=this.evidence(),old=this.image(release.fromImage),target=this.image(release.toImage),current=await this.preflight(release.fromVersion);if(current.Image!==old)throw Error('upgrade-current-image-mismatch');const value={format:'system-gitlab-upgrade-plan-v1',sourceRevision:this.options.sourceRevision,releaseSha256:hash(fs.readFileSync(path.join(__dirname,'security-release.json'))),evidence,containerId:current.Id,fromImageId:old,toImageId:target,configurationSha256:hash(this.configuration()),checkpointDir:this.checkpoints};return {plan:value,planSha256:hash(JSON.stringify(value))};}
  stop(){
    const deadline=Math.floor(childJournal.uptime())+200;
    if(this.owner){this.owner.quiesceDeadline=deadline;this.updateOwner(this.owner.checkpointSha256);}
    const quiesce=QUIESCE_SCRIPT;
    this.docker(['exec','--env','SVWAIT=90','system_gitlab_1','/bin/sh','-ec',quiesce,'sh',String(deadline-90)],{timeout:120000});
    this.docker(['exec','system_gitlab_1','/bin/sh','-ec','found=false; for service in /opt/gitlab/service/*; do [ -L "$service" ] || continue; found=true; state=$(/opt/gitlab/embedded/bin/sv status "$service"); case "$state" in down:*) ;; *) exit 1 ;; esac; done; [ "$found" = true ]'],{timeout:10000});
    const remaining=Math.min(60,deadline-Math.floor(childJournal.uptime()));if(remaining<1)throw Error('upgrade-quiesce-deadline-exceeded');
    this.docker(['stop','--time',String(remaining),'system_gitlab_1'],{timeout:remaining*1000+10000});
    const state=this.inspect('system_gitlab_1').State;if(state.Running||state.ExitCode!==0||state.OOMKilled)throw Error('upgrade-clean-stop-required');
  }
  async ready(version,image){const until=this.now()+this.options.readyTimeoutSeconds*1000;while(this.now()<until){try{if(this.inspect('system_gitlab_1').Image!==image)throw Error('upgrade-current-image-mismatch');this.docker(['exec','system_gitlab_1','curl','-fsS','--max-time','5','http://127.0.0.1/-/readiness']);await this.preflight(version);const status=this.docker(['exec','system_gitlab_1','gitlab-rake','db:migrate:status'],{timeout:180000});if(!/^\s*up\s+\d+/m.test(status)||/^\s*down\s+\d+/m.test(status))throw Error('upgrade-pending-migrations');return;}catch{await this.sleep(3000);}}throw Error('upgrade-readiness-timeout');}
  start(reference,restore=false){if(!restore)atomic(this.config,imageAssignment(this.configuration(),this.aliases[reference]||reference,this.aliases));this.run('bash',['start.sh'],{cwd:path.join(ROOT,'gitlab')});}
  snapshot(plan){if(fs.existsSync(this.checkpoints))throw Error('upgrade-new-checkpoint-directory-required');fs.mkdirSync(this.checkpoints,{recursive:true,mode:0o700});if(fs.realpathSync(this.checkpoints)!==this.checkpoints)throw Error('upgrade-symlink-checkpoint-refused');const size=Number(this.run('du',['-sb',this.serviceData]).split(/\s/)[0]),space=fs.statfsSync(this.checkpoints);if(!Number.isSafeInteger(size)||size<=0||space.bavail*space.bsize<size*1.25+104857600)throw Error('upgrade-checkpoint-space-insufficient');fs.mkdirSync(path.join(this.checkpoints,'gitlab'),{mode:0o700});fs.mkdirSync(path.join(this.checkpoints,'configuration'),{mode:0o700});for(const name of ['config','data','log'])this.run('rsync',['-a','--no-specials','--no-devices','--fsync',this.serviceData+'/'+name+'/',path.join(this.checkpoints,'gitlab',name)+'/']);for(const name of ['.docker.env','sync-auth.env']){regular(path.join(this.state,name));atomic(path.join(this.checkpoints,'configuration',name),fs.readFileSync(path.join(this.state,name)));}const value={format:'system-gitlab-cold-checkpoint-v1',sourceRevision:this.options.sourceRevision,createdAt:new Date().toISOString(),plan,entries:inventory(this.checkpoints)},bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>CHECKPOINT_JSON_MAX_BYTES)throw Error('upgrade-checkpoint-too-large');for(const entry of [...value.entries].reverse())if(entry.type==='directory')durableDirectory(path.join(this.checkpoints,entry.path));durableAncestors(this.checkpoints);atomic(path.join(this.checkpoints,'checkpoint.json'),bytes);return {checkpoint:value,checkpointSha256:hash(bytes)};}
  checkpoint(expected){const file=path.join(this.checkpoints,'checkpoint.json'),bytes=jsonBytes(file,CHECKPOINT_JSON_MAX_BYTES,'upgrade-checkpoint-too-large');if(!/^[a-f0-9]{64}$/.test(expected)||hash(bytes)!==expected)throw Error('upgrade-checkpoint-verification-failed');const value=JSON.parse(bytes.toString('utf8'));if(value.format!=='system-gitlab-cold-checkpoint-v1'||value.sourceRevision!==this.options.sourceRevision||value.plan?.fromImageId!==this.image(release.fromImage)||value.plan?.toImageId!==this.image(release.toImage)||JSON.stringify(value.entries)!==JSON.stringify(inventory(this.checkpoints)))throw Error('upgrade-checkpoint-verification-failed');return value;}
  lock(planSha256){
    this.operation=crypto.randomBytes(16).toString('hex');this.held=[];
    const stat=fs.readFileSync('/proc/self/stat','utf8').split(' ').at(21);
    this.owner={format:'system-gitlab-upgrade-lock-v1',operation:this.operation,pid:process.pid,start:stat,planSha256};
    const locks=[path.join(this.state,'.gitlab-upgrade-lock'),path.join(this.seed,'.operation-lock'),path.join(this.certbot,'.system-bootstrapper-certificate-lock'),path.join(this.state,'.projects.env/.wizard.env.environments.lock')];
    try{for(const lock of locks){fs.mkdirSync(lock,{mode:0o700});this.held.push(lock);atomic(path.join(lock,'upgrade-owner.json'),JSON.stringify(this.owner));}}
    catch(error){this.unlock();throw error;}
  }
  updateOwner(checkpointSha256){this.owner.checkpointSha256=checkpointSha256;for(const lock of this.held)atomic(path.join(lock,'upgrade-owner.json'),JSON.stringify(this.owner));}
  unlock(){const childFile=path.join(this.state,'.gitlab-upgrade-lock/child.json');if(fs.existsSync(childFile)){const child=json(childFile);if(child.operation!==this.operation||childJournal.activeGroup(child.group))throw Error('upgrade-operation-child-still-running');fs.unlinkSync(childFile);}for(const lock of [...(this.held||[])].reverse()){const name=path.join(lock,'upgrade-owner.json');if(fs.existsSync(name)){const owner=json(name);if(owner.operation!==this.operation)throw Error('upgrade-lock-ownership-mismatch');fs.unlinkSync(name);}fs.rmdirSync(lock);}this.held=[];}
  adopt(expected,field){
    const root=path.join(this.state,'.gitlab-upgrade-lock');if(!fs.existsSync(root)){this.lock(field==='planSha256'?expected:undefined);if(field==='checkpointSha256')this.updateOwner(expected);return;}
    const owner=json(path.join(root,'upgrade-owner.json'));
    if(owner.format!=='system-gitlab-upgrade-lock-v1'||owner[field]!==expected||!Number.isInteger(owner.pid)||!/^[a-f0-9]{32}$/.test(owner.operation||''))throw Error('upgrade-interrupted-operation-requires-inspection');
    try{const actual=fs.readFileSync('/proc/'+owner.pid+'/stat','utf8').split(' ').at(21);if(actual===owner.start)throw Error('upgrade-operation-still-running');}catch(error){if(error.code!=='ENOENT')throw error;}
    const childFile=path.join(root,'child.json');if(fs.existsSync(childFile)){const child=json(childFile);if(child.format!=='system-gitlab-upgrade-child-v1'||child.operation!==owner.operation||!Number.isInteger(child.group)||child.group<1||childJournal.activeGroup(child.group))throw Error('upgrade-operation-child-still-running');const watcher=childJournal.stat(child.watchdogPid);if(watcher&&watcher.state!=='Z'&&watcher.start===child.watchdogStart)throw Error('upgrade-operation-child-still-running');}
    this.operation=owner.operation;this.owner=owner;this.held=[root,path.join(this.seed,'.operation-lock'),path.join(this.certbot,'.system-bootstrapper-certificate-lock'),path.join(this.state,'.projects.env/.wizard.env.environments.lock')];
    for(const lock of this.held)if(json(path.join(lock,'upgrade-owner.json')).operation!==this.operation)throw Error('upgrade-lock-ownership-mismatch');
    this.owner.pid=process.pid;this.owner.start=fs.readFileSync('/proc/self/stat','utf8').split(' ').at(21);
    for(const lock of this.held)atomic(path.join(lock,'upgrade-owner.json'),JSON.stringify(this.owner));
  }
  async quiesceFinished(){if(this.owner?.quiesceDeadline){const remaining=this.owner.quiesceDeadline-childJournal.uptime();if(remaining>0)await this.sleep((remaining+2)*1000);}}
  syncIdle(){
    const value=JSON.parse(this.run('bash',['-ec','set -a; source "$1"; source "$2"; node "$3" sync-status','bash',path.join(this.state,'sync-auth.env'),this.config,__filename],{timeout:15000}));
    if(value.idle!==true)throw Error('upgrade-sync-operation-running');
  }
  async resumeScheduling(){
    this.docker(['exec','--env','SVWAIT=30','system_gitlab_1','/bin/sh','-ec','for service in nginx gitlab-workhorse puma; do timeout -k 2 45 gitlab-ctl start "$service"; done'],{timeout:150000});
    const until=this.now()+Math.min(this.options.readyTimeoutSeconds,300)*1000;
    while(this.now()<until){try{this.docker(['exec','system_gitlab_1','curl','-fsS','--max-time','5','http://127.0.0.1/-/readiness'],{timeout:10000});return;}catch{await this.sleep(1000);}}
    throw Error('upgrade-previous-ingress-not-ready');
  }
  async quiesceScheduling(){
    this.owner.phase='quiescing-scheduling';this.owner.quiesceDeadline=Math.floor(childJournal.uptime())+110;this.updateOwner(this.owner.checkpointSha256);
    // Once all three HTTP entry/handler services are down, native and external
    // managers cannot claim a new job or register a new runner. Existing runner
    // paused flags and manager containers are untouched.
    this.docker(['exec','--env','SVWAIT=90','system_gitlab_1','/bin/sh','-ec',SCHEDULING_QUIESCE_SCRIPT,'sh',String(this.owner.quiesceDeadline)],{timeout:120000});
    this.owner.phase='scheduling-quiesced';this.updateOwner(this.owner.checkpointSha256);
    try{await this.preflight(release.fromVersion);}
    catch(error){
      // An assignment already in flight may have committed before Puma drained.
      // Restore the old HTTP service without stopping DB/runners or taking a
      // checkpoint; do not cancel or kill that active job.
      await this.resumeScheduling();this.owner.phase='scheduling-aborted';this.updateOwner(this.owner.checkpointSha256);this.unlock();throw error;
    }
  }
  async migrate(plan){
    await this.quiesceScheduling();
    this.stop();const receipt=this.snapshot(plan);this.checkpoint(receipt.checkpointSha256);this.updateOwner(receipt.checkpointSha256);
    atomic(path.join(this.checkpoints,'operation.json'),JSON.stringify({format:'system-gitlab-upgrade-operation-v1',phase:'checkpoint-complete',checkpointSha256:receipt.checkpointSha256}));
    this.start(release.toImage);await this.ready(release.toVersion,plan.toImageId);this.run('bash',['start.sh'],{cwd:path.join(ROOT,'nginx')});
    atomic(path.join(this.checkpoints,'operation.json'),JSON.stringify({format:'system-gitlab-upgrade-operation-v1',phase:'promoted',checkpointSha256:receipt.checkpointSha256,toImage:release.toImage,sourceRevision:this.options.sourceRevision}));
    this.unlock();return {status:'promoted',checkpointSha256:receipt.checkpointSha256,toImage:release.toImage};
  }
  async promote(expected){
    this.lock(expected);let entered=false;
    try{this.syncIdle();const value=await this.plan();if(value.planSha256!==expected)throw Error('upgrade-reviewed-plan-mismatch');entered=true;return await this.migrate(value.plan);}
    catch(error){if(!entered)this.unlock();throw error;}
  }
  async abort(expected){
    if(!fs.existsSync(path.join(this.state,'.gitlab-upgrade-lock')))throw Error('upgrade-interrupted-operation-required');
    this.adopt(expected,'planSha256');await this.quiesceFinished();
    if(this.owner.checkpointSha256)throw Error('upgrade-completed-checkpoint-requires-rollback');
    const current=this.inspect('system_gitlab_1');this.verifyMounts(current);if(current.Image!==this.image(release.fromImage))throw Error('upgrade-current-image-mismatch');
    if(!current.State.Running)this.docker(['start','system_gitlab_1']);else this.docker(['exec','system_gitlab_1','gitlab-ctl','start']);
    await this.ready(release.fromVersion,current.Image);this.run('bash',['start.sh'],{cwd:path.join(ROOT,'nginx')});this.unlock();return {status:'previous-generation-resumed'};
  }
  status(){const name=path.join(this.checkpoints,'operation.json'),lock=path.join(this.state,'.gitlab-upgrade-lock/upgrade-owner.json');const operation=fs.existsSync(name)?json(name):{};const owner=fs.existsSync(lock)?json(lock):{};return {phase:operation.phase||owner.phase||'not-checkpointed',locked:!!owner.operation,checkpointSha256:operation.checkpointSha256||owner.checkpointSha256,planSha256:owner.planSha256};}
  async rollback(expected){
    const checkpoint=this.checkpoint(expected);this.adopt(expected,'checkpointSha256');await this.quiesceFinished();
    const current=this.inspect('system_gitlab_1');this.verifyMounts(current);if(![checkpoint.plan.fromImageId,checkpoint.plan.toImageId].includes(current.Image))throw Error('upgrade-current-image-mismatch');
    // The replacement data is discarded, so an exit1/OOM from a failed B is
    // not a reason to reject a verified cold A checkpoint. No writer may run.
    if(current.State.Running)this.docker(['stop','--time','60','system_gitlab_1'],{timeout:70000});
    if(this.inspect('system_gitlab_1').State.Running)throw Error('upgrade-restore-writer-still-running');
    const marker=path.join(this.serviceData,'data/.system-bootstrapper-restore-incomplete');atomic(marker,'gitlab-upgrade-checkpoint-restore\n');
    for(const name of ['config','data','log'])this.run('rsync',['-a','--no-specials','--no-devices','--fsync','--checksum','--delete','--exclude=.system-bootstrapper-restore-incomplete',path.join(this.checkpoints,'gitlab',name)+'/', this.serviceData+'/'+name+'/']);
    atomic(this.config,fs.readFileSync(path.join(this.checkpoints,'configuration/.docker.env')));atomic(path.join(this.state,'sync-auth.env'),fs.readFileSync(path.join(this.checkpoints,'configuration/sync-auth.env')));
    const expectedEntries=checkpoint.entries.filter(entry=>entry.path.startsWith('gitlab/')||entry.path.startsWith('configuration/'));
    const actualEntries=inventoryAt([...['config','data','log'].map(name=>({full:path.join(this.serviceData,name),path:'gitlab/'+name})),...['.docker.env','sync-auth.env'].map(name=>({full:path.join(this.state,name),path:'configuration/'+name}))],new Set(['gitlab/data/.system-bootstrapper-restore-incomplete']));
    if(JSON.stringify(actualEntries)!==JSON.stringify(expectedEntries))throw Error('upgrade-restored-payload-mismatch');
    for(const entry of [...checkpoint.entries].reverse())if(entry.type==='directory'&&entry.path.startsWith('gitlab/')){const name=entry.path.replace(/^gitlab\//,this.serviceData+'/');const fd=fs.openSync(name,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
    fs.unlinkSync(marker);const descriptor=fs.openSync(path.join(this.serviceData,'data'),'r');try{fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
    this.start(release.fromImage,true);await this.ready(release.fromVersion,checkpoint.plan.fromImageId);this.run('bash',['start.sh'],{cwd:path.join(ROOT,'nginx')});
    atomic(path.join(this.checkpoints,'operation.json'),JSON.stringify({format:'system-gitlab-upgrade-operation-v1',phase:'restored-checkpoint',checkpointSha256:expected}));this.unlock();return {status:'restored-checkpoint',checkpointSha256:expected};
  }

}
async function syncStatus(){
  const http=require('node:http');
  const request=(route,method,body,token)=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:8071,path:route,method,
      headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},signal:AbortSignal.timeout(5000)},res=>{
      let raw='';res.on('data',part=>{raw+=part;if(raw.length>16384)req.destroy();});
      res.on('error',()=>reject(Error('upgrade-sync-unavailable')));
      res.on('end',()=>{try{if(res.statusCode!==200)throw Error();resolve(JSON.parse(raw));}catch{reject(Error('upgrade-sync-unavailable'));}});
    });
    req.on('error',()=>reject(Error('upgrade-sync-unavailable')));req.end(body);
  });
  const auth=await request('/login','POST',JSON.stringify({username:process.env.SYNC_USER,password:process.env.SYNC_PASS}));
  if(typeof auth.accessToken!=='string')throw Error('upgrade-sync-unavailable');const status=await request('/status','GET',undefined,auth.accessToken);
  return {idle:status.projectOperationInProgress===false&&status.runnerSetupInProgress===false&&status.harvestInProgress===false&&status.defaultWizardSetupInProgress===false&&status.needRestart===false};
}
async function main(){
  const [action,filename,confirmation]=process.argv.slice(2);
  if(action==='sync-status'&&!filename){console.log(JSON.stringify(await syncStatus()));return;}
  if(!['plan','promote','rollback','abort','status'].includes(action)||!filename||(['plan','status'].includes(action)?confirmation!==undefined:!/^[a-f0-9]{64}$/.test(confirmation||'')))throw Error('upgrade-usage-invalid');
  const engine=new Upgrade(json(filename));console.log(JSON.stringify(await engine[action](confirmation)));
}
module.exports={Upgrade,release,QUIESCE_SCRIPT,SCHEDULING_QUIESCE_SCRIPT,INPUT_JSON_MAX_BYTES,CHECKPOINT_JSON_MAX_BYTES,json,options,imageAssignment,inventory,hash,cube,atomic,run,inventoryAt,durableDirectory,durableAncestors};
if(require.main===module)main().catch(()=>{console.error('GitLab upgrade stopped. Inspect the private operation/checkpoint; do not retry an uncertain migration or start an old image on migrated data.');process.exitCode=1;});
