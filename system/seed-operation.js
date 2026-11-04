'use strict';
// An on-demand trusted helper; normal services never need the backup medium.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const fields = ['PERSISTENCE_MODE','PERSISTENT_MOUNT','PERSISTENT_DIR','PERSISTENT_UUID',
  'SEED_DIR','SEED_MOUNT','SEED_UUID','GITLAB_IMAGE','SYSTEM_WIZARD_CANONICAL_CONTROLLER'];
const liveDirectories = ['configuration','wizard-public','templates','synctemplates','ssl','runners',
  'gitlab/config','gitlab/logs','gitlab/data','host/letsencrypt'];
function requireValue(value, code) { if (!value) throw Error(code); }
function absolute(value) {
  requireValue(typeof value === 'string' && value.startsWith('/') && value !== '/' &&
    path.posix.normalize(value) === value && !/[\0-\x1f,]/.test(value), 'invalid-storage-path');
  return value;
}
function disjoint(a,b) { return a !== b && !a.startsWith(b+'/') && !b.startsWith(a+'/'); }
function mountRows(text) {
  const decode = value => value.replace(/\\([0-7]{3})/g, (_, digits) => String.fromCharCode(parseInt(digits,8)));
  return text.trim().split('\n').filter(Boolean).map(line => {
    const [left,right] = line.split(' - '), columns = left.split(' ');
    requireValue(right && columns.length >= 6, 'invalid-host-mount-information');
    return {device:columns[2],target:decode(columns[4]),options:columns[5].split(','),type:right.split(' ')[0]};
  });
}
function covering(rows, value) {
  const row = rows.filter(row => row.target === '/' || value === row.target || value.startsWith(row.target+'/'))
    .sort((a,b)=>b.target.length-a.target.length)[0];
  requireValue(row, 'storage-mount-not-found'); return row;
}
function resolveHost(value,hostRoot='/host') {
  const selected = hostRoot+value;
  requireValue(fs.existsSync(selected) && fs.realpathSync(selected) === selected && fs.statSync(selected).isDirectory(),
    'seed-target-unavailable');
  return selected;
}
function checkUuid(uuid, device) {
  if (!uuid) return;
  requireValue(/^[A-Za-z0-9-]+$/.test(uuid), 'invalid-filesystem-identity');
  const file = '/host/dev/disk/by-uuid/'+uuid;
  let stat;
  try { stat=fs.statSync(file,{bigint:true}); } catch { throw Error('filesystem-identity-mismatch'); }
  const dev=stat.rdev;
  const major=((dev>>8n)&0xfffn)|((dev>>32n)&0xfffff000n);
  const minor=(dev&0xffn)|((dev>>12n)&0xffffff00n);
  requireValue(stat.isBlockDevice() && `${major}:${minor}` === device, 'filesystem-identity-mismatch');
}
function validate(spec, read=fs.readFileSync, hostRoot='/host') {
  const live=absolute(spec.PERSISTENT_DIR), seed=absolute(spec.SEED_DIR);
  requireValue(disjoint(live,seed), 'overlapping-live-and-backup-paths');
  const rows=mountRows(read(hostRoot+'/proc/1/mountinfo','utf8'));
  const root=covering(rows,'/'), liveRow=covering(rows,live), seedRow=covering(rows,seed);
  const mode=spec.PERSISTENCE_MODE || (spec.PERSISTENT_MOUNT ? 'volume':'local');
  requireValue(['local','volume'].includes(mode), 'invalid-persistence-mode');
  const mount=spec.PERSISTENT_MOUNT || '/';
  if (mode === 'local') requireValue(mount === '/' && liveRow.device === root.device && liveRow.target === root.target,
    'local-storage-is-not-on-system-disk');
  else requireValue(mount !== '/' && liveRow.target === mount && liveRow.device !== root.device, 'live-volume-unavailable');
  if (spec.SEED_MOUNT) {
    requireValue(spec.SEED_MOUNT === '/' || path.posix.normalize(spec.SEED_MOUNT) === spec.SEED_MOUNT, 'invalid-seed-mount');
    requireValue(seedRow.target === spec.SEED_MOUNT && (seed === spec.SEED_MOUNT || seed.startsWith(spec.SEED_MOUNT.replace(/\/$/,'')+'/')),
      'seed-target-unavailable');
  } else {
    // A different device must be declared explicitly, so disappearance cannot
    // silently turn a backup into a directory on the live/system filesystem.
    requireValue(seedRow.device === liveRow.device, 'declare-external-seed-mount');
  }
  if (mode === 'local') requireValue(spec.SEED_MOUNT && spec.SEED_MOUNT !== '/' &&
    seedRow.target === spec.SEED_MOUNT && seedRow.device !== liveRow.device && seedRow.device !== root.device,
    'external-seed-volume-required');
  resolveHost(live,hostRoot); resolveHost(seed,hostRoot);
  for (const relative of [...liveDirectories,'configuration/.projects.env']) {
    const selected=live+'/'+relative;
    if (relative === 'configuration/.projects.env' && !fs.existsSync(hostRoot+selected)) continue;
    resolveHost(selected,hostRoot);
    requireValue(covering(rows,selected).target === liveRow.target, 'nested-live-storage-mount');
  }
  requireValue(seedRow.options.includes('rw'), 'seed-target-not-writable');
  checkUuid(spec.PERSISTENT_UUID,liveRow.device); checkUuid(spec.SEED_UUID,seedRow.device);
  requireValue(!['vfat','msdos','9p','drvfs'].includes(seedRow.type), 'backup-requires-POSIX-filesystem');
  return {live,seed,mode};
}
function execute(args, options={}) {
  const result=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],
    {encoding:'utf8',timeout:options.timeout || 3600000,maxBuffer:1024*1024,...options});
  if (result.error || result.status !== 0) {
    const controlled=String(result.stderr || '').match(/^Seed operation failed: ([a-z][a-z0-9-]+)\.$/m);
    throw Error(controlled ? controlled[1]:'seed-helper-command-failed');
  }
  return (result.stdout || '').trim();
}
function configuration(environment=process.env, host=false) {
  const selector=host ? '/host'+(environment.PERSISTENCE_ENV_FILE || '/etc/system-bootstrapper/persistence.env') : '';
  const inherited={...environment};
  let shell='set -eu; set -a; ';
  if (host) shell+='source "$1"; ';
  else shell+='if [[ -f /state/.docker.env ]]; then source /state/.docker.env; fi; ';
  shell+=fields.map(key=>'printf "%s\\0" "${'+key+'-}";').join(' ');
  const result=spawnSync('bash',['-c',shell,'read-storage',selector],{env:inherited,encoding:'utf8',maxBuffer:65536});
  requireValue(result.status === 0, 'storage-selector-unavailable');
  const values=result.stdout.split('\0');
  requireValue(values.length === fields.length+1, 'invalid-storage-selector');
  const spec=Object.fromEntries(fields.map((key,index)=>[key,values[index]]));
  // Storage selectors are host-owned inputs, never an old Wizard host path.
  for (const key of fields.filter(key=>key !== 'GITLAB_IMAGE')) {
    if (!host && Object.hasOwn(environment,key)) spec[key]=environment[key];
  }
  spec.PERSISTENCE_MODE ||= spec.PERSISTENT_MOUNT ? 'volume':'local';
  if (spec.PERSISTENCE_MODE === 'local') {
    spec.PERSISTENT_MOUNT ||= '/'; spec.PERSISTENT_DIR ||= '/var/lib/system-bootstrapper/platform';
  }
  return spec;
}
function helperArguments(spec,image,name,operation,checkOnly=false,backup='') {
  const live=absolute(spec.PERSISTENT_DIR), seed=absolute(spec.SEED_DIR);
  requireValue(/^sha256:[a-f0-9]{64}$/.test(image) && /^system-storage-(harvest|restore)-[a-f0-9]{24}$/.test(name), 'invalid-helper-identity');
  const args=['create','--name',name,'--network','none','--init','--pids-limit','256',
    '--label','org.system-bootstrapper.storage-operation='+name,'--entrypoint','node',
    '--mount','type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
    '--mount','type=bind,src=/,dst=/host,readonly',
    '--mount','type=bind,src='+live+',dst=/live',
    '--mount','type=bind,src='+live+'/gitlab/config,dst=/srv/gitlab/config',
    '--mount','type=bind,src='+live+'/gitlab/logs,dst=/srv/gitlab/log',
    '--mount','type=bind,src='+live+'/gitlab/data,dst=/srv/gitlab/data',
    '--mount','type=bind,src='+seed+',dst=/seed'];
  if (backup) args.push('--mount','type=bind,src='+absolute(backup)+',dst=/system/bootstrapper.zip,readonly');
  args.push('--env','SYSTEM_STORAGE_SPEC='+JSON.stringify({...spec,operation,checkOnly,backup:!!backup,helperName:name,imageId:image}),
    image,'/system/system/seed-operation.js','inside');
  return args;
}
function launch(operation,{environment=process.env,host=false,checkOnly=false,backup='',run=execute}={}) {
  requireValue(['harvest','restore'].includes(operation), 'invalid-seed-operation');
  const spec=configuration(environment,host);
  requireValue(spec.SEED_DIR, 'seed-target-unavailable');
  const image=host ? environment.SYSTEM_SEED_CONTROLLER_IMAGE :
    JSON.parse(run(['inspect',spec.SYSTEM_WIZARD_CANONICAL_CONTROLLER || 'system_bootstrapper_1']))[0].Image;
  // Validate canonical host paths and mount identities before any writable bind.
  run(['run','--rm','--network','none','--entrypoint','node',
    '--mount','type=bind,src=/,dst=/host,readonly','--env','SYSTEM_STORAGE_SPEC='+JSON.stringify(spec),
    image,'/system/system/seed-operation.js','validate']);
  const name='system-storage-'+operation+'-'+crypto.randomBytes(12).toString('hex');
  const args=helperArguments(spec,image,name,operation,checkOnly,backup);
  let created=false;
  try {
    run(args); created=true;
    const result=spawnSync('docker',['--host=unix:///var/run/docker.sock','start','--attach',name],
      {stdio:'inherit',timeout:3600000});
    requireValue(!result.error && result.status === 0, 'seed-helper-operation-failed');
  } finally {
    if (created) {
      const row=JSON.parse(run(['inspect',name]))[0];
      requireValue(row.Image === image && row.Config.Labels?.['org.system-bootstrapper.storage-operation'] === name,
        'seed-helper-identity-changed');
      // Do not kill an operation whose completion is uncertain. Its live lease
      // remains a visible barrier until the owned helper can be investigated.
      requireValue(row.State.Running === false, 'seed-helper-still-running');
      run(['rm',name]);
    }
  }
}
function restoreEmpty(live='/live') {
  for (const relative of ['gitlab/config','gitlab/logs','gitlab/data','ssl','host/letsencrypt']) {
    const directory=path.join(live,relative);
    requireValue(fs.existsSync(directory) && fs.readdirSync(directory).length === 0, 'restore-target-not-empty');
  }
}
function prepareLocal(spec,hostRoot='/host',mountinfo) {
  requireValue(spec.PERSISTENCE_MODE === 'local' && (!spec.PERSISTENT_MOUNT || spec.PERSISTENT_MOUNT === '/'), 'invalid-local-storage-selector');
  const live=absolute(spec.PERSISTENT_DIR || '/var/lib/system-bootstrapper/platform');
  let existing=hostRoot+live;
  while (!fs.existsSync(existing)) existing=path.dirname(existing);
  requireValue(existing === hostRoot || existing.startsWith(hostRoot+'/'), 'invalid-storage-path');
  requireValue(fs.realpathSync(existing) === existing, 'unsafe-live-storage-path');
  const rows=mountRows(mountinfo || fs.readFileSync(hostRoot+'/proc/1/mountinfo','utf8'));
  requireValue(covering(rows,live).device === covering(rows,'/').device, 'local-storage-is-not-on-system-disk');
  const disk=fs.statfsSync(existing);
  requireValue(disk.bavail*disk.bsize >= 1073741824, 'local-storage-insufficient-space');
  const root=hostRoot+live, marker=path.join(root,'.system-bootstrapper-volume');
  // Check every existing ancestor before mkdir: recursive mkdir otherwise
  // follows an intermediate symlink before a later realpath check can refuse.
  for (const relative of ['',...liveDirectories]) {
    const selected=path.join(root,relative);
    let ancestor=selected;
    while (!fs.lstatSync(ancestor,{throwIfNoEntry:false})) ancestor=path.dirname(ancestor);
    requireValue(fs.realpathSync(ancestor) === ancestor && fs.statSync(ancestor).isDirectory(), 'unsafe-live-storage-path');
    requireValue(covering(rows,selected.slice(hostRoot.length)).target === covering(rows,'/').target,
      'nested-live-storage-mount');
  }
  if (fs.lstatSync(marker,{throwIfNoEntry:false})) requireValue(fs.lstatSync(marker).isFile() && !fs.lstatSync(marker).isSymbolicLink() &&
    fs.readFileSync(marker,'utf8') === 'system-bootstrapper-persistence-v1\n', 'unrecognized-live-storage');
  for (const relative of liveDirectories) {
    const directory=path.join(root,relative);
    requireValue(!fs.lstatSync(directory,{throwIfNoEntry:false})?.isSymbolicLink(), 'unsafe-live-storage-path');
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    requireValue(fs.realpathSync(directory) === directory, 'unsafe-live-storage-path');
  }
  fs.chmodSync(path.join(root,'wizard-public'),0o755);
  const descriptor=fs.openSync(marker,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);
  try {fs.writeFileSync(descriptor,'system-bootstrapper-persistence-v1\n');fs.fsyncSync(descriptor);} finally {fs.closeSync(descriptor);}
  console.log('Local live storage prepared.');
}
function startupAllowed(state,staged=process.env.SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER === '1') {
  const lock=path.join(state,'.storage-operation-lock');
  const upgrade=path.join(state,'.gitlab-upgrade-lock');
  if (!fs.lstatSync(lock,{throwIfNoEntry:false}) && !fs.lstatSync(upgrade,{throwIfNoEntry:false})) return;
  requireValue(staged,'storage-operation-busy');
  let identity;
  for (const directory of [lock,upgrade]) {
    requireValue(fs.lstatSync(directory,{throwIfNoEntry:false})?.isDirectory() &&
      !fs.existsSync(path.join(directory,'operation.json')) && !fs.existsSync(path.join(directory,'upgrade-owner.json')),
      'storage-operation-busy');
    const owner=path.join(directory,'controller-owner.json');
    requireValue(fs.lstatSync(owner,{throwIfNoEntry:false})?.isFile() && !fs.lstatSync(owner).isSymbolicLink(),
      'storage-operation-busy');
    let record;
    try { record=JSON.parse(fs.readFileSync(owner,'utf8')); } catch { throw Error('storage-operation-busy'); }
    requireValue(record.format === 'system-controller-operation-v1' && /^[a-f0-9]{32}$/.test(record.operation) &&
      (!identity || JSON.stringify(record) === identity),'storage-operation-busy');
    identity=JSON.stringify(record);
  }
  return JSON.parse(identity);
}
function startupBegin(state,pid) {
  const promotion=startupAllowed(state);
  if (promotion) return 'staged-'+promotion.operation;
  requireValue(/^[1-9][0-9]*$/.test(String(pid)),'invalid-startup-owner');
  const directory=path.join(state,'.storage-operation-lock'), operation=crypto.randomBytes(16).toString('hex');
  try { fs.mkdirSync(directory,{mode:0o700}); } catch { throw Error('storage-operation-busy'); }
  fs.writeFileSync(path.join(directory,'startup-owner.json'),JSON.stringify({format:'system-controller-startup-v1',operation,pid:Number(pid)})+'\n',
    {mode:0o600,flag:'wx',flush:true});
  return 'startup-'+operation;
}
function startupFinish(state,operation) {
  requireValue(/^(startup|staged)-[a-f0-9]{32}$/.test(operation || ''),'invalid-startup-owner');
  if (operation.startsWith('staged-')) {
    const promotion=startupAllowed(state);
    requireValue(promotion?.operation === operation.slice(7),'startup-ownership-changed'); return;
  }
  const directory=path.join(state,'.storage-operation-lock'),owner=path.join(directory,'startup-owner.json');
  requireValue(fs.lstatSync(directory).isDirectory() && fs.lstatSync(owner).isFile() && !fs.lstatSync(owner).isSymbolicLink(),
    'startup-ownership-changed');
  const record=JSON.parse(fs.readFileSync(owner,'utf8'));
  requireValue(record.format === 'system-controller-startup-v1' && record.operation === operation.slice(8),
    'startup-ownership-changed');
  fs.unlinkSync(owner);fs.rmdirSync(directory);
}
function startupSettled(state,operation,exitCode) {
  // Signals and killed/unknown children retain the barrier. A cleanly ended
  // startup attempt may retry without erasing a subsequent operation's lease.
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode >= 128 || !/^startup-[a-f0-9]{32}$/.test(operation || '')) return;
  const owner=path.join(state,'.storage-operation-lock/startup-owner.json');
  if (!fs.lstatSync(owner,{throwIfNoEntry:false})) return;
  requireValue(fs.lstatSync(owner).isFile() && !fs.lstatSync(owner).isSymbolicLink(),'startup-ownership-changed');
  const record=JSON.parse(fs.readFileSync(owner,'utf8'));
  if (record.operation === operation.slice(8)) startupFinish(state,operation);
}
function imageFromConfiguration(raw,fallback='') {
  requireValue(Buffer.isBuffer(raw) && raw[807] === 36 &&
    crypto.createHash('md5').update(raw.subarray(0,1184)).digest('hex') === 'bd4a8426355824593a5e21ad759830c1','configuration-cube-mismatch');
  const result=spawnSync('bash',['-s'],
    {input:Buffer.concat([Buffer.from('set -eu\n'),raw,Buffer.from('\nprintf "%s" "${GITLAB_IMAGE-}"\n')]),
      env:{...process.env,GITLAB_IMAGE:fallback},encoding:'utf8',maxBuffer:65536});
  requireValue(result.status === 0 && (!result.stdout || /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/.test(result.stdout)),
    'matching-configuration-backup-required');
  return result.stdout;
}
function configurationImage(spec) {
  let raw;
  if (spec.backup) {
    const extracted=spawnSync('unzip',['-p','/system/bootstrapper.zip','.docker.env'],{encoding:'buffer',maxBuffer:5000000});
    requireValue(!extracted.error && extracted.status === 0,'invalid-configuration-backup'); raw=extracted.stdout;
  } else raw=fs.readFileSync('/live/configuration/.docker.env');
  let image=imageFromConfiguration(raw,spec.GITLAB_IMAGE || '');
  if (!image && spec.operation === 'restore') {
    // A Seed is an explicit versioned input, never a request for a default or
    // latest image. Validate every payload byte before using its recorded pin;
    // the caller separately checks that exact local image's content identity.
    const snapshot=require('./seed-manifest').current('/seed',false);
    image=JSON.parse(fs.readFileSync(path.join(snapshot,'manifest.json'),'utf8')).gitlabImage;
  }
  requireValue(typeof image === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/.test(image),'matching-configuration-backup-required');
  return image;
}
function gitlabOwnership(spec,image,run=execute) {
  const present=run(['container','ls','--all','--filter','name=^/system_gitlab_1$','--format','{{.Names}}']);
  if (!present) { requireValue(spec.operation === 'restore','controlled-gitlab-is-missing'); return; }
  requireValue(present === 'system_gitlab_1','ambiguous-controlled-gitlab');
  const row=JSON.parse(run(['inspect','system_gitlab_1']))[0];
  requireValue(row.Config.Labels?.['com.docker.compose.project'] === 'system' &&
    row.Config.Labels?.['com.docker.compose.service'] === 'gitlab', 'unowned-gitlab-container');
  requireValue(row.Image === run(['image','inspect','--format','{{.Id}}',image]), 'gitlab-image-does-not-match-configuration');
  for (const [destination,relative] of [['/etc/gitlab','config'],['/var/log/gitlab','logs'],['/var/opt/gitlab','data']]) {
    const matches=row.Mounts.filter(mount=>mount.Destination === destination);
    requireValue(matches.length === 1 && matches[0].RW === true,'gitlab-live-mount-is-missing');
    let selected=matches[0].Source;
    if (matches[0].Type === 'volume') {
      const volume=JSON.parse(run(['volume','inspect',matches[0].Name]))[0], options=volume.Options || {};
      requireValue(options.type === 'none' && options.o === 'bind','gitlab-volume-is-not-a-live-bind'); selected=options.device;
    } else requireValue(matches[0].Type === 'bind','gitlab-volume-is-not-a-live-bind');
    requireValue(selected === spec.PERSISTENT_DIR+'/gitlab/'+relative,'gitlab-writers-use-different-live-storage');
  }
  if (spec.operation === 'restore') requireValue(row.State.Running === false,'stop-gitlab-before-restore');
}
function statusIdle(status) {
  // Harvest itself is an active API operation; all other queues must already
  // have drained after the global barrier prevents accepting any new work.
  return ['projectOperationInProgress','runnerSetupInProgress','defaultWizardSetupInProgress','needRestart']
    .every(key=>status[key] === false);
}
function controllerIdle(spec,run=execute) {
  const output=run(['exec',spec.SYSTEM_WIZARD_CANONICAL_CONTROLLER || 'system_bootstrapper_1','bash','-ec',
    'set -a; source "${SYSTEM_CONFIG_DIR:-/state}/sync-auth.env"; if [[ -f "${SYSTEM_CONFIG_DIR:-/state}/.docker.env" ]]; then source "${SYSTEM_CONFIG_DIR:-/state}/.docker.env"; fi; exec node /system/system/seed-operation.js sync-status'],
    {timeout:15000});
  let status;
  try { status=JSON.parse(output); } catch { throw Error('controller-status-unavailable'); }
  requireValue(status.idle === true,'controller-operation-busy');
}
async function syncStatus() {
  const http=require('node:http');
  const request=(route,method,body,token)=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:8071,path:route,method,
      headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},signal:AbortSignal.timeout(5000)},res=>{
      let raw='';res.on('data',part=>{raw+=part;if(raw.length>16384)req.destroy();});
      res.on('error',()=>reject(Error('controller-status-unavailable')));
      res.on('end',()=>{try{requireValue(res.statusCode===200,'controller-status-unavailable');resolve(JSON.parse(raw));}
        catch{reject(Error('controller-status-unavailable'));}});
    });
    req.on('error',()=>reject(Error('controller-status-unavailable')));req.end(body);
  });
  const auth=await request('/login','POST',JSON.stringify({username:process.env.SYNC_USER,password:process.env.SYNC_PASS}));
  requireValue(typeof auth.accessToken==='string','controller-status-unavailable');
  return {idle:statusIdle(await request('/status','GET',undefined,auth.accessToken))};
}
function validateBackup(filename) {
  const names=spawnSync('unzip',['-Z1',filename],{encoding:'utf8',maxBuffer:1024*1024});
  const listed=(names.stdout || '').trim().split('\n');
  requireValue(!names.error && names.status === 0 && listed.length <= 1000 && new Set(listed).size === listed.length &&
    listed.includes('.docker.env') && listed.every(name=>
    /^(?:bootstrapper\.json|\.docker\.env|\.projects\.env\/(?:[A-Za-z0-9_.-]+\.env)?)$/.test(name)), 'invalid-configuration-backup');
  const metadata=spawnSync('unzip',['-Z','-l',filename],{encoding:'utf8',maxBuffer:1024*1024});
  const entries=(metadata.stdout || '').split('\n').filter(line=>/^\S[rwxstST-]{9}\s/.test(line));
  requireValue(!metadata.error && metadata.status === 0 && entries.length === listed.length &&
    // ZIP writers may omit Unix file-type bits ('?'); unzip treats those as
    // ordinary files. Explicit symlink/device/FIFO types are always refused.
    entries.every(line=>['-','d','?'].includes(line[0])), 'unsafe-configuration-backup-entry');
  const total=entries.reduce((sum,line)=>sum+Number(line.trim().split(/\s+/)[3]),0);
  requireValue(Number.isFinite(total) && total <= 50000000,'configuration-backup-is-too-large');
}
class StorageLease {
  constructor(state,spec) {
    this.spec=spec; this.directory=path.join(state,'.storage-operation-lock');
    this.owner=path.join(this.directory,'operation.json');
    this.environment=path.join(state,'.projects.env/.wizard.env.environments.lock');
    this.environmentHeld=false;
    try { fs.mkdirSync(this.directory,{mode:0o700}); } catch { throw Error('storage-operation-busy'); }
    this.record('running');
  }
  record(completion) {
    fs.writeFileSync(this.owner,JSON.stringify({format:'system-storage-operation-v1',helperName:this.spec.helperName,
      imageId:this.spec.imageId,operation:this.spec.operation,completion})+'\n',{mode:0o600,flush:true});
  }
  acquireEnvironment() {
    fs.mkdirSync(path.dirname(this.environment),{recursive:true,mode:0o700});
    try { fs.mkdirSync(this.environment,{mode:0o700}); } catch { throw Error('storage-operation-busy'); }
    this.environmentHeld=true;
  }
  release(safe) {
    if (!safe) { this.record('uncertain'); return; }
    if (this.environmentHeld) fs.rmdirSync(this.environment);
    fs.unlinkSync(this.owner); fs.rmdirSync(this.directory);
  }
}
function inside(spec) {
  const selected=validate(spec);
  for (const [host,container] of [[selected.live,'/live'],[selected.seed,'/seed'],
    [selected.live+'/gitlab/config','/srv/gitlab/config'],[selected.live+'/gitlab/logs','/srv/gitlab/log'],
    [selected.live+'/gitlab/data','/srv/gitlab/data']]) {
    const expected=fs.statSync('/host'+host), actual=fs.statSync(container);
    requireValue(expected.dev === actual.dev && expected.ino === actual.ino,'operation-bind-source-changed');
  }
  requireValue(fs.readFileSync('/live/.system-bootstrapper-volume','utf8') === 'system-bootstrapper-persistence-v1\n', 'unrecognized-live-storage');
  const state='/live/configuration', lease=path.join(state,'.storage-operation-lock');
  requireValue(!fs.existsSync(lease) && !fs.existsSync(path.join(state,'.gitlab-upgrade-lock')) &&
    !fs.existsSync(path.join(state,'.projects.env/.wizard.env.environments.lock')) &&
    !fs.existsSync('/seed/.operation-lock'), 'storage-operation-busy');
  const manifest=require('./seed-manifest');
  if (spec.backup) validateBackup('/system/bootstrapper.zip');
  const image=configurationImage(spec);
  process.env.GITLAB_IMAGE=image;
  gitlabOwnership(spec,image);
  if (spec.operation === 'restore') {
    restoreEmpty();
    let current;
    try { current=manifest.current('/seed'); } catch { throw Error('seed-payload-invalid'); }
    const recorded=JSON.parse(fs.readFileSync(path.join(current,'manifest.json'),'utf8'));
    requireValue(execute(['image','inspect','--format','{{.Id}}',image]) === recorded.gitlabImageId,'seed-image-identity-mismatch');
    const size=recorded.entries.reduce((total,entry)=>total+(entry.size || 0),0);
    const space=fs.statfsSync('/live');
    requireValue(space.bavail*space.bsize > size*1.25+16*1024*1024,'live-target-insufficient-space');
  }
  const writable=fs.statfsSync('/seed');
  requireValue(writable.bavail*writable.bsize > 16*1024*1024, 'seed-target-insufficient-space');
  if (spec.operation === 'harvest') {
    const size=spawnSync('du',['-sk','/live/gitlab','/live/ssl','/live/host/letsencrypt'],{encoding:'utf8'});
    requireValue(size.status === 0, 'cannot-measure-backup-inputs');
    const bytes=size.stdout.trim().split('\n').reduce((total,line)=>total+Number(line.split(/\s/)[0])*1024,0);
    requireValue(Number.isFinite(bytes) && writable.bavail*writable.bsize > bytes*1.25+16*1024*1024, 'seed-target-insufficient-space');
  }
  if (spec.checkOnly) { console.log('Seed operation preflight passed.'); return; }
  const held=new StorageLease(state,spec);
  let succeeded=false, safeRelease=true;
  try {
    if (spec.operation === 'restore') restoreEmpty();
    requireValue(!fs.existsSync(path.join(state,'.gitlab-upgrade-lock')), 'storage-operation-busy');
    gitlabOwnership(spec,image);
    held.acquireEnvironment();
    if (spec.operation === 'harvest') controllerIdle(spec);
    if (spec.backup) {
      requireValue(spec.operation === 'restore' && !fs.existsSync(path.join(state,'.docker.env')), 'restore-configuration-already-exists');
      const imported=spawnSync('bash',['push.sh'],{cwd:'/system/system',env:{...process.env,SYSTEM_CONFIG_DIR:state},stdio:'inherit'});
      requireValue(imported.status === 0, 'configuration-restore-failed');
    }
    const main=path.join(state,'.docker.env');
    requireValue(fs.existsSync(main), 'matching-configuration-backup-required');
    const raw=fs.readFileSync(main);
    requireValue(raw[807] === 36 && crypto.createHash('md5').update(raw.subarray(0,1184)).digest('hex') === 'bd4a8426355824593a5e21ad759830c1', 'configuration-cube-mismatch');
    const env={...process.env,SYSTEM_SEED_HELPER:'1',SYSTEM_CONFIG_DIR:state,SEED_ROOT:'/seed',SERVICE_DATA_DIR:'/srv',
      TLS_DATA_DIR:'/live/ssl',LETSENCRYPT_DATA_DIR:'/live/host/letsencrypt'};
    const script='set -e; set -a; source "$1"; export GITLAB_CONTAINER=system_gitlab_1; exec bash "$2"';
    safeRelease=false;
    const result=spawnSync('bash',['-c',script,'seed-operation',main,'/system/system/'+(spec.operation==='harvest'?'harvest.sh':'seed.sh')],
      {env,stdio:'inherit',timeout:3500000});
    safeRelease=!result.error && result.status !== null && result.signal === null;
    requireValue(!result.error && result.status === 0, 'seed-copy-failed');
    succeeded=true;
  } finally {
    held.release(safeRelease);
  }
  if (succeeded) console.log('Seed operation completed on '+selected.mode+' live storage.');
}
module.exports={absolute,disjoint,mountRows,covering,validate,configuration,helperArguments,restoreEmpty,prepareLocal,startupAllowed,startupBegin,startupFinish,startupSettled,validateBackup,imageFromConfiguration,gitlabOwnership,statusIdle,controllerIdle,StorageLease,inside,launch};
if (require.main === module) {
  try {
    const [action,operation,...args]=process.argv.slice(2);
    if (action === 'inside') inside(JSON.parse(process.env.SYSTEM_STORAGE_SPEC));
    else if (action === 'validate') validate(JSON.parse(process.env.SYSTEM_STORAGE_SPEC));
    else if (action === 'prepare-local') prepareLocal(process.env);
    else if (action === 'startup-check') startupAllowed(process.env.SYSTEM_CONFIG_DIR || '/state');
    else if (action === 'startup-begin') console.log(startupBegin(process.env.SYSTEM_CONFIG_DIR || '/state',operation));
    else if (action === 'startup-finish') startupFinish(process.env.SYSTEM_CONFIG_DIR || '/state',process.env.SYSTEM_STARTUP_OPERATION);
    else if (action === 'startup-settled') startupSettled(process.env.SYSTEM_CONFIG_DIR || '/state',process.env.SYSTEM_STARTUP_OPERATION,Number(operation));
    else if (action === 'sync-status') syncStatus().then(value=>console.log(JSON.stringify(value))).catch(()=>{
      console.error('Seed operation failed: controller-status-unavailable.');process.exitCode=1;
    });
    else if (action === 'launch' || action === 'host') launch(operation,{host:action==='host',checkOnly:args.includes('--check-only'),backup:process.env.SYSTEM_SEED_CONFIGURATION_BACKUP || ''});
    else throw Error('invalid-seed-operation');
  } catch (error) {
    const code=/^[a-z][a-z0-9-]+$/.test(error.message) ? error.message:'seed-operation-failed';
    console.error('Seed operation failed: '+code+'.');
    process.exitCode=process.argv[2] === 'startup-begin' && code === 'storage-operation-busy' ? 75:1;
  }
}
