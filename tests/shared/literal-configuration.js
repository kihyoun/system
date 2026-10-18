'use strict';
// Decode configuration literals without evaluating shell code on the CI host.
// This deliberately accepts quoting/escaping, not expansion or shell commands.
function literal(input) {
  let result='',quote='';
  const source=input.trim();
  if(source.includes('\0')||source.startsWith('~'))throw Error('configuration-literal-invalid');
  for(let i=0;i<source.length;i++) {
    const char=source[i];
    if(quote==="'") {if(char==="'")quote='';else result+=char;}
    else if(char==='\\') {
      const next=source[++i];
      if(next===undefined)throw Error('configuration-literal-invalid');
      if(quote==='"'&&!['$','`','"','\\','\n'].includes(next))result+='\\';
      if(next!=='\n')result+=next;
    } else if(char===quote)quote='';
    else if(!quote&&(char==="'"||char==='"'))quote=char;
    else if(char==='$'||char==='`')throw Error('configuration-literal-invalid');
    else if(!quote&&/\s/.test(char)) {
      const rest=source.slice(i).trim();
      if(rest&&!rest.startsWith('#'))throw Error('configuration-literal-invalid');
      break;
    } else if(!quote&&/[;&|<>()]/.test(char))throw Error('configuration-literal-invalid');
    else result+=char;
  }
  if(quote)throw Error('configuration-literal-invalid');
  return result;
}
function configurationValues(config,names) {
  if(typeof config!=='string'||config.length>1048576||!Array.isArray(names)||
    names.some(name=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))throw Error('configuration-literal-invalid');
  const wanted=new Set(names),values={};
  let record='',quote='',escaped=false;
  for(const line of config.split('\n')) {
    if(!record&&(!line.trim()||line.trim().startsWith('#')))continue;
    record+=(record?'\n':'')+line;
    for(let i=0;i<line.length;i++) {
      const char=line[i];
      if(escaped){escaped=false;continue;}
      if(quote==="'"){if(char==="'")quote='';}
      else if(char==='\\')escaped=true;
      else if(char===quote)quote='';
      else if(!quote&&(char==="'"||char==='"'))quote=char;
      else if(!quote&&char==='#'&&(i===0||/\s/.test(line[i-1])))break;
    }
    if(quote||escaped){escaped=false;continue;}
    const match=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(record);
    if(!match)throw Error('configuration-literal-invalid');
    if(wanted.has(match[1])) {
      if(Object.hasOwn(values,match[1]))throw Error('configuration-literal-invalid');
      values[match[1]]=literal(match[2]);
    }
    record='';
  }
  if(record||names.some(name=>!Object.hasOwn(values,name)))throw Error('configuration-literal-invalid');
  return values;
}
module.exports={configurationValues};
