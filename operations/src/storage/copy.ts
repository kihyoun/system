import fs from 'node:fs';
import path from 'node:path';
import {ProcessRunner, nativeProcess, ProcessFailure} from '../runtime/process';
import {StorageError, requireValue} from './types';
import * as manifest from './manifest';

export interface CopyPaths {seed: string; srv: string; ssl: string; certbot: string; gitlab: string}
export interface CopyRuntime {
  process: ProcessRunner;
  monotonicSeconds(): number;
  wait(milliseconds: number): void;
  log(message: string): void;
}
export const nativeCopyRuntime: CopyRuntime = {
  process: nativeProcess,
  monotonicSeconds: () => Math.floor(Number(fs.readFileSync('/proc/uptime','utf8').split(' ')[0])),
  wait: milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,milliseconds),
  log: message => console.error(message),
};
export function copyPaths(environment: NodeJS.ProcessEnv = process.env): CopyPaths {
  return {seed:environment.SEED_ROOT || '/seed',srv:environment.SERVICE_DATA_DIR || '/srv',
    ssl:environment.TLS_DATA_DIR || '/ssl',certbot:environment.LETSENCRYPT_DATA_DIR || '/host-letsencrypt',
    gitlab:environment.GITLAB_CONTAINER || 'system_gitlab_1'};
}
// These bounded snippets run inside GitLab's supported runit environment.
// The host operation and deadline decisions belong to TypeScript.
export const servicesDown = `found=false
for service in /opt/gitlab/service/*; do
 [ -L "$service" ] || continue
 found=true
 state=$(/opt/gitlab/embedded/bin/sv status "$service")
 case "$state" in down:\\ *) ;; *) exit 1 ;; esac
done
[ "$found" = true ]`;
export const servicesUp = `found=false
failed=0
for service in /opt/gitlab/service/*; do
 [ -L "$service" ] || continue
 found=true
 /opt/gitlab/embedded/bin/sv u "$service" >/dev/null || failed=1
done
[ "$found" = true ] && [ "$failed" = 0 ]`;
export const quiesceServices = `read -r uptime rest </proc/uptime
remaining=$(($1 - \${uptime%%.*}))
code=124
if [ "$remaining" -gt 0 ] && [ "$remaining" -le 120 ]; then
 code=0
 timeout -k 1 "$remaining" gitlab-ctl stop >/dev/null 2>&1 || code=$?
fi
printf "harvest-quiesce-exit:%s\\n" "$code"`;
function state(text: string) {
  const match=/^(true|false) ([0-9]{1,3}) (true|false)$/.exec(text.trim());
  requireValue(match && Number(match[2]) <= 255,'gitlab-state-unavailable');
  return {running:match[1]==='true',exitCode:Number(match[2]),oomKilled:match[3]==='true'};
}
function copy(runtime: CopyRuntime, source: string, destination: string, exclude?: string) {
  runtime.process.run('rsync',['-a','--no-specials','--no-devices','--fsync','--delete',
    ...(exclude?['--exclude='+exclude]:[]),source+'/',destination+'/'],{timeout:3500000});
}
export function harvest(paths: CopyPaths=copyPaths(),runtime: CopyRuntime=nativeCopyRuntime,certificateToken?: string): void {
  const {seed,srv,ssl,certbot,gitlab}=paths;
  for (const directory of [srv,ssl,certbot]) requireValue(fs.statSync(directory).isDirectory(),'harvest-source-missing');
  requireValue(!fs.existsSync(path.join(srv,'gitlab/data/.system-bootstrapper-restore-incomplete')),'restore-incomplete');
  // The outer storage preflight must have validated an existing backup filesystem.
  requireValue(fs.statSync(seed).isDirectory(),'seed-target-unavailable');
  const seedLock=path.join(seed,'.operation-lock'),certificateLock=path.join(certbot,'.system-bootstrapper-certificate-lock');
  try {fs.mkdirSync(seedLock,{mode:0o700});} catch {throw new StorageError('seed-operation-busy');}
  let stage='',resume=false,touched=false,quiesced=false,certificateHeld=false;
  let quiesceDeadline=0,phase='certificate-lock',failure: unknown,uncertain=false;
  const run=(args: string[],timeout=15000)=>runtime.process.run('docker',args,{timeout}).stdout.trim();
  try {
    if(certificateToken) {
      requireValue(/^[a-f0-9]{48}$/.test(certificateToken) && fs.readFileSync(path.join(certificateLock,'coordinated-owner'),'utf8')===certificateToken,'certificate-lease-unavailable');
    } else {fs.mkdirSync(certificateLock,{mode:0o700});certificateHeld=true;}
    const deadline=runtime.monotonicSeconds()+120;
    const stop=(args: string[])=> {
      const remaining=deadline-runtime.monotonicSeconds()-1;
      requireValue(remaining>0,'gitlab-stop-deadline'); return run(args,remaining*1000);
    };
    phase='gitlab-inspect';
    const running=stop(['inspect','--format','{{.State.Running}}',gitlab]);
    requireValue(['true','false'].includes(running),'gitlab-state-unavailable');
    process.env.GITLAB_IMAGE_ID=stop(['inspect','--format','{{.Image}}',gitlab]);
    process.env.GITLAB_IMAGE=stop(['inspect','--format','{{.Config.Image}}',gitlab]);
    if(running==='true') {
      resume=true;phase='gitlab-quiesce';
      const budget=deadline-runtime.monotonicSeconds()-8;
      requireValue(budget>3,'gitlab-stop-deadline');quiesceDeadline=deadline-12;touched=true;
      const response=run(['exec','--env','SVWAIT=90',gitlab,'/bin/sh','-ec',quiesceServices,'sh',String(quiesceDeadline)],budget*1000);
      const witness=/^harvest-quiesce-exit:(0|[1-9][0-9]{0,2})$/.exec(response);
      requireValue(witness && Number(witness[1])<=255,'gitlab-quiesce-unconfirmed');
      quiesced=true;if(witness[1]!=='0')throw Object.assign(new StorageError('gitlab-quiesce-failed'),{exitCode:Number(witness[1])});
      phase='gitlab-services-down';stop(['exec',gitlab,'/bin/sh','-ec',servicesDown]);
      phase='gitlab-stop';const remaining=deadline-runtime.monotonicSeconds()-3;
      requireValue(remaining>0,'gitlab-stop-deadline');stop(['stop','--time',String(remaining),gitlab]);
    }
    phase='gitlab-stopped-check';const terminal=state(stop(['inspect','--format','{{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}}',gitlab]));
    runtime.log(`Harvest GitLab state: running=${terminal.running} exitCode=${terminal.exitCode} oomKilled=${terminal.oomKilled}.`);
    requireValue(!terminal.running,'gitlab-still-running');phase='gitlab-clean-exit';
    requireValue(terminal.exitCode===0&&!terminal.oomKilled,'gitlab-unclean-exit');
    phase='stage-create';stage=fs.mkdtempSync(path.join(seed,'.harvest-'));
    for(const name of ['srv','ssl','letsencrypt'])fs.mkdirSync(path.join(stage,name),{mode:0o700});
    phase='srv-copy';copy(runtime,srv,path.join(stage,'srv'));
    phase='ssl-copy';copy(runtime,ssl,path.join(stage,'ssl'));
    phase='certbot-copy';copy(runtime,certbot,path.join(stage,'letsencrypt'),'.system-bootstrapper-certificate-lock');
    phase='manifest-create';manifest.create(stage);
    phase='snapshot-publish';manifest.publish(seed,stage);stage='';
  } catch(error) {failure=error;if(phase==='gitlab-stopped-check')runtime.log('Harvest GitLab state: unavailable.');uncertain=error instanceof ProcessFailure && error.uncertain;runtime.log('Harvest phase failed: '+phase+'.');}
  finally {
    // A stopped Docker client is not a witness that its remote command completed.
    if(touched&&!quiesced)while(runtime.monotonicSeconds()<=quiesceDeadline+2)runtime.wait(1000);
    if(resume) {
      try {
        const running=run(['inspect','--format','{{.State.Running}}',gitlab],4000);
        if(running==='false')run(['start',gitlab],14000);
        else {requireValue(running==='true','gitlab-state-unavailable');if(touched)run(['exec',gitlab,'timeout','-k','1','10','/bin/sh','-ec',servicesUp],14000);}
      } catch(error) {uncertain ||= error instanceof ProcessFailure && error.uncertain;runtime.log('GitLab restart failed after Harvest.');const primary=failure;failure=Object.assign(new StorageError('gitlab-restart-failed',uncertain),{exitCode:primary instanceof ProcessFailure?primary.status:primary instanceof Error&&'exitCode' in primary?primary.exitCode:1});}
    }
    // In-flight rsync may still own files on a killed worker. Do not erase its stage or barriers.
    if(!uncertain) {
      try {if(certificateHeld)fs.rmdirSync(certificateLock);if(stage)fs.rmSync(stage,{recursive:true});fs.rmdirSync(seedLock);}
      catch {failure=new StorageError('harvest-cleanup-failed');}
    }
  }
  if(failure)throw failure;
  runtime.log('Harvest completed; previous snapshots remain available.');
}
export function restore(paths: CopyPaths=copyPaths(),runtime: CopyRuntime=nativeCopyRuntime): void {
  const {seed,srv,ssl,certbot,gitlab}=paths;
  const current=path.join(seed,'current');
  if(!fs.lstatSync(current,{throwIfNoEntry:false})&&!fs.existsSync(path.join(seed,'srv'))&&!fs.existsSync(path.join(seed,'ssl'))) {
    runtime.log('No seed found; continuing without restore.');return;
  }
  const seedLock=path.join(seed,'.operation-lock'),certificateLock=path.join(certbot,'.system-bootstrapper-certificate-lock');
  fs.mkdirSync(seedLock,{mode:0o700});let held=false,failure: unknown;
  const run=(args: string[])=>runtime.process.run('docker',args).stdout.trim();
  try {
    run(['info']);const container=run(['ps','-aq','--filter','name=^/'+gitlab+'$']);
    requireValue(!container||run(['inspect','--format','{{.State.Running}}',gitlab])==='false','stop-gitlab-before-restore');
    requireValue(fs.lstatSync(current,{throwIfNoEntry:false}),'legacy-seed-incomplete');
    const source=manifest.current(seed),record=manifest.verify(source);
    requireValue(record.gitlabImageId&&process.env.GITLAB_IMAGE&&run(['image','inspect','--format','{{.Id}}',process.env.GITLAB_IMAGE])===record.gitlabImageId,'seed-image-identity-mismatch');
    fs.mkdirSync(certbot,{recursive:true,mode:0o700});fs.mkdirSync(certificateLock,{mode:0o700});held=true;
    fs.mkdirSync(path.join(srv,'gitlab/data'),{recursive:true,mode:0o700});fs.mkdirSync(ssl,{recursive:true,mode:0o700});
    manifest.markRestore(srv);
    copy(runtime,path.join(source,'srv'),srv,'.system-bootstrapper-restore-incomplete');
    copy(runtime,path.join(source,'ssl'),ssl);
    copy(runtime,path.join(source,'letsencrypt'),certbot,'.system-bootstrapper-certificate-lock');
    manifest.finishRestore(source,srv,ssl,certbot);
  } catch(error) {failure=error;}
  finally {
    if(!(failure instanceof ProcessFailure&&failure.uncertain)) {
      try {if(held)fs.rmdirSync(certificateLock);fs.rmdirSync(seedLock);}catch {failure=new StorageError('restore-cleanup-failed');}
    }
  }
  if(failure)throw failure;
  runtime.log('Ready. Install host TLS renewal integration before starting services.');
}
