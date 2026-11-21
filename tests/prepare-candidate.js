#!/usr/bin/env node
'use strict';
// The full image has its own committed-only context; never send the live checkout.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {execFileSync}=require('child_process');
const {validate,verifyCommitted,sourceMetadata}=require('../project-bootstrap/wizard-source/package');
const snapshotPath='project-bootstrap/wizard-source/snapshot.json';
const allowed=['bootstrapper','system','sync','operations','gitlab','gitlab-runner','nginx','nginx-proxy','project-bootstrap'];
function included(name) {
  if (['tools/quickstart/quickstart.sh', 'tools/gitlab/bootstrap-token.rb'].includes(name)) return true;
  if(!/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').some(x=>x==='..'||x==='.git')) return false;
  if(name===snapshotPath || /(^|\/)(node_modules|dist|test-results|\.test-context|\.candidate-context|\.projects\.env|\.hosts|seed|ssl)(\/|$)/.test(name)) return false;
  // This authored feature directory shares a name with private runtime state.
  if(!/^operations\/src\/configuration\/[^/]+\.ts$/.test(name) && /(^|\/)configuration(\/|$)/.test(name)) return false;
  if((name !== 'operations/src/mirror/credentials.service.ts' && /(^|\/)(private\.env|\.docker\.env|\.env(?:\.[^/]+)?|credentials(?:\.[^/]+)?|bootstrapper\.json|bootstrapper\.zip|bootstrapper_initial_root_password)$/.test(name)) || /\.(key|pem|p12|pfx)$/.test(name)) return false;
  // Only this isolated test transport runs inside the accepted controller image.
  if(name==='tests/e2e/acme-host-runtime.js') return true;
  return allowed.includes(name.split('/')[0]) || ['.dockerignore','LICENSE','.prettierrc','.prettierignore'].includes(name);
}
function prepareCandidate(root) {
  root=path.resolve(root);
  const git=(...args)=>execFileSync('git',['-c','safe.directory='+root,'-c','core.autocrlf=false','-c','core.eol=lf','-C',root,...args],{maxBuffer:32*1024*1024});
  const revision=git('rev-parse','HEAD').toString().trim();
  const snapshot=validate(JSON.parse(fs.readFileSync(path.join(root,snapshotPath),'utf8')));
  verifyCommitted(root,snapshot);
  const identity=snapshot.version===2
    ? {sourceLayout:snapshot.sourceLayout,wizardSourceTree:snapshot.wizardSourceTree}
    : {wizardRevision:snapshot.sourceRevision};
  const entries=git('ls-tree','-rz','HEAD').toString().split('\0').filter(Boolean).map(entry=>{
    const match=/^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if(!match) throw Error('Invalid committed candidate entry.');
    return {mode:match[1],type:match[2],name:match[4]};
  });
  if(entries.some(file=>file.name.startsWith('sync/src/') && /\.[cm]?[jt]sx?$/.test(file.name) && !included(file.name)))
    throw Error('Sync source path conflicts with a private-data exclusion.');
  if(entries.some(file=>file.name.startsWith('operations/src/') && /\.[cm]?[jt]sx?$/.test(file.name) && !included(file.name)))
    throw Error('Operations source path conflicts with a private-data exclusion.');
  const files=entries.filter(file=>included(file.name));
  if(files.some(file=>file.type!=='blob'||!['100644','100755'].includes(file.mode))) throw Error('Candidate context refuses links and nested submodules.');
  const wizardInputs=snapshot.version===2
    ? ['Dockerfile','nginx/nginx.conf','package.json','package-lock.json']
    : ['start.sh'];
  if(!files.some(file=>file.name==='system/Dockerfile') || !wizardInputs.every(name=>snapshot.files.some(file=>file.path===name))) throw Error('Incomplete full-System candidate source.');
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
    write(snapshotPath,JSON.stringify({version:snapshot.version,sourceRevision:snapshot.sourceRevision,...sourceMetadata(snapshot),manifestHash:snapshot.manifestHash,files:snapshot.files}));
    for(const file of snapshot.files){const name='wizard/'+file.path;write(name,Buffer.from(file.content,'base64'),file.mode);additions.push(name);}
    execFileSync('tar',['-cf',archive,'-C',temporary,...files.map(file=>file.name),...additions]);
    const names=execFileSync('tar',['--list','--file',archive],{encoding:'utf8',maxBuffer:2*1024*1024}).split('\n').filter(x=>x&&!x.endsWith('/')).sort();
    const expected=[...files.map(file=>file.name),...additions].sort();
    if(JSON.stringify(names)!==JSON.stringify(expected)) throw Error('Candidate archive differs from the explicit committed inputs.');
    const checksum=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    fs.writeFileSync(path.join(temporary,'revision'),revision+'\n');
    fs.writeFileSync(path.join(temporary,'sha256'),checksum+'\n');
    fs.writeFileSync(path.join(temporary,'manifest.json'),JSON.stringify({revision,...identity,checksum,files:expected},null,2)+'\n');
    for(const name of ['context.tar','revision','sha256','manifest.json']) fs.renameSync(path.join(temporary,name),path.join(output,name));
    return {revision,...identity,files:expected,checksum};
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}
module.exports={prepareCandidate,included};
if(require.main===module){try{const result=prepareCandidate(path.resolve(__dirname,'..'));console.log('Prepared full-System candidate: '+result.revision+' ('+result.files.length+' files)');}catch(error){console.error(error.message);process.exitCode=1;}}
