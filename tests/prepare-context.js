#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {validate,verifyCommitted,sourceMetadata} = require('../project-bootstrap/wizard-source/package');
const snapshotPath = 'project-bootstrap/wizard-source/snapshot.json';
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

function included(name) {
  if (['tools/quickstart/quickstart.sh', 'tools/gitlab/bootstrap-token.rb'].includes(name)) return true;
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').some(part => part === '..' || part === '.git')) return false;
  // Committed source is necessary, but runtime/private/generated paths still
  // do not belong in the test context. The one validated snapshot is added below.
  if (name === snapshotPath || /(^|\/)(node_modules|dist|test-results|\.test-context|\.projects\.env)(\/|$)/.test(name)) return false;
  if (name !== 'operations/src/mirror/credentials.service.ts' && /(^|\/)(private\.env|\.docker\.env|\.env(?:\.[^/]+)?|credentials(?:\.[^/]+)?|bootstrapper\.json|bootstrapper\.zip|bootstrapper_initial_root_password)$/.test(name)) return false;
  if (/\.(key|pem|p12|pfx)$/.test(name)) return false;
  if (name === 'system/wizard-image-recovery.js') return true;
  if (['bootstrapper/record-source-installation.js', 'bootstrapper/upgrade-paths.json'].includes(name)) return true;
  // Public trust data is required by the offline CA-refresh checks. Keep this
  // exact allowlist separate from private/operator certificate material.
  if (['bootstrapper/ca/cacert-2026-10-20.crt','bootstrapper/ca/provenance.json','bootstrapper/ca/check.js'].includes(name)) return true;
  if (['docs/check-wizard-docs.js', 'renovate.json', 'gitlab/renovate/config.cjs', 'gitlab/renovate/setup.js', 'gitlab/renovate/verify.js'].includes(name)) return true;
  // The native Docs authoring contract checks the exact public guides and local
  // screenshots; arbitrary operator files under docs/ remain excluded.
  if (/^docs\/[A-Za-z0-9_.\/-]+\.(?:md|png|jpg|jpeg|svg)$/.test(name) ||
      ['docs/wizard-docs-catalog.json','Prepare-Host.md','overview.png','gitlab-runner/README.md','bootstrapper/README.md'].includes(name)) return true;
  return /^sync\/src\//.test(name) || name.startsWith('operations/') || ['LICENSE','.prettierrc','.prettierignore'].includes(name) ||
    ['sync/package.json','sync/package-lock.json','sync/tsconfig.json','sync/eslint.config.mjs'].includes(name) ||
    name.startsWith('project-bootstrap/') || name.startsWith('tests/') ||
    /^gitlab\/[^/]+\.(js|sh|rb|json)$/.test(name) || name === 'gitlab/gitlab.rb' ||
    /^bootstrapper\/[^/]+\.(js|sh|py)$/.test(name) || /^gitlab-runner\/[^/]+\.(js|sh|rb)$/.test(name) || /^nginx\/[^/]+\.(js|sh)$/.test(name) ||
    name.startsWith('nginx/.templates/') || name === 'nginx-proxy/docker-compose.yml' ||
    ['.gitlab-ci.yml','VERSION','tests/prepare-candidate.js','bootstrapper/persistence.js','bootstrapper/seed-operation.js',
      'gitlab/docker-compose.omnibus.yml','gitlab-runner/docker-compose.yml','system/Dockerfile','bootstrapper/Dockerfile','system/.docker.env.example','system/.seed.env',
      'system/docker-compose.yml',
      'system/persistence-init.js','system/wizard-public.js',
      'system/seed-manifest.js','system/seed-operation.js','system/coordinated-backup.js'].includes(name);
}
function prepareContext(root) {
  root = path.resolve(root);
  const git = (...args) => execFileSync('git', ['-c','safe.directory='+root,'-c','core.autocrlf=false','-c','core.eol=lf','-c','tar.umask=0022','-C',root,...args], {maxBuffer:32*1024*1024});
  const revision = git('rev-parse','HEAD').toString().trim();
  const snapshot = validate(JSON.parse(fs.readFileSync(path.join(root,snapshotPath),'utf8')));
  verifyCommitted(root,snapshot);
  const identity = snapshot.version === 2 ? sourceMetadata(snapshot) : {wizardRevision:snapshot.sourceRevision};
  const entries = git('ls-tree','-rz','HEAD').toString().split('\0').filter(Boolean).map(entry => {
    const match = /^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if (!match) throw Error('Unexpected committed tree entry.');
    return {mode:match[1],type:match[2],name:match[4]};
  });
  if (entries.some(file => file.name.startsWith('operations/src/') && /\.[cm]?[jt]sx?$/.test(file.name) && !included(file.name)))
    throw Error('Operations source path conflicts with a private-data exclusion.');
  const files = entries.filter(file=>included(file.name));
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
    const cleanSnapshot = {version:snapshot.version,sourceRevision:snapshot.sourceRevision,...sourceMetadata(snapshot),manifestHash:snapshot.manifestHash,
      files:snapshot.files.map(({path,mode,sha256,content})=>({path,mode,sha256,content}))};
    fs.writeFileSync(stagedSnapshot,JSON.stringify(cleanSnapshot));
    execFileSync('tar',['-cf',archive,'-C',temporary,...files.map(file=>file.name),snapshotPath],{stdio:['ignore','pipe','pipe']});
    const names = execFileSync('tar',['--list','--file',archive],{encoding:'utf8',maxBuffer:1024*1024}).split(/\r?\n/).filter(name=>name && !name.endsWith('/'));
    const expected = [...files.map(file=>file.name),snapshotPath].sort();
    if (JSON.stringify(names.sort()) !== JSON.stringify(expected)) throw Error('The test archive does not match the selected committed inputs.');
    const archiveHash = sha256(fs.readFileSync(archive));
    fs.writeFileSync(path.join(temporary,'revision'),revision+'\n');
    fs.writeFileSync(path.join(temporary,'sha256'),archiveHash+'\n');
    fs.writeFileSync(path.join(temporary,'manifest.json'),JSON.stringify({revision,...identity,snapshotManifest:snapshot.manifestHash,archiveHash,files:expected},null,2)+'\n');
    for (const name of ['context.tar','revision','sha256','manifest.json']) fs.renameSync(path.join(temporary,name),path.join(output,name));
    return {revision,...identity,files:expected,archiveHash};
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
