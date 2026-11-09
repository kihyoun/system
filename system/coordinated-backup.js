'use strict';
// Private configuration stays outside the Seed; only its downloaded ZIP pairs it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function requireValue(value, code) { if (!value) throw Error(code); }
function directory(state, id) {
  requireValue(/^[a-f0-9]{32}$/.test(id), 'invalid-backup-operation');
  return path.join(state, '.coordinated-backups', id);
}
function writeStatus(root, value) {
  fs.writeFileSync(path.join(root, '.status-next'), JSON.stringify(value)+'\n', {mode:0o600,flush:true});
  fs.renameSync(path.join(root, '.status-next'), path.join(root,'status.json'));
}
function capture(state) {
  const names = fs.readdirSync(path.join(state,'.projects.env')).filter(name => /^\.[A-Za-z0-9_.-]+\.env$/.test(name)).sort();
  const read = filename => {
    const full=path.join(state,filename), stat=fs.lstatSync(full);
    requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 5000000,'unsafe-configuration-input');
    return fs.readFileSync(full,'utf8');
  };
  const main=read('.docker.env');
  requireValue(main.charCodeAt(807) === 36 && crypto.createHash('md5').update(main.slice(0,1184)).digest('hex') === 'bd4a8426355824593a5e21ad759830c1','configuration-cube-mismatch');
  const projects=names.map(filename=>({filename,data:read('.projects.env/'+filename)}));
  requireValue(Buffer.byteLength(main)+projects.reduce((sum,item)=>sum+Buffer.byteLength(item.data),0)<=50000000,'configuration-backup-is-too-large');
  const captured={main:{data:main},projects};
  const intentFile=path.join(state,'preview-setup.json');
  if(fs.existsSync(intentFile)) {
    const stat=fs.lstatSync(intentFile);
    requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=100000,'unsafe-preview-setup-input');
    const saved=JSON.parse(fs.readFileSync(intentFile,'utf8'));
    captured.previewSetup=require('../project-bootstrap/preview-setup/settings').settings(saved.settings);
  }
  return captured;
}
function checksums(input) {
  return [{filename:'.docker.env',sha256:sha256(input.main.data)}, ...input.projects.map(file=>({filename:'.projects.env/'+file.filename,sha256:sha256(file.data)}))];
}
function completed(seed) {
  // Harvest already verified every payload byte before atomic publication.
  const relative=fs.readlinkSync(path.join(seed,'current'));
  requireValue(/^snapshots\/[A-Za-z0-9][A-Za-z0-9.-]*$/.test(relative),'invalid-seed-generation');
  const root=path.join(seed,relative);
  requireValue(fs.realpathSync(root) === root,'unsafe-seed-generation');
  const raw=fs.readFileSync(path.join(root,'manifest.json'));
  const record=JSON.parse(raw);
  requireValue(record.format === 'system-bootstrapper-seed-v2' && record.consistency === 'gitlab-stopped' &&
    !Number.isNaN(Date.parse(record.completedAt)),'incomplete-seed-generation');
  return {generation:relative.slice('snapshots/'.length),manifest:relative+'/manifest.json',manifestSha256:sha256(raw),
    completedAt:record.completedAt,gitlabImage:record.gitlabImage,gitlabImageId:record.gitlabImageId};
}
function runWorkflow({state,seed,certbot,id,harvest,exporter,seedTarget=seed,now=()=>new Date().toISOString()}) {
  const root=directory(state,id);
  requireValue(fs.realpathSync(root) === root && fs.statSync(root).isDirectory(),'unsafe-backup-operation');
  const startedAt=now();
  let result={format:'system-coordinated-backup-v1',id,startedAt,state:'working',phase:'capturing-configuration',seed:null,configuration:{status:'pending'}};
  const update=changes=>{result={...result,...changes};writeStatus(root,result);};
  const lock=path.join(certbot,'.system-bootstrapper-certificate-lock');
  let held=false,token,prior=null,uncertain=false;
  try {
    try { prior=completed(seed); } catch { /* A first Harvest need not have a prior Seed. */ }
    try {fs.mkdirSync(lock,{mode:0o700});} catch {throw Error('certificate-operation-busy');}
    held=true; token=crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(path.join(lock,'coordinated-owner'),token,{mode:0o600,flag:'wx',flush:true});
    update({});
    const input=capture(state),capturedAt=now(),files=checksums(input);
    update({phase:'harvesting'});
    harvest(token);
    const snapshot=completed(seed);
    requireValue(!prior || snapshot.generation !== prior.generation,'new-completed-seed-required');
    update({phase:'exporting-configuration',seed:{...snapshot,location:path.join(seedTarget,'snapshots',snapshot.generation),status:'completed'}});
    const finalCapture=capture(state);
    requireValue(JSON.stringify(files) === JSON.stringify(checksums(finalCapture)) &&
      JSON.stringify(input.previewSetup) === JSON.stringify(finalCapture.previewSetup),'configuration-changed-during-backup');
    input.seedAssociation={format:'system-backup-pair-v1',status:'matched-completed-seed',verified:true,operation:id,
      ...snapshot,capturedAt,configurationFiles:files};
    const inputPath=path.join(root,'configuration-input.json'),output=path.join(root,'bootstrapper.zip');
    fs.writeFileSync(inputPath,JSON.stringify(input),{mode:0o600,flag:'wx',flush:true});
    try { exporter(inputPath,output); } finally {fs.unlinkSync(inputPath);}
    requireValue(fs.lstatSync(output).isFile() && !fs.lstatSync(output).isSymbolicLink(),'configuration-export-failed');
    update({state:'ready',phase:'awaiting-download',completedAt:now(),configuration:{status:'ready',filename:'bootstrapper.zip',sha256:sha256(fs.readFileSync(output)),download:'not-confirmed'}});
  } catch(error) {
    uncertain=error.uncertain === true;
    let snapshot;
    try {snapshot=completed(seed);} catch { /* Keep prior successful status if still readable. */ }
    const fresh=snapshot && (!prior || snapshot.generation !== prior.generation);
    update({state:uncertain?'interrupted':fresh?'partial':'failed',phase:uncertain?'needs-inspection':'failed',completedAt:now(),
      seed:fresh?{...snapshot,location:path.join(seedTarget,'snapshots',snapshot.generation),status:result.seed?'completed':'completed-resumption-unconfirmed'}:null,
      configuration:{status:'unavailable'},error:/^[a-z][a-z0-9-]+$/.test(error.message)?error.message:'coordinated-backup-failed'});
    throw error;
  } finally {
    if(held && !uncertain) {
      try {
        requireValue(fs.readFileSync(path.join(lock,'coordinated-owner'),'utf8') === token,'certificate-lease-owner-changed');
        fs.unlinkSync(path.join(lock,'coordinated-owner'));fs.rmdirSync(lock);
      } catch {
        update({state:result.seed?'partial':'failed',phase:'needs-inspection',error:'certificate-lease-cleanup-failed',configuration:{status:'unavailable'}});
        throw Error('certificate-lease-cleanup-failed');
      }
    }
  }
  return result;
}
function helperCompleted(state,id) {
  const root=directory(state,id),status=JSON.parse(fs.readFileSync(path.join(root,'status.json'),'utf8'));
  const leasesRemain=fs.existsSync(path.join(state,'.storage-operation-lock')) ||
    fs.existsSync(path.join(state,'.projects.env/.wizard.env.environments.lock'));
  writeStatus(root,{...status,helperCompletedAt:new Date().toISOString(),
    ...(status.state === 'ready' && leasesRemain ? {state:'interrupted',phase:'needs-inspection',
      error:'storage-lease-release-unconfirmed',configuration:{status:'unavailable'}} : {})});
}
function exportZip(input,output) {
  const result=spawnSync(process.execPath,['/opt/system-bootstrapper/export-configuration.cjs',input,output],{stdio:'pipe',timeout:120000});
  requireValue(!result.error && result.status===0,'configuration-export-failed');
}
module.exports={directory,writeStatus,capture,checksums,completed,runWorkflow,helperCompleted,exportZip};
