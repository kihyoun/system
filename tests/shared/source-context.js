'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const crypto = require('crypto');
const {pack} = require('../../project-bootstrap/wizard-source/package');
const {prepareContext} = require('../prepare-context');
const {prepareCandidate} = require('../prepare-candidate');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'committed-test-context-'));
const source = path.resolve(__dirname,'../..');
const gitSelectors = {SYSTEM_SOURCE_GIT_DIR:process.env.SYSTEM_SOURCE_GIT_DIR,WIZARD_SOURCE_GIT_DIR:process.env.WIZARD_SOURCE_GIT_DIR};
delete process.env.SYSTEM_SOURCE_GIT_DIR; delete process.env.WIZARD_SOURCE_GIT_DIR;
const git = (...args) => execFileSync('git',['-C',root,...args],{stdio:['ignore','pipe','pipe']}).toString().trim();
const write = (name,content) => { const file=path.join(root,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,content); };
try {
  git('init'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid');
  const sourceSnapshot = JSON.parse(fs.readFileSync(path.join(source,'project-bootstrap/wizard-source/snapshot.json'),'utf8'));
  // Real, independent Git objects are required to prove snapshot provenance.
  write('wizard/package.json','{}\n');
  write('wizard/src/api/Helper.tsx',Buffer.from(sourceSnapshot.files.find(file=>file.path==='src/api/Helper.tsx').content,'base64'));
  write('wizard/.gitlab-ci.yml','stages: [test]\n');
  write('wizard/start.sh','#!/bin/sh\nexit 0\n');
  const wizardGit = (...args) => execFileSync('git',['-C',path.join(root,'wizard'),...args],{stdio:['ignore','pipe','pipe']}).toString().trim();
  wizardGit('init'); wizardGit('config','user.name','Fixture'); wizardGit('config','user.email','fixture@example.invalid');
  wizardGit('add','.'); wizardGit('commit','-m','Committed Wizard fixture');
  const wizardRevision=wizardGit('rev-parse','HEAD');
  write('tests/Dockerfile','FROM scratch\n');
  write('.gitlab-ci.yml','stages: [test]\n');
  write('system/Dockerfile','FROM scratch\n');
  write('sync/package.json','{}\n');
  write('sync/src/public.ts','committed source\n');
  write('tests/fixture.sh','#!/bin/sh\nexit 0\n');
  const binary=Buffer.from([0,255,128,13,10]);
  write('tests/binary.png',binary);
  write('system/.docker.env.example','public example\n');
  const runtimeInputs=['start.sh','sync/start.sh','bootstrapper/persistence.sh',
    'gitlab-runner/docker-compose.yml','gitlab-runner/provision.rb','system/.seed.env',
    'system/persistence-init.js','system/push.sh','system/harvest.sh','system/seed.sh',
    'system/seed-manifest.js','bootstrapper/rebind-renewal.py'];
  for(const filename of runtimeInputs) write(filename,'committed runtime input\n');
  write('project-bootstrap/private.env','must not enter the context\n');
  git('add','.'); git('update-index','--chmod=+x','tests/fixture.sh');
  git('update-index','--add','--cacheinfo','160000,'+wizardRevision+',wizard');
  git('commit','-m','Source fixture');
  const snapshot=pack(root);
  for (const name of ['.docker.env','system/.docker.env','tests/credentials.json','project-bootstrap/untracked-secret.txt','seed/data','test-results/old.xml']) write(name,'untracked-private-marker');
  write('sync/src/public.ts','dirty-private-marker');
  write('.gitlab-ci.yml','dirty-uncommitted-ci\n');
  write('project-bootstrap/wizard-source/snapshot.json',JSON.stringify({...snapshot,unrecognizedSecret:'never copy this metadata'}));
  const result = prepareContext(root);
  const archive=path.join(root,'.test-context/context.tar');
  assert(!result.files.some(name=>/private\.env|credentials|untracked-secret|seed\/data|old\.xml/.test(name)));
  assert(result.files.includes('system/.docker.env.example'));
  assert.equal(execFileSync('tar',['-xOf',archive,'.gitlab-ci.yml'],{encoding:'utf8'}),'stages: [test]\n');
  for(const filename of runtimeInputs) assert(result.files.includes(filename), 'Missing runtime input: '+filename);
  assert.equal(execFileSync('tar',['-xOf',archive,'sync/src/public.ts'],{encoding:'utf8'}),'committed source\n');
  assert(execFileSync('tar',['-xOf',archive,'tests/binary.png']).equals(binary),'preserve binary source bytes');
  const cleanSnapshot = JSON.parse(execFileSync('tar',['-xOf',archive,'project-bootstrap/wizard-source/snapshot.json'],{encoding:'utf8',maxBuffer:8*1024*1024}));
  assert(!Object.hasOwn(cleanSnapshot,'unrecognizedSecret'));
  const mode = execFileSync('tar',['-tvf',archive,'tests/fixture.sh'],{encoding:'utf8'});
  assert(mode.includes('rwxr-xr-x'),'preserve executable mode');
  assert.equal(fs.readFileSync(path.join(root,'.test-context/revision'),'utf8').trim(),git('rev-parse','HEAD'));
  const candidate=prepareCandidate(root);
  assert(candidate.files.includes('system/Dockerfile'));
  assert(candidate.files.includes('wizard/start.sh'));
  assert(!candidate.files.some(name=>/private\.env|credentials|untracked-secret|seed\/data|old\.xml|^tests\//.test(name)));
  assert.equal(execFileSync('tar',['-xOf',path.join(root,'.candidate-context/context.tar'),'sync/src/public.ts'],{encoding:'utf8'}),'committed source\n');
  assert.equal(candidate.wizardRevision,snapshot.sourceRevision);
  const forged=JSON.parse(JSON.stringify(snapshot));
  const changed=forged.files.find(file=>file.path==='start.sh');
  changed.content=Buffer.from('#!/bin/sh\necho uncommitted-snapshot-injection\n').toString('base64');
  changed.sha256=crypto.createHash('sha256').update(Buffer.from(changed.content,'base64')).digest('hex');
  const manifest={version:forged.version,sourceRevision:forged.sourceRevision,files:forged.files.map(({path,mode,sha256})=>({path,mode,sha256}))};
  forged.manifestHash=crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  write('project-bootstrap/wizard-source/snapshot.json',JSON.stringify(forged));
  assert.throws(()=>prepareContext(root),/differs from committed source/);
  assert.throws(()=>prepareCandidate(root),/differs from committed source/);
  write('project-bootstrap/wizard-source/snapshot.json',JSON.stringify(snapshot));
  // Dirty Wizard worktree source is ignored: only pinned blobs define provenance.
  write('wizard/start.sh','dirty-worktree-marker\n');
  prepareContext(root); prepareCandidate(root);
  const stale = {...snapshot,sourceRevision:'0'.repeat(40)};
  write('project-bootstrap/wizard-source/snapshot.json',JSON.stringify(stale));
  assert.throws(()=>prepareContext(root),/stale|manifest hash/);
  assert.throws(()=>prepareCandidate(root),/snapshot|manifest hash/);
  write('project-bootstrap/wizard-source/snapshot.json',JSON.stringify(snapshot));
  git('update-index','--add','--cacheinfo','120000,'+git('hash-object','sync/package.json')+',tests/unsafe-link');
  git('commit','-m','Reject links');
  assert.throws(()=>prepareContext(root),/links and nested submodules/);
  console.log('PASS: committed-only context, ignored/private/dirty exclusions, verified snapshot, executable bytes, stale snapshot and link refusal.');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
  for(const [key,value]of Object.entries(gitSelectors)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
