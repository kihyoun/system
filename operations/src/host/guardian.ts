import fs from 'node:fs';
import {spawn, type ChildProcess} from 'node:child_process';
import {writePrivate,requireValue} from './install';

interface ProcessIdentity {state:string; group:number; start:string}
function proc(pid: number): ProcessIdentity|undefined {
  try {
    const text=fs.readFileSync('/proc/'+pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+1).trim().split(/\s+/);
    return {state:fields[0],group:Number(fields[2]),start:fields[19]};
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
}
export function processStart(pid: number): string|undefined {const value=proc(pid);return value?.state==='Z'?undefined:value?.start;}
function members(group: number): number[] {
  const result=[];
  for(const name of fs.readdirSync('/proc').filter(name=>/^[0-9]+$/.test(name))) {
    try{const value=proc(Number(name));if(value&&value.group===group&&value.state!=='Z')result.push(Number(name));}
    catch(error){if(!['ENOENT','EACCES','EPERM'].includes((error as NodeJS.ErrnoException).code||''))throw error;}
  }
  return result;
}
export function groupLive(group: number): boolean {return Number.isInteger(group)&&group>0&&members(group).length>0;}
export function stopOwnedGroup(group: number,start: string|undefined,operation: string): void {
  if(!groupLive(group))return;
  const current=processStart(group);
  requireValue(!current||!start||current===start,'host-child-group-leader-identity-changed');
  const marker=Buffer.from('SYSTEM_CONTROLLER_CHILD_OWNER='+operation);
  for(const pid of members(group)) {
    try {
      const environment=fs.readFileSync('/proc/'+pid+'/environ');
      requireValue(environment.toString().split('\0').some(value=>Buffer.from(value).equals(marker)),'host-child-group-ownership-changed');
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&(error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
  }
  try{process.kill(-group,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
}
interface GuardianOptions {guardFd:number;journal:string;operation:string;timeout:number;command:string[]}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function guardCommand(args: GuardianOptions): Promise<number> {
  requireValue(args.command.length&&Number.isInteger(args.guardFd)&&args.guardFd>=0&&args.journal&&args.operation&&args.timeout>0&&args.timeout<=1800,'host-child-owner-inputs-required');
  fs.fstatSync(args.guardFd);
  const record: Record<string,unknown>={format:'system-host-child-v1',operation:args.operation,phase:'guardian-started',guardianPid:process.pid,guardianStart:processStart(process.pid),bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()};
  const publish=()=>writePrivate(args.journal,Buffer.from(JSON.stringify(record)+'\n'));
  publish();
  let child: ChildProcess|undefined,start:string|undefined,canceled=false;
  const stop=()=>{if(child?.pid)stopOwnedGroup(child.pid,start,args.operation);};
  const terminate=()=>{canceled=true;stop();};
  for(const signal of ['SIGTERM','SIGINT','SIGHUP'] as const)process.on(signal,terminate);
  try {
    const payload=fs.readFileSync(0);
    requireValue(!canceled,'host-child-canceled-before-start');
    child=spawn(process.execPath,[__filename,'--worker','--',...args.command],{detached:true,stdio:['pipe','pipe','pipe','pipe'],env:{...process.env,SYSTEM_CONTROLLER_CHILD_OWNER:args.operation}});
    requireValue(child.pid,'host-child-spawn-failed');start=processStart(child.pid);
    let timeout=false,failure:Error|undefined;
    const output:Buffer[]=[],error:Buffer[]=[];let outputSize=0;
    const capture=(target:Buffer[],bytes:Buffer)=>{outputSize+=bytes.length;if(outputSize>4*1024**2){failure=Error('host-child-output-limit');stop();}else target.push(bytes);};
    child.stdin!.on('error',()=>{failure=Error('host-child-input-failed');stop();});
    child.stdout!.on('data',bytes=>capture(output,bytes));child.stderr!.on('data',bytes=>capture(error,bytes));
    const finished=new Promise<number>((resolve,reject)=>{
      child!.once('error',reject);child!.once('close',(code,signal)=>resolve(code??(signal==='SIGKILL'?137:1)));
    });
    Object.assign(record,{phase:'running',childPid:child.pid,childStart:start,childPgid:child.pid});publish();
    requireValue(!canceled,'host-child-canceled-before-exec');
    (child.stdio[3] as NodeJS.WritableStream).end('G');child.stdin!.end(payload);
    const timer=setTimeout(()=>{timeout=true;stop();},args.timeout*1000);
    let code:number;
    try{code=await finished;}finally{clearTimeout(timer);stop();}
    const until=performance.now()+10000;
    while(groupLive(child.pid)&&performance.now()<until){stop();await sleep(20);}
    requireValue(!groupLive(child.pid),'owned-host-command-group-still-running');
    if(failure)throw failure;
    if(timeout)code=124;
    Object.assign(record,{phase:'completed',exitCode:code});publish();
    process.stdout.write(Buffer.concat(output));process.stderr.write(Buffer.concat(error));return code;
  } finally {
    try{
      stop();
      const deadline=performance.now()+10000;
      while(child?.pid&&groupLive(child.pid)&&performance.now()<deadline){stop();await sleep(20);}
      requireValue(!child?.pid||!groupLive(child.pid),'owned-host-command-group-still-running');
    }finally{for(const signal of ['SIGTERM','SIGINT','SIGHUP'] as const)process.off(signal,terminate);fs.closeSync(args.guardFd);}
  }
}
async function worker(command: string[]): Promise<number> {
  requireValue(command.length,'host-child-command-required');
  // EOF or missing permit cannot execute the operation before durable identity.
  const permit=fs.createReadStream('',{fd:3,autoClose:true,start:undefined});
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{permit.destroy();reject(Error('host-child-start-timeout'));},15000);
    permit.once('data',bytes=>{clearTimeout(timer);permit.destroy();if(bytes[0]===71)resolve();else reject(Error('host-child-start-refused'));});
    permit.once('end',()=>{clearTimeout(timer);reject(Error('host-child-start-refused'));});permit.once('error',reject);
  });
  const child=spawn(command[0],command.slice(1),{stdio:'inherit',env:process.env});
  return new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal==='SIGKILL'?137:1)));});
}
if(require.main===module) {
  const argv=process.argv.slice(2),separator=argv.indexOf('--'),command=separator<0?[]:argv.slice(separator+1),flags=argv.slice(0,separator);
  const value=(key:string)=>flags[flags.indexOf(key)+1];
  const action=flags.includes('--worker')?worker(command):guardCommand({command,guardFd:Number(value('--guard-fd')),journal:value('--journal'),operation:value('--operation'),timeout:Number(value('--timeout')||300)});
  action.then(code=>{process.exitCode=code;}).catch(()=>{process.stderr.write('Owned host command failed; inspect its private child journal.\n');process.exitCode=1;});
}
