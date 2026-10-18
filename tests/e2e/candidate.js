'use strict';
const fs=require('fs');
const path=require('path');
const {Candidate,recover}=require('../shared/disposable-candidate');

function cleanupAll(directory,dependencies={}) {
  const io=dependencies.fs||fs,restore=dependencies.recover||recover;
  if(!io.existsSync(directory))return true;
  if(!io.lstatSync(directory).isDirectory()||io.lstatSync(directory).isSymbolicLink())return false;
  const records=[];let failed=false,blockedRank=Infinity;
  for(const name of io.readdirSync(directory).filter(name=>/^[a-f0-9]{24}$/.test(name))) {
    const target=path.join(directory,name),filename=path.join(target,'results.json');
    try {
      if(!io.lstatSync(target).isDirectory()||io.lstatSync(target).isSymbolicLink()||
        !io.lstatSync(filename).isFile()||io.lstatSync(filename).isSymbolicLink())throw Error();
      const receipt=JSON.parse(io.readFileSync(filename,'utf8'));
      if(receipt.runId!==name||!Array.isArray(receipt.resources))throw Error();
      // Heavy daemon endpoints must disappear first. Then remove tiny clients,
      // finally the authority that owns their shared network and data volume.
      const rank=receipt.fullAcceptance===true?0:receipt.resources.some(item=>item.kind==='network')?2:1;
      records.push({receipt,target,rank});
    }catch {failed=true;blockedRank=1;}
  }
  records.sort((a,b)=>a.rank-b.rank||a.receipt.runId.localeCompare(b.receipt.runId));
  for(const item of records) {
    if(item.rank>=blockedRank){failed=true;continue;}
    let clean=false;
    try {const instance=restore(item.receipt);clean=instance.cleanup();instance.report(item.target);}
    catch {clean=false;}
    if(!clean){failed=true;blockedRank=Math.min(blockedRank,item.rank+1);}
  }
  return !failed;
}
async function main() {
  if(process.env.SYSTEM_DISPOSABLE_CANDIDATE!=='I_ACCEPT_PRIVILEGED_DISPOSABLE_EXECUTION') {
    throw new Error('explicit-disposable-opt-in-and-spec-required');
  }
  if(process.platform!=='linux') throw new Error('linux-driver-required');
  if(process.argv[2]==='cleanup-all' && process.argv.length===4) {
    process.exitCode=cleanupAll(path.resolve(process.argv[3]))?0:1;return;
  }
  if(process.argv[2]==='cleanup' && process.argv.length===4) {
    const receipt=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
    const instance=recover(receipt);
    const ok=instance.cleanup();
    instance.report(path.dirname(path.resolve(process.argv[3])));
    process.exitCode=ok?0:1; return;
  }
  if(process.argv.length!==3) throw new Error('spec-required');
  const spec=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  for(const image of Object.values({...spec.images,...spec.supportImages})) {
    const stat=fs.lstatSync(image.archive);
    if(!stat.isFile() || stat.isSymbolicLink()) throw new Error('regular-image-archives-required');
  }
  // Only the tracked public example is accepted, never a private workstation config.
  spec.example=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8');
  const reportDirectory=instance=>path.join(__dirname,'../../test-results/e2e',instance.id);
  const candidate=new Candidate(spec,{checkpoint:instance=>instance.report(reportDirectory(instance))});
  candidate.report(reportDirectory(candidate));
  console.log('Disposable candidate run: '+candidate.id);
  const cancel=()=>{candidate.canceled=true;};
  process.on('SIGINT',cancel); process.on('SIGTERM',cancel);
  let failed=false;
  try { await candidate.start(); await candidate.smoke(); if(spec.fullAcceptance===true) await candidate.platform();
    if(spec.recoveryAcceptance===true) await require('./recovery').run(candidate,reportDirectory); }
  catch { failed=true; console.error('Disposable candidate failed; see sanitized stage report.'); }
  finally {
    if(!candidate.cleanup()) failed=true;
    candidate.report(reportDirectory(candidate));
    process.removeListener('SIGINT',cancel); process.removeListener('SIGTERM',cancel);
  }
  process.exitCode=failed?1:0;
}
if(require.main===module) main().catch(()=>{console.error('Invalid disposable candidate invocation.');process.exitCode=1;});
module.exports={main,cleanupAll};
