import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ProcessRunner, nativeProcess} from '../runtime/process';
import {StorageSpec, requireValue} from './types';
import {durableDirectory} from './manifest';

const fields = ['PERSISTENCE_MODE','PERSISTENT_MOUNT','PERSISTENT_DIR','PERSISTENT_UUID',
  'SEED_DIR','SEED_MOUNT','SEED_UUID','GITLAB_IMAGE','SYSTEM_WIZARD_CANONICAL_CONTROLLER'] as const;
export function cube(raw: Buffer): void {
  requireValue(raw[807]===36&&crypto.createHash('md5').update(raw.subarray(0,1184)).digest('hex')==='bd4a8426355824593a5e21ad759830c1','configuration-cube-mismatch');
}
/** Compatibility adapter for the existing operator-owned Bash assignment format.
 * This is data interpretation, not an alternate operation workflow. No caller
 * command is appended; selected variable names and output framing are fixed.
 */
export function readAssignments(filename: string, names: readonly string[], inherited: NodeJS.ProcessEnv,runner: ProcessRunner=nativeProcess): Record<string,string> {
  requireValue(names.every(name=>/^[A-Z][A-Z0-9_]*$/.test(name)),'invalid-configuration-selector');
  const print=names.map(key=>'printf "%s\\0" "${'+key+'-}";').join(' ');
  const result=runner.run('bash',['-c','set -eu; set -a; source "$1"; '+print,'read-configuration',filename],
    {env:inherited,maxBuffer:65536,timeout:10000});
  const values=result.stdout.split('\0');requireValue(values.length===names.length+1,'invalid-storage-selector');
  return Object.fromEntries(names.map((key,index)=>[key,values[index]]));
}
export function configuration(environment: NodeJS.ProcessEnv=process.env,host=false,runner: ProcessRunner=nativeProcess): StorageSpec {
  const filename=host?'/host'+(environment.PERSISTENCE_ENV_FILE||'/etc/system-bootstrapper/persistence.env'):
    path.join(environment.SYSTEM_CONFIG_DIR||'/state','.docker.env');
  const spec: StorageSpec=fs.existsSync(filename)?readAssignments(filename,fields,environment,runner):
    Object.fromEntries(fields.map(key=>[key,environment[key]||'']));
  requireValue(!host||fs.existsSync(filename),'storage-selector-unavailable');
  for(const key of fields.filter(key=>key!=='GITLAB_IMAGE'))if(!host&&Object.hasOwn(environment,key))spec[key]=environment[key];
  spec.PERSISTENCE_MODE ||=spec.PERSISTENT_MOUNT?'volume':'local';
  if(spec.PERSISTENCE_MODE==='local') {spec.PERSISTENT_MOUNT||='/';spec.PERSISTENT_DIR||='/var/lib/system-bootstrapper/platform';}
  return spec;
}
export function imageFromConfiguration(raw: Buffer,fallback='',runner: ProcessRunner=nativeProcess): string {
  cube(raw);
  const result=runner.run('bash',['-s'],{input:Buffer.concat([Buffer.from('set -eu\n'),raw,
    Buffer.from('\nprintf "%s" "${GITLAB_IMAGE-}"\n')]),env:{...process.env,GITLAB_IMAGE:fallback},maxBuffer:65536,timeout:10000});
  requireValue(!result.stdout||/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/.test(result.stdout),'matching-configuration-backup-required');
  return result.stdout;
}
export function validateBackup(filename: string,runner: ProcessRunner=nativeProcess): string[] {
  const options={maxBuffer:1024*1024,timeout:10000};
  const listed=runner.run('unzip',['-Z1',filename],options).stdout.trim().split('\n');
  requireValue(listed.length<=1000&&new Set(listed).size===listed.length&&listed.includes('.docker.env')&&listed.every(name=>
    /^(?:bootstrapper\.json|recovery\.json|RECOVERY\.md|\.docker\.env|\.projects\.env\/(?:[A-Za-z0-9_.-]+\.env)?)$/.test(name)),'invalid-configuration-backup');
  const entries=runner.run('unzip',['-Z','-l',filename],options).stdout.split('\n').map(line=>
    /^(\S[rwxstST-]{6}(?:[rwxstST-]{3})?)\s+\d+\.\d+\s+(\S+)\s+([0-9]+)\s/.exec(line)).filter((entry): entry is RegExpExecArray=>entry!==null);
  requireValue(entries.length===listed.length&&entries.every(entry=>entry[1].length===10||entry[1].length===7&&entry[2]==='fat')&&
    entries.every(entry=>['-','d','?'].includes(entry[1][0])),'unsafe-configuration-backup-entry');
  const total=entries.reduce((sum,entry)=>sum+Number(entry[3]),0);
  requireValue(Number.isFinite(total)&&total<=50000000,'configuration-backup-is-too-large');return listed;
}
function managed(data: string): boolean {
  try {const line=data.split('\n').find(value=>value.startsWith('# BOOTSTRAPPER_PROJECT='));
    if(!line)return false;const value=JSON.parse(Buffer.from(line.slice('# BOOTSTRAPPER_PROJECT='.length),'base64').toString('utf8'));
    return value.defaultProject===true&&value.template==='wizard';}catch{return false;}
}
function writePrivate(filename: string,bytes: Buffer) {
  const next=filename+'.'+crypto.randomBytes(8).toString('hex');
  try {fs.writeFileSync(next,bytes,{mode:0o600,flag:'wx',flush:true});fs.renameSync(next,filename);durableDirectory(path.dirname(filename));}
  finally {if(fs.existsSync(next))fs.unlinkSync(next);}
}
/** Restore-only import: caller owns the live and environment leases, and no
 * service writers may run. Ordinary Push/routing is a separate configuration use case. */
export function importFreshConfiguration(archive: string,state: string,runner: ProcessRunner=nativeProcess): void {
  requireValue(!fs.existsSync(path.join(state,'.docker.env')),'restore-configuration-already-exists');
  const names=validateBackup(archive,runner),stage=fs.mkdtempSync(path.join(os.tmpdir(),'system-restore-config-'));
  try {
    runner.run('unzip',['-q',archive,'-d',stage],{timeout:10000});
    for(const name of names) {const stat=fs.lstatSync(path.join(stage,name));requireValue(!stat.isSymbolicLink()&&(stat.isFile()||stat.isDirectory()),'unsafe-configuration-backup-entry');}
    const main=fs.readFileSync(path.join(stage,'.docker.env'));cube(main);
    const projects=path.join(state,'.projects.env');fs.mkdirSync(projects,{recursive:true,mode:0o700});
    const wizard=path.join(projects,'.wizard.env');
    const prior=fs.existsSync(wizard)?fs.readFileSync(wizard,'utf8'):'';
    if(fs.existsSync(path.join(stage,'.projects.env'))) {
      for(const name of fs.readdirSync(projects)) {
        if(name==='.wizard.env.environments.lock')continue;
        const selected=path.join(projects,name);
        requireValue(fs.lstatSync(selected).isFile()&&!fs.lstatSync(selected).isSymbolicLink(),'unsafe-existing-configuration');
        fs.unlinkSync(selected);
      }
      for(const name of fs.readdirSync(path.join(stage,'.projects.env')))writePrivate(path.join(projects,name),fs.readFileSync(path.join(stage,'.projects.env',name)));
      if(managed(prior))writePrivate(wizard,Buffer.from(prior));
    }
    // Publish main last: absence remains the retry signal for an interrupted import.
    writePrivate(path.join(state,'.docker.env'),main);
  } finally {fs.rmSync(stage,{recursive:true,force:true});}
}
