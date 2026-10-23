#!/usr/bin/env node
'use strict';
// Private operation subprocess journal. The watchdog is independent of the
// invoking helper; local children run in one recorded process group. A dead
// helper PID alone never establishes that rsync or a Docker client has ended.
const fs=require('node:fs'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const uptime=()=>Number(fs.readFileSync('/proc/uptime','utf8').split(' ')[0]);
function stat(pid){try{const fields=fs.readFileSync('/proc/'+pid+'/stat','utf8').slice(fs.readFileSync('/proc/'+pid+'/stat','utf8').lastIndexOf(')')+2).split(' ');return {state:fields[0],group:Number(fields[2]),start:fields[19]};}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function activeGroup(group){return fs.readdirSync('/proc').filter(name=>/^\d+$/.test(name)).some(name=>{const row=stat(Number(name));return row&&row.group===group&&row.state!=='Z';});}
function record(filename,value){const temporary=filename+'.'+process.pid+'.tmp';let fd;try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,filename);fd=fs.openSync(path.dirname(filename),'r');fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}
function input(){return new Promise((resolve,reject)=>{let raw='';process.stdin.on('data',chunk=>{raw+=chunk;if(raw.length>12*1024*1024)reject(Error('operation-payload-too-large'));});process.stdin.on('end',()=>{try{resolve(JSON.parse(raw));}catch{reject(Error('operation-payload-invalid'));}});});}
async function worker(){const job=await input();const result=spawnSync(job.binary,job.args,{cwd:job.cwd,env:job.env,input:job.input,encoding:'utf8',maxBuffer:8*1024*1024});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);process.exitCode=result.status===0?0:1;}
async function watchdog(directory){
  const job=await input(),owner=JSON.parse(fs.readFileSync(path.join(directory,'upgrade-owner.json'),'utf8'));
  if(owner.format!=='system-gitlab-upgrade-lock-v1'||!/^[a-f0-9]{32}$/.test(owner.operation||'')||typeof job.binary!=='string'||!Array.isArray(job.args)||job.args.some(a=>typeof a!=='string')||!Number.isInteger(job.timeout)||job.timeout<1||job.timeout>1800000)throw Error('operation-owner-invalid');
  const child=spawn(process.execPath,[__filename,'worker'],{detached:true,stdio:['pipe','pipe','pipe']});
  let expired=false;
  const witness={format:'system-gitlab-upgrade-child-v1',operation:owner.operation,watchdogPid:process.pid,watchdogStart:stat(process.pid).start,
    group:child.pid,workerStart:stat(child.pid).start,deadline:uptime()+job.timeout/1000+3,phase:'running'};
  const filename=path.join(directory,'child.json');record(filename,witness);
  const kill=signal=>{try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
  const timeout=setTimeout(()=>{expired=true;kill('SIGTERM');setTimeout(()=>kill('SIGKILL'),2000);},job.timeout);
  child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code));});
  child.stdin.end(JSON.stringify(job));
  const code=await completion;clearTimeout(timeout);
  if(activeGroup(child.pid)){kill('SIGTERM');await new Promise(resolve=>setTimeout(resolve,100));if(activeGroup(child.pid))kill('SIGKILL');}
  witness.phase='completed';witness.exitCode=code===0&&!expired?0:1;record(filename,witness);process.exitCode=witness.exitCode;
}
module.exports={uptime,stat,activeGroup};
if(require.main===module){const [mode,directory]=process.argv.slice(2);(mode==='worker'&&!directory?worker():mode==='watchdog'&&path.isAbsolute(directory||'')?watchdog(directory):Promise.reject(Error('operation-mode-invalid'))).catch(()=>{process.exitCode=1;});}
