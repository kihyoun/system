#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {validate,verifyCommitted} = require('../project-bootstrap/wizard-source/package');
const snapshotPath = 'project-bootstrap/wizard-source/snapshot.json';
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

function included(name) {
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').some(part => part === '..' || part === '.git')) return false;
  // Committed source is necessary, but runtime/private/generated paths still
  // do not belong in the test context. The one validated snapshot is added below.
  if (name === snapshotPath || /(^|\/)(node_modules|dist|test-results|\.test-context|\.projects\.env)(\/|$)/.test(name)) return false;
  if (/(^|\/)(private\.env|\.docker\.env|\.env(?:\.[^/]+)?|credentials(?:\.[^/]+)?|bootstrapper\.json|bootstrapper_initial_root_password)$/.test(name)) return false;
  if (['system/ensure-wizard-image.sh','system/wizard-image-recovery.js','system/wizard-registry-token.rb'].includes(name)) return true;
  return /^sync\/src\//.test(name) ||
    ['sync/package.json','sync/package-lock.json','sync/tsconfig.json','sync/eslint.config.mjs'].includes(name) ||
    name.startsWith('project-bootstrap/') || name.startsWith('tests/') ||
    /^gitlab\/[^/]+\.(js|sh)$/.test(name) || name === 'gitlab/gitlab.rb' ||
    /^gitlab-runner\/[^/]+\.(js|sh|rb)$/.test(name) || /^nginx\/[^/]+\.sh$/.test(name) ||
    name.startsWith('nginx/.templates/') || /^nginx-proxy\/[^/]+\.sh$/.test(name) ||
    ['.gitlab-ci.yml','tests/prepare-candidate.js','start.sh','sync/start.sh','bootstrapper/persistence.sh',
      'gitlab-runner/docker-compose.yml','system/.docker.env.example','system/.seed.env',
      'system/start-intermediate.sh','system/persistence-init.js','system/push.sh',
      'system/harvest.sh','system/seed.sh','system/seed-manifest.js','bootstrapper/rebind-renewal.py'].includes(name);
}
function prepareContext(root) {
  root = path.resolve(root);
  const git = (...args) => execFileSync('git', ['-c','safe.directory='+root,'-c','core.autocrlf=false','-c','core.eol=lf','-c','tar.umask=0022','-C',root,...args], {maxBuffer:32*1024*1024});
  const revision = git('rev-parse','HEAD').toString().trim();
  const pin = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(git('ls-tree','HEAD','wizard').toString().trim());
  if (!pin) throw Error('The committed checkout must pin a Wizard gitlink.');
  const snapshot = validate(JSON.parse(fs.readFileSync(path.join(root,snapshotPath),'utf8')));
  if (snapshot.sourceRevision !== pin[1]) throw Error('The prepared Wizard snapshot is stale; regenerate it for the current gitlink.');
  verifyCommitted(root,snapshot);
  const files = git('ls-tree','-rz','HEAD').toString().split('\0').filter(Boolean).map(entry => {
    const match = /^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if (!match) throw Error('Unexpected committed tree entry.');
    return {mode:match[1],type:match[2],name:match[4]};
  }).filter(file=>included(file.name));
  if (!files.some(file=>file.name==='tests/Dockerfile') || !files.some(file=>file.name==='sync/package.json')) throw Error('The committed test build inputs are incomplete.');
  if (files.some(file=>file.type!=='blob' || !['100644','100755'].includes(file.mode))) throw Error('Test context links and nested submodules are not supported.');
  const output = path.join(root,'.test-context');
  if (fs.existsSync(output) && (fs.lstatSync(output).isSymbolicLink() || !fs.lstatSync(output).isDirectory())) throw Error('Test context output must be a real directory.');
  fs.mkdirSync(output,{recursive:true});
  const temporary = fs.mkdtempSync(path.join(output,'.prepare-'));
  try {
    const archive = path.join(temporary,'context.tar');
    git('archive','--format=tar','--output='+archive,'HEAD','--',...files.map(file=>file.name));
    execFileSync('tar',['-xf',archive,'-C',temporary]);
    const stagedSnapshot = path.join(temporary,snapshotPath);
    fs.mkdirSync(path.dirname(stagedSnapshot),{recursive:true});
    // Do not carry unknown metadata fields into the candidate context.
    const cleanSnapshot = {version:snapshot.version,sourceRevision:snapshot.sourceRevision,manifestHash:snapshot.manifestHash,
      files:snapshot.files.map(({path,mode,sha256,content})=>({path,mode,sha256,content}))};
    fs.writeFileSync(stagedSnapshot,JSON.stringify(cleanSnapshot));
    execFileSync('tar',['-cf',archive,'-C',temporary,...files.map(file=>file.name),snapshotPath],{stdio:['ignore','pipe','pipe']});
    const names = execFileSync('tar',['--list','--file',archive],{encoding:'utf8',maxBuffer:1024*1024}).split(/\r?\n/).filter(name=>name && !name.endsWith('/'));
    const expected = [...files.map(file=>file.name),snapshotPath].sort();
    if (JSON.stringify(names.sort()) !== JSON.stringify(expected)) throw Error('The test archive does not match the selected committed inputs.');
    const archiveHash = sha256(fs.readFileSync(archive));
    fs.writeFileSync(path.join(temporary,'revision'),revision+'\n');
    fs.writeFileSync(path.join(temporary,'sha256'),archiveHash+'\n');
    fs.writeFileSync(path.join(temporary,'manifest.json'),JSON.stringify({revision,wizardRevision:pin[1],snapshotManifest:snapshot.manifestHash,archiveHash,files:expected},null,2)+'\n');
    for (const name of ['context.tar','revision','sha256','manifest.json']) fs.renameSync(path.join(temporary,name),path.join(output,name));
    return {revision,wizardRevision:pin[1],files:expected,archiveHash};
  } finally {
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}
module.exports = {prepareContext,included};
if (require.main === module) {
  try {
    const result = prepareContext(path.resolve(__dirname,'..'));
    console.log('Prepared committed test context: '+result.revision+' ('+result.files.length+' files)');
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
