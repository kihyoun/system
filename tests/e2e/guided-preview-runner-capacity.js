'use strict';

// Only the disposable guided fixture opts in. Keep registration, transport and
// producer bytes intact; refuse configurations outside the native single-runner
// shape rather than guessing which TOML scope a resource setting belongs to.
function runnerCapacity(content){
  const fail=()=>{throw Error('guided-preview-runner-capacity-conflict');};
  if(typeof content!=='string')fail();
  const lines=content.split('\n'),sections=[],assignments=[];
  let section='global';
  for(let index=0;index<lines.length;index++){
    const line=lines[index];
    if(/^\s*(?:#.*)?$/.test(line))continue;
    const header=/^\s*(\[\[runners\]\]|\[[a-zA-Z_][a-zA-Z0-9_.]*\])\s*(?:#.*)?$/.exec(line);
    if(header){section=header[1];sections.push({section,index});continue;}
    const assignment=/^([ \t]*)([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    // Native registration emits one-line assignments and unquoted keys. In
    // particular, do not mistake multiline strings or dotted keys for scopes.
    if(!assignment||/'''|"""/.test(assignment[3]))fail();
    assignments.push({section,index,indent:assignment[1],key:assignment[2],value:assignment[3]});
  }
  if(sections.filter(entry=>entry.section==='[[runners]]').length!==1||
    sections.filter(entry=>entry.section==='[runners.docker]').length!==1||
    sections.some(entry=>!['[[runners]]','[session_server]','[runners.docker]',
      '[runners.cache]','[runners.cache.s3]','[runners.cache.gcs]','[runners.cache.azure]'].includes(entry.section)))fail();
  const one=(scope,key,expected,required=false)=>{
    const entries=assignments.filter(entry=>entry.key===key);
    if(entries.length>1||required&&entries.length!==1||entries.some(entry=>entry.section!==scope||!expected.test(entry.value)))fail();
    return entries[0];
  };
  one('[[runners]]','name',/^"runner-docker-1"\s*(?:#.*)?$/,true);
  one('[[runners]]','executor',/^"docker"\s*(?:#.*)?$/,true);
  const concurrent=one('global','concurrent',/^[12]\s*(?:#.*)?$/,true);
  one('[[runners]]','limit',/^(?:0|2)\s*(?:#.*)?$/);
  one('[[runners]]','request_concurrency',/^[12]\s*(?:#.*)?$/);
  const memory=one('[runners.docker]','memory',/^"2g"\s*(?:#.*)?$/);
  const cpus=one('[runners.docker]','cpus',/^"1"\s*(?:#.*)?$/);
  // Alternate Docker resource controls could undermine these exact ceilings.
  if(assignments.some(entry=>/^(?:memory_|cpu_|cpuset_|service_memory|service_cpus|service_cpu|service_cpuset)/.test(entry.key)))fail();
  // An already concurrent manager is accepted only as the complete result of
  // this transform, never as an unbounded or partially configured input.
  if(/^2\b/.test(concurrent.value)&&(!memory||!cpus))fail();
  lines[concurrent.index]=lines[concurrent.index].replace(/(=\s*)1(?=\s*(?:#.*)?$)/,(_match,prefix)=>prefix+'2');
  const docker=sections.find(entry=>entry.section==='[runners.docker]');
  const next=sections.find(entry=>entry.index>docker.index);
  const insert=[];
  if(!memory)insert.push('    memory = "2g"');
  if(!cpus)insert.push('    cpus = "1"');
  lines.splice(next?next.index:lines.length-Number(lines.at(-1)===''),0,...insert);
  return lines.join('\n');
}
module.exports={runnerCapacity};
