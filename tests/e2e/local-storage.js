'use strict';
// Storage acceptance stays inside owned disposable daemons. A separate outer
// volume models removable backup media; live data remains on each daemon's root.
const {LABEL}=require('../shared/disposable-candidate');
const DEVICE='/seed-device';
const MOUNT='/external-seed';
const SEED=MOUNT+'/seed';
async function prepareOwner(candidate,dependencies={}) {
  const Owner=dependencies.Owner||require('../shared/disposable-candidate').Candidate;
  const owner=new Owner({...candidate.spec,fullAcceptance:false,recoveryAcceptance:false},
    {docker:candidate.exec,now:candidate.now,sleep:candidate.sleep,checkpoint:candidate.checkpoint});
  owner.deadline=candidate.deadline;
  Object.defineProperty(owner,'canceled',{configurable:true,get:()=>candidate.canceled,set:()=>{}});
  candidate.backupOwner=owner;
  owner.checkpoint(owner);
  const volume=await owner.create('volume',['volume','create','--label',LABEL+'='+owner.id,owner.name]);
  return ['--mount','type=volume,source='+volume+',target='+DEVICE];
}
async function attach(candidate) {
  if(!candidate.backupOwner)throw Error('storage-backup-owner-required');
  await candidate.call(['exec',candidate.daemon,'sh','-ec',
    'test -d '+DEVICE+'; mkdir -p '+MOUNT+'; mount --bind '+DEVICE+' '+MOUNT+'; mkdir -p '+SEED]);
}
async function detach(candidate) {
  await candidate.call(['exec',candidate.daemon,'sh','-ec',
    'umount '+MOUNT+'; umount '+DEVICE+'; rmdir '+MOUNT+' '+DEVICE]);
  await assertAbsent(candidate);
}
async function assertAbsent(candidate) {
  const result=await candidate.call(['exec',candidate.daemon,'sh','-ec',
    'test ! -e '+SEED+'; ! awk \'$5 == "'+MOUNT+'" { found=1 } END { exit !found }\' /proc/self/mountinfo; printf absent']);
  if(result!=='absent')throw Error('storage-backup-still-attached');
}
async function verifyLocalLive(candidate,base) {
  if(!['/candidate-data/platform','/recovered-data/platform'].includes(base))throw Error('storage-owned-root-required');
  const result=await candidate.call(['exec',candidate.daemon,'sh','-ec',
    'test "$(stat -c %d /)" = "$(stat -c %d '+base+')"; test ! -e '+SEED+'; printf local']);
  if(result!=='local')throw Error('storage-live-not-on-root');
  const marker=await candidate.call(['exec',candidate.daemon,'cat',base+'/.system-bootstrapper-volume']);
  if(marker!=='system-bootstrapper-persistence-v1')throw Error('storage-live-marker-invalid');
  const containers=JSON.parse(await candidate.inner(['inspect','system_bootstrapper_1','system_gitlab_1']));
  if(containers.length!==2||containers.some(item=>item.Mounts.some(mount=>mount.Destination==='/seed'||mount.Source===MOUNT||mount.Source===SEED)))throw Error('storage-permanent-backup-binding');
  candidate.localLiveVerified=true;
}
module.exports={DEVICE,MOUNT,SEED,prepareOwner,attach,detach,assertAbsent,verifyLocalLive};

