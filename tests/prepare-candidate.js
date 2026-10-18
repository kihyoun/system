#!/usr/bin/env node
'use strict';
// The full image has its own committed-only context; never send the live checkout.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {execFileSync}=require('child_process');
const {validate,verifyCommitted}=require('../project-bootstrap/wizard-source/package');
const snapshotPath='project-bootstrap/wizard-source/snapshot.json';
const allowed=['bootstrapper','system','sync','gitlab','gitlab-runner','nginx','nginx-proxy','project-bootstrap'];
function included(name) {
  if(!/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').some(x=>x==='..'||x==='.git')) return false;
  if(name===snapshotPath || /(^|\/)(node_modules|dist|test-results|\.test-context|\.candidate-context|\.projects\.env|\.hosts|seed|ssl|configuration)(\/|$)/.test(name)) return false;
  if(/(^|\/)(private\.env|\.docker\.env|\.env(?:\.[^/]+)?|credentials(?:\.[^/]+)?|bootstrapper\.json|bootstrapper\.zip|bootstrapper_initial_root_password)$/.test(name) || /\.(key|pem|p12|pfx)$/.test(name)) return false;
  return allowed.includes(name.split('/')[0]) || ['start.sh','.dockerignore'].includes(name);
}
function prepareCandidate(root) {
  root=path.resolve(root);
  const git=(...args)=>execFileSync('git',['-c','safe.directory='+root,'-c','core.autocrlf=false','-c','core.eol=lf','-C',root,...args],{maxBuffer:32*1024*1024});
  const revision=git('rev-parse','HEAD').toString().trim();
  const pin=/^160000 commit ([a-f0-9]{40})\twizard$/.exec(git('ls-tree','HEAD','wizard').toString().trim());
  const snapshot=validate(JSON.parse(fs.readFileSync(path.join(root,snapshotPath),'utf8')));
  if(!pin || pin[1]!==snapshot.sourceRevision) throw Error('Candidate snapshot must match the committed Wizard gitlink.');
  verifyCommitted(root,snapshot);
  const files=git('ls-tree','-rz','HEAD').toString().split('\0').filter(Boolean).map(entry=>{
    const match=/^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if(!match) throw Error('Invalid committed candidate entry.');
    return {mode:match[1],type:match[2],name:match[4]};
  }).filter(file=>included(file.name));
  if(files.some(file=>file.type!=='blob'||!['100644','100755'].includes(file.mode))) throw Error('Candidate context refuses links and nested submodules.');
  if(!files.some(file=>file.name==='system/Dockerfile') || !snapshot.files.some(file=>file.path==='start.sh')) throw Error('Incomplete full-System candidate source.');
  const output=path.join(root,'.candidate-context');
  if(fs.existsSync(output)&&(!fs.lstatSync(output).isDirectory()||fs.lstatSync(output).isSymbolicLink())) throw Error('Candidate context output must be a real directory.');
  fs.mkdirSync(output,{recursive:true});
  const temporary=fs.mkdtempSync(path.join(output,'.prepare-'));
  try {
    const archive=path.join(temporary,'context.tar');
    git('archive','--format=tar','--output='+archive,'HEAD','--',...files.map(file=>file.name));
    execFileSync('tar',['-xf',archive,'-C',temporary]);
    const additions=[snapshotPath];
    const write=(name,content,mode)=>{
      const filename=path.join(temporary,name);fs.mkdirSync(path.dirname(filename),{recursive:true});
      fs.writeFileSync(filename,content,{mode:mode==='100755'?0o755:0o644});
    };
    write(snapshotPath,JSON.stringify({version:snapshot.version,sourceRevision:snapshot.sourceRevision,manifestHash:snapshot.manifestHash,files:snapshot.files}));
    for(const file of snapshot.files){const name='wizard/'+file.path;write(name,Buffer.from(file.content,'base64'),file.mode);additions.push(name);}
    execFileSync('tar',['-cf',archive,'-C',temporary,...files.map(file=>file.name),...additions]);
    const names=execFileSync('tar',['--list','--file',archive],{encoding:'utf8',maxBuffer:2*1024*1024}).split('\n').filter(x=>x&&!x.endsWith('/')).sort();
    const expected=[...files.map(file=>file.name),...additions].sort();
    if(JSON.stringify(names)!==JSON.stringify(expected)) throw Error('Candidate archive differs from the explicit committed inputs.');
    const checksum=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    fs.writeFileSync(path.join(temporary,'revision'),revision+'\n');
    fs.writeFileSync(path.join(temporary,'sha256'),checksum+'\n');
    fs.writeFileSync(path.join(temporary,'manifest.json'),JSON.stringify({revision,wizardRevision:snapshot.sourceRevision,checksum,files:expected},null,2)+'\n');
    for(const name of ['context.tar','revision','sha256','manifest.json']) fs.renameSync(path.join(temporary,name),path.join(output,name));
    return {revision,wizardRevision:snapshot.sourceRevision,files:expected,checksum};
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}
module.exports={prepareCandidate,included};
if(require.main===module){try{const result=prepareCandidate(path.resolve(__dirname,'..'));console.log('Prepared full-System candidate: '+result.revision+' ('+result.files.length+' files)');}catch(error){console.error(error.message);process.exitCode=1;}}
