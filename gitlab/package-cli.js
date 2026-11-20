'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
function prepare(root=process.cwd(),env=process.env){
  const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  if(revision!==env.CI_COMMIT_SHA||!/^\d+$/.test(env.CI_PIPELINE_ID||'')||!/^\d+$/.test(env.CI_JOB_ID||''))throw Error('Exact native package source required.');
  execFileSync('git',['diff','--quiet','HEAD','--','operations','VERSION'],{cwd:root});
  const directory=path.join(root,'operations');
  const metadata=JSON.parse(fs.readFileSync(path.join(directory,'package.json')));
  const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
  if(metadata.name!=='@systembootstrapper/cli'||metadata.version!==version)throw Error('Package release identity differs.');
  const source={format:'system-cli-source-v1',sourceRevision:revision,sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),version,pipelineId:Number(env.CI_PIPELINE_ID),packageJobId:Number(env.CI_JOB_ID)};
  fs.writeFileSync(path.join(directory,'assets/source.json'),JSON.stringify(source)+'\n');
  const output=path.join(root,'test-results/npm-package');fs.mkdirSync(output,{recursive:true});
  const [packed]=JSON.parse(execFileSync('npm',['pack','--json','--ignore-scripts','--pack-destination',output],{cwd:directory,encoding:'utf8'}));
  if(!/^[a-z0-9.-]+\.tgz$/.test(packed.filename))throw Error('Invalid package filename.');
  const bytes=fs.readFileSync(path.join(output,packed.filename));
  const receipt={...source,name:metadata.name,filename:packed.filename,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),integrity:'sha512-'+crypto.createHash('sha512').update(bytes).digest('base64')};
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
module.exports={prepare};
if(require.main===module){try{const value=prepare();console.log('Prepared CLI '+value.name+'@'+value.version+' from '+value.sourceRevision);}catch(error){console.error(error.message);process.exitCode=1;}}
