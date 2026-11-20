import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {nativeProcess, type ProcessRunner} from '../runtime/process';
import {imageId, revision, readSourceIdentity, record} from '../release/source-identity';

export function requireValue(value: unknown, code: string): asserts value { if (!value) throw Error(code); }
export type InstalledSource = {sourceCommit: string; sourceTree?: string; wizardSourceRevision?: string; sourceLayout?: 'system-monorepo-v1'; wizardSourceTree?: string};
export interface SelectedImage {reference: string; imageId: string; candidateJobId: number; platform: 'linux/amd64'}
export interface AcceptedMetadata {format: string; version: string; tag: string; platform: string; source: {revision: string; tree: string; wizardRevision?: string; sourceLayout?: string; wizardSourceTree?: string}; images: Record<'controller'|'wizard',{reference: string;imageId: string;configDigest: string}>; acceptance: {candidateJobId: number;controllerWizardSameAttempt: boolean;requiredChecksPassed: boolean}}
export interface InstallOptions {controller: string;wizard: string;persistenceEnv: string;releaseMetadata?: string;installHost?: boolean}
const docker = ['--host=unix:///var/run/docker.sock'];
const keys = ['PERSISTENCE_MODE','PERSISTENT_MOUNT','PERSISTENT_DIR','PERSISTENT_UUID'];
const pattern = /^(?:docker\.io\/)?([a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9._-]*)@sha256:([a-f0-9]{64})$/;
export function reference(input: unknown): string {
  const match = typeof input === 'string' && input.length<=300 && !input.includes('\n') && pattern.exec(input);
  requireValue(match && !match[1].startsWith('localhost/'),'public-dockerhub-digest-required');
  return 'docker.io/'+match[1]+'@sha256:'+match[2];
}
export function sourceIdentity(commit: string,tree: string,entry: string): InstalledSource {
  requireValue(revision(commit)&&revision(tree),'release-source-identities-required');
  const gitlink=/^160000 commit ([a-f0-9]{40})\twizard$/.exec(entry);
  if(gitlink)return {sourceCommit:commit,sourceTree:tree,wizardSourceRevision:gitlink[1]};
  const source=/^040000 tree ([a-f0-9]{40})\twizard$/.exec(entry);
  requireValue(source,'release-source-identities-required');
  return {sourceCommit:commit,sourceTree:tree,sourceLayout:'system-monorepo-v1',wizardSourceTree:source[1]};
}
function canonical(filename: string): string {
  if(fs.lstatSync(filename,{throwIfNoEntry:false}))return fs.realpathSync(filename);
  const parent=path.dirname(filename);
  return path.join(canonical(parent),path.basename(filename));
}
export function privateFile(filename: string): void {
  const stat=fs.lstatSync(filename);
  requireValue(stat.isFile()&&!stat.isSymbolicLink(),'private-file-must-be-regular');
  requireValue(stat.uid===0&&(stat.mode&0o777)===0o600,'private-file-must-be-root-owned-mode-0600');
}
export function writePrivate(filename: string,data: Buffer): void {
  if(fs.lstatSync(filename,{throwIfNoEntry:false}))privateFile(filename);
  const temporary=path.join(path.dirname(filename),'.'+path.basename(filename)+'-'+crypto.randomBytes(12).toString('hex'));
  try {
    fs.writeFileSync(temporary,data,{mode:0o600,flag:'wx',flush:true});fs.renameSync(temporary,filename);
    const fd=fs.openSync(path.dirname(filename),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    try {fs.fsyncSync(fd);}finally {fs.closeSync(fd);}
  } finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
export function fresh(root: string,checkout: string): void {
  const exists=(name: string)=>!!fs.lstatSync(name,{throwIfNoEntry:false});
  requireValue(!exists(path.join(root,'configuration/.docker.env'))&&!exists(path.join(checkout,'system/.docker.env')),'fresh-install-saved-configuration-exists');
  for(const name of ['gitlab/config','gitlab/logs','gitlab/data']) {
    const directory=path.join(root,name),stat=fs.lstatSync(directory,{throwIfNoEntry:false});
    requireValue(!stat?.isSymbolicLink(),'fresh-install-unsafe-service-directory');
    requireValue(!stat||stat.isDirectory()&&fs.readdirSync(directory).length===0,'fresh-install-gitlab-data-exists');
  }
  for(const name of ['configuration/.storage-operation-lock','configuration/.gitlab-upgrade-lock','gitlab/data/.system-bootstrapper-restore-incomplete'])
    requireValue(!exists(path.join(root,name)),'unfinished-operation-blocks-fresh-install');
}
export function checkedImage(selected: string,identity: InstalledSource,rows: unknown,wizard=false): SelectedImage {
  selected=reference(selected);
  requireValue(identity.sourceLayout===undefined&&!identity.wizardSourceTree||identity.sourceLayout==='system-monorepo-v1'&&revision(identity.wizardSourceTree)&&identity.wizardSourceRevision===undefined,'release-source-identities-required');
  requireValue(Array.isArray(rows)&&rows.length===1,'invalid-release-image-inspection');
  const image=record(rows[0]);
  requireValue(Array.isArray(image.RepoDigests)&&image.RepoDigests.some(value=>{try{return reference(value)===selected;}catch{return false;}}),'release-pulled-repository-digest-mismatch');
  requireValue(imageId(image.Id),'release-image-id-required');
  requireValue(image.Os==='linux'&&image.Architecture==='amd64','release-platform-must-be-linux-amd64');
  const labels=record(record(image.Config).Labels),job=labels['org.system-bootstrapper.test-job'];
  requireValue(typeof job==='string'&&/^[1-9][0-9]*$/.test(job)&&Number.isSafeInteger(Number(job)),'release-candidate-job-required');
  const expected=wizard&&identity.sourceLayout!=='system-monorepo-v1'?identity.wizardSourceRevision:identity.sourceCommit;
  requireValue(revision(expected)&&labels['org.opencontainers.image.revision']===expected,'release-image-source-mismatch');
  if(wizard)requireValue(labels['org.system-bootstrapper.source-revision']===identity.sourceCommit,'wizard-release-system-source-mismatch');
  return {reference:selected,imageId:image.Id,candidateJobId:Number(job),platform:'linux/amd64'};
}
export function acceptedMetadata(filename: string|undefined,identity: InstalledSource,controller: string,wizard: string): AcceptedMetadata|undefined {
  if(!filename)return undefined;
  const stat=fs.lstatSync(filename);
  requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1024*1024,'regular-bounded-public-release-metadata-required');
  const value=JSON.parse(fs.readFileSync(filename,'utf8')) as AcceptedMetadata;
  requireValue(value.format==='system-accepted-release-v1'&&/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(value.version)&&value.tag==='v'+value.version&&value.platform==='linux/amd64','accepted-product-version-required');
  const source=readSourceIdentity({sourceRevision:value.source?.revision,sourceTree:value.source?.tree,sourceLayout:value.source?.sourceLayout,wizardSourceTree:value.source?.wizardSourceTree,wizardRevision:value.source?.wizardRevision});
  const expected=readSourceIdentity({sourceRevision:identity.sourceCommit,sourceTree:identity.sourceTree,sourceLayout:identity.sourceLayout,wizardSourceTree:identity.wizardSourceTree,wizardRevision:identity.wizardSourceRevision});
  requireValue(JSON.stringify(source)===JSON.stringify(expected),'public-release-source-mismatch');
  for(const [role,selected] of [['controller',controller],['wizard',wizard]] as const) {
    const row=value.images?.[role];requireValue(row&&reference(row.reference)===selected&&imageId(row.imageId)&&imageId(row.configDigest),'public-release-paired-image-mismatch');
  }
  const acceptance=value.acceptance;
  requireValue(acceptance?.controllerWizardSameAttempt===true&&acceptance.requiredChecksPassed===true&&Number.isSafeInteger(acceptance.candidateJobId)&&acceptance.candidateJobId>0,'public-release-accepted-attempt-required');
  return value;
}
/** flock is the native advisory-lock primitive. The inherited descriptor shares
 * the parent's open-file description, so the parent retains its lock on return. */
export function initializationGuard(directory: string): ()=>void {
  fs.mkdirSync(directory,{mode:0o700,recursive:true});requireValue(!fs.lstatSync(directory).isSymbolicLink(),'unsafe-host-initialization-lock-directory');
  const fd=fs.openSync(path.join(directory,'initialize.lock'),fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
  try {
    const result=spawnSync('flock',['--exclusive','--nonblock','3'],{stdio:['ignore','pipe','pipe',fd],timeout:10000});
    requireValue(!result.error&&result.status===0,'another-host-initialization-is-running');
    return ()=>fs.closeSync(fd);
  }catch(error){fs.closeSync(fd);throw error;}
}
export class HostInstallService {
  constructor(readonly runner: ProcessRunner=nativeProcess, readonly environment: NodeJS.ProcessEnv=process.env,
    readonly guard: ()=>()=>void=()=>initializationGuard('/run/system-bootstrapper'),readonly rootUser=()=>process.geteuid?.()===0, readonly deadline?: number) {}
  run(binary: string,args: string[],environment?: NodeJS.ProcessEnv,timeout=300000): string {
    const env: NodeJS.ProcessEnv={...(environment||this.environment),DOCKER_HOST:'unix:///var/run/docker.sock'};
    for(const key of ['DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
    if(this.deadline!==undefined){requireValue(Number.isFinite(this.deadline)&&this.deadline>Date.now(),'operation-readiness-deadline-expired');timeout=Math.min(timeout,this.deadline-Date.now());}
    try{return this.runner.run(binary,args,{env,timeout:Math.max(1,Math.floor(timeout)),maxBuffer:4*1024**2}).stdout;}catch{throw Error('command-failed:'+path.basename(binary));}
  }
  source(checkout: string): InstalledSource {
    const git=(...args: string[])=>this.run('git',['-C',checkout,...args]).trim();
    requireValue(!git('status','--porcelain','--untracked-files=all','--ignore-submodules=none'),'release-checkout-is-modified');
    return sourceIdentity(git('rev-parse','HEAD'),git('rev-parse','HEAD^{tree}'),git('ls-tree','HEAD','wizard'));
  }
  storage(persistence: string,checkout: string): {selected: Record<string,string>;root: string} {
    requireValue(path.isAbsolute(persistence)&&path.resolve(persistence)!=='/','absolute-selector-path-required');
    const stat=fs.lstatSync(persistence,{throwIfNoEntry:false});requireValue(!stat?.isSymbolicLink(),'storage-selector-must-not-be-symlink');
    if(stat)privateFile(persistence);
    const script='set -eu; set -a; for file in "$@"; do source "$file"; done; '+keys.map(key=>'printf "%s\\0" "${'+key+'-}";').join(' ');
    const values=this.run('bash',['-c',script,'read-storage',...(stat?[persistence]:[]),path.join(checkout,'bootstrapper/storage-env.sh')]).split('\0');
    requireValue(values.length===keys.length+1&&values.at(-1)==='','invalid-storage-selectors');
    const selected=Object.fromEntries(keys.map((key,index)=>[key,values[index]]));
    this.run('bash',[path.join(checkout,'bootstrapper/persistence.sh')],{...this.environment,...selected,PERSISTENCE_CHECK_ONLY:'1'});
    const root=selected.PERSISTENT_DIR;
    requireValue(path.isAbsolute(root)&&root!=='/'&&canonical(root)===root,'unsafe-live-data-path');
    return {selected,root};
  }
  noExistingServices(): void {
    for(const selector of ['name=^/system_bootstrapper_1$','label=com.docker.compose.project=system'])
      requireValue(!this.run('docker',[...docker,'container','ls','--all','--filter',selector,'--format','{{.ID}}']).trim(),'fresh-install-existing-system-container');
    requireValue(!this.run('docker',[...docker,'volume','ls','--filter','name=^system_','--format','{{.Name}}']).trim(),'fresh-install-existing-system-volumes');
  }
  image(selected: string,identity: InstalledSource,wizard=false): SelectedImage {
    selected=reference(selected);this.run('docker',[...docker,'pull',selected],undefined,1800000);
    return checkedImage(selected,identity,JSON.parse(this.run('docker',[...docker,'image','inspect',selected])),wizard);
  }
  install(args: InstallOptions,checkout: string) {
    requireValue(this.rootUser(),'run-release-installer-as-root');
    const controller=reference(args.controller),wizard=reference(args.wizard),identity=this.source(checkout);
    const accepted=acceptedMetadata(args.releaseMetadata,identity,controller,wizard),{selected,root}=this.storage(args.persistenceEnv,checkout);
    fresh(root,checkout);const relative=path.relative(fs.realpathSync(checkout),root);
    requireValue(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative),'live-data-must-be-outside-checkout');
    const release=this.guard();
    try {
      fresh(root,checkout);
      if(args.installHost)this.run('bash',[path.join(checkout,'bootstrapper/install.sh')],undefined,1800000);
      this.noExistingServices();
      const pair={controller:this.image(controller,identity),wizard:this.image(wizard,identity,true)};
      requireValue(pair.controller.candidateJobId===pair.wizard.candidateJobId,'release-images-must-share-one-accepted-candidate-job');
      if(accepted)for(const role of ['controller','wizard'] as const)requireValue([accepted.images[role].imageId,accepted.images[role].configDigest,accepted.images[role].reference.split('@')[1]].includes(pair[role].imageId)&&pair[role].candidateJobId===accepted.acceptance.candidateJobId,'pulled-images-differ-from-accepted-public-attempt');
      requireValue(JSON.stringify(this.source(checkout))===JSON.stringify(identity),'release-source-changed-during-download');
      fresh(root,checkout);this.noExistingServices();
      const environment: NodeJS.ProcessEnv={...this.environment,...selected,PERSISTENCE_ENV_FILE:args.persistenceEnv};delete environment.PERSISTENCE_CHECK_ONLY;
      this.run('bash',[path.join(checkout,'bootstrapper/persistence.sh')],environment);
      const profile=path.join(root,'configuration/.release-images.env'),payload=Buffer.from('BOOTSTRAPPER_IMAGE='+controller+'\nWIZARD_IMAGE='+wizard+'\n');
      if(fs.lstatSync(profile,{throwIfNoEntry:false})){privateFile(profile);requireValue(fs.readFileSync(profile).equals(payload),'fresh-release-selection-already-differs');}
      writePrivate(profile,payload);
      const receipt=path.join(root,'configuration/.release-images.json');
      const result={schemaVersion:1,...identity,images:pair,status:'selected',selectedAt:new Date().toISOString(),...(accepted?{productRelease:{version:accepted.version,tag:accepted.tag,sourceRevision:accepted.source.revision}}:{})};
      const save=()=>writePrivate(receipt,Buffer.from(JSON.stringify(result,null,2)+'\n'));save();
      if(!fs.existsSync(args.persistenceEnv)) {
        requireValue(!fs.lstatSync(path.dirname(args.persistenceEnv),{throwIfNoEntry:false})?.isSymbolicLink(),'unsafe-storage-selector-directory');
        fs.mkdirSync(path.dirname(args.persistenceEnv),{recursive:true,mode:0o700});
        const quote=(value: string)=>"'"+value.replaceAll("'","'\\''")+"'";
        writePrivate(args.persistenceEnv,Buffer.from(Object.entries(selected).map(([key,value])=>key+'='+quote(value)+'\n').join('')));
      }
      try{this.run('bash',[path.join(checkout,'start.sh')],{...environment,SYSTEM_BOOTSTRAPPER_SKIP_BUILD:'1'},1800000);}catch(error){result.status='startup-failed';save();throw error;}
      result.status='startup-requested';save();return result;
    }finally{release();}
  }
}