async function prepareLocal(candidate,base) {
  if(!['/candidate-data/platform','/recovered-data/platform'].includes(base))throw Error('storage-owned-root-required');
  await candidate.inner(['run','--rm','--network','none','--entrypoint','node',
    '--mount','type=bind,src=/,dst=/host','--env','PERSISTENCE_MODE=local','--env','PERSISTENT_MOUNT=/',
    '--env','PERSISTENT_DIR='+base,'system-candidate:under-test','/system/system/seed-operation.js','prepare-local']);
}
function failureCodes(code) {
  return {[code]:code,['Seed operation failed: '+code+'.']:code};
}
async function refused(candidate,code,operation='harvest') {
  try {
    await candidate.inner(['exec','-w','/system/system','system_bootstrapper_1','bash',operation==='restore'?'seed.sh':'harvest.sh'],
      {timeout:30000,failureCodes:failureCodes(code)});
  } catch(error) {if(error.message===code)return;throw error;}
  throw Error('storage-refusal-not-enforced');
}
async function serviceIdentity(candidate) {
  return candidate.inner(['inspect','--format','{{.Id}} {{.State.Running}} {{.RestartCount}}','system_gitlab_1']);
}
async function refuseMissingTarget(candidate) {
  const before=await serviceIdentity(candidate);
  await assertAbsent(candidate);
  await refused(candidate,'seed-target-unavailable');
  await assertAbsent(candidate);
  if(await serviceIdentity(candidate)!==before)throw Error('storage-guard-changed-live-service');
  candidate.missingBackupGuardVerified=true;
}
async function refuseLockedLive(candidate,operation='harvest') {
  const identity=operation==='restore'?()=>candidate.inner(['ps','-aq','--filter','name=^/system_gitlab_1$']):()=>serviceIdentity(candidate);
  const before=await identity();
  await candidate.inner(['exec','system_bootstrapper_1','mkdir','/state/.storage-operation-lock']);
  try {await refused(candidate,'storage-operation-busy',operation);}
  finally {await candidate.inner(['exec','system_bootstrapper_1','rmdir','/state/.storage-operation-lock']);}
  if(await identity()!==before)throw Error('storage-guard-changed-live-service');
  candidate.globalLeaseVerified=true;
}
async function refuseInvalidRestore(candidate,base) {
  await candidate.stage('storage-refuse-nonempty-and-corrupt-restore',async()=>{
    const marker=base+'/gitlab/data/.storage-existing';
    await candidate.call(['exec',candidate.daemon,'sh','-ec','printf retained > '+marker]);
    await refused(candidate,'restore-target-not-empty','restore');
    await candidate.call(['exec',candidate.daemon,'sh','-ec','test "$(cat '+marker+')" = retained; rm '+marker]);
    const current=await candidate.call(['exec',candidate.daemon,'readlink',SEED+'/current']);
    if(!/^snapshots\/[A-Za-z0-9.-]+$/.test(current))throw Error('storage-completed-seed-required');
    const proof=SEED+'/'+current+'/srv/gitlab/config/.storage-acceptance-proof';
    await candidate.call(['exec',candidate.daemon,'sh','-ec','printf corrupt > '+proof]);
    try {
      await refused(candidate,'seed-payload-invalid','restore');
      await candidate.call(['exec',candidate.daemon,'sh','-ec',
        'test -z "$(ls -A '+base+'/gitlab/data)"; test ! -e '+base+'/gitlab/data/.system-bootstrapper-restore-incomplete']);
    } finally {await candidate.call(['exec',candidate.daemon,'sh','-ec','printf storage-seed-fixture > '+proof]);}
    candidate.invalidRestoreGuardVerified=true;
  });
}
async function verifyControlWithoutBackup(candidate) {
  await assertAbsent(candidate);
  const before=await candidate.inner(['inspect','--format','{{.RestartCount}}','system_bootstrapper_1']);
  const networks=JSON.parse(await candidate.inner(['inspect','--format','{{json .NetworkSettings.Networks}}','system_bootstrapper_1']));
  const gateway=networks.bridge?.Gateway;
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(gateway||''))throw Error('missing-private-gateway');
  const script="let text='';process.stdin.on('data',x=>text+=x);process.stdin.on('end',async()=>{try{const input=JSON.parse(text);await ("+async function(input){
    const fs=require('fs'),https=require('https');
    const request=(route,body,headers={})=>new Promise((resolve,reject)=>{
      const req=https.request({hostname:'sync.candidate.test',servername:'sync.candidate.test',path:route,port:443,method:'POST',
        lookup:(_host,options,done)=>options.all?done(null,[{address:input.gateway,family:4}]):done(null,input.gateway,4),
        ca:fs.readFileSync(input.certificate),rejectUnauthorized:true,headers,timeout:10000},res=>{
        const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>1048576){req.destroy();reject(Error());}else chunks.push(chunk);});
        res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));
      });req.on('error',reject);req.on('timeout',()=>req.destroy(Error()));req.end(body);
    });
    const login=await request('/login',JSON.stringify({username:input.user,password:input.password}),{'Content-Type':'application/json'});
    if(login.status!==200)throw Error();
    const boundary='storage-acceptance-'+require('crypto').randomBytes(16).toString('hex');
    const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="bootstrapper.zip"; filename="bootstrapper.zip"\r\nContent-Type: application/zip\r\n\r\n'),fs.readFileSync('/system/bootstrapper.zip'),Buffer.from('\r\n--'+boundary+'--\r\n')]);
    const response=await request('/config/zip',body,{'Content-Type':'multipart/form-data; boundary='+boundary,Authorization:'Bearer '+JSON.parse(login.body).accessToken});
    if(response.status!==200||JSON.parse(response.body).status?.needRestart!==true)throw Error();
    process.stdout.write('accepted');
  }.toString()+")(input);}catch{process.exitCode=1;}});";
  const certificate=candidate.spec.restore?.expected?.acme?require('./local-acme').ISSUANCE_CA:'/ssl/live/recovery-fixture/fullchain.pem';
  const result=await candidate.inner(['exec','-i','system_bootstrapper_1','node','-e',script],
    {input:JSON.stringify({gateway,certificate,user:candidate.secrets.user,password:candidate.secrets.password}),timeout:30000});
  if(result!=='accepted')throw Error('storage-push-without-backup-failed');
  await candidate.wait(async()=>Number(await candidate.inner(['inspect','--format','{{.RestartCount}}','system_bootstrapper_1']))>Number(before),180000);
  const recovery=require('./recovery');
  await candidate.wait(async()=>{
    const page=await recovery.tlsProbe(candidate,'wizard.candidate.test','/',{},{certificate});return page.status===200&&/<html/i.test(page.body);
  },candidate.spec.readinessMilliseconds||600000);
  // Wizard routing can return before Sync has reopened its listener.
  await recovery.syncFetch(candidate,{certificate},{waitForReady:true});
  await assertAbsent(candidate);
  candidate.backupDetached=true;
}
Object.assign(module.exports,{prepareLocal,failureCodes,refused,refuseMissingTarget,refuseLockedLive,refuseInvalidRestore,verifyControlWithoutBackup});
