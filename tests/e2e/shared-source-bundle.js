'use strict';
const path=require('node:path'),fs=require('node:fs');
const {execFileSync}=require('node:child_process');
function prepare(checkout,output,sourceRevision,sourceTree,wizardSourceTree){
  const git=(...args)=>execFileSync('git',['-C',checkout,...args],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024}).trim();
  if(git('rev-parse','--is-shallow-repository')!=='false')throw Error('Complete non-shallow shared System source required. Fetch the full Git history before preparation.');
  if(![sourceRevision,sourceTree,wizardSourceTree].every(value=>/^[a-f0-9]{40}$/.test(value||''))||
    git('rev-parse','HEAD')!==sourceRevision||git('rev-parse',sourceRevision+'^{tree}')!==sourceTree||git('rev-parse',sourceRevision+':wizard')!==wizardSourceTree||
    !/^040000 tree /.test(git('ls-tree',sourceRevision,'wizard')))throw Error('Exact committed shared System source required.');
  const target=path.resolve(output,'shared-source.bundle');
  if(fs.existsSync(target))throw Error('Shared source bundle already exists.');
  git('bundle','create',target,'HEAD');fs.chmodSync(target,0o600);git('bundle','verify',target);
  return target;
}
module.exports={prepare};
