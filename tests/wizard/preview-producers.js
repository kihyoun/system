'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {validateProducers, approvedProducers} = require('../../dist/modules/project-lifecycle/previewProducers');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-producers-'));
try {
  const files = ['package.json', 'src/api/Helper.tsx', '.gitlab-ci.yml', '.gitlab/primary.yml', '.gitlab/test-browser.sh', '.gitlab/delivery/environment.sh'].map(name => ({path: name, mode: '100644', content: Buffer.from('trusted ' + name + '\n').toString('base64'), sha256: hash('trusted ' + name + '\n')}));
  const manifest = {version: 1, sourceRevision: 'a'.repeat(40), files: files.map(({path, mode, sha256}) => ({path, mode, sha256}))};
  const snapshot = path.join(root, 'snapshot.json'); fs.writeFileSync(snapshot, JSON.stringify({...manifest, manifestHash: hash(JSON.stringify(manifest)), files}));
  const approved = approvedProducers(snapshot);
  assert(validateProducers(approved, snapshot));
  for (const name of ['.gitlab/primary.yml', '.gitlab/test-browser.sh', '.gitlab/delivery/environment.sh']) {
    assert.throws(() => validateProducers(approved.map(file => file.path === name ? {...file, sha256: hash('echo fabricated evidence')} : file), snapshot), /differ/);
    assert.throws(() => validateProducers(approved.filter(file => file.path !== name), snapshot), /differ/);
  }
  assert.throws(() => validateProducers([...approved, {path: '.gitlab/replacement.sh', sha256: hash('echo pass')}], snapshot), /differ/);
  const modern=files.filter(file=>!file.path.endsWith('.sh'));
  function add(name,content) { modern.push({path:name,mode:'100644',content:Buffer.from(content).toString('base64'),sha256:hash(content)}); }
  add('.gitlab/runtime/project-ci.cjs','pinned portable runtime');
  add('.gitlab/runtime/LICENSES.txt','licenses');
  add('.gitlab/producer-v2.json',JSON.stringify({version:2,runtime:'.gitlab/runtime/project-ci.cjs',runtimeSha256:hash('pinned portable runtime'),buildProfile:'node24-vite8-typed-v6'}));
  function saveModern(){const m={version:1,sourceRevision:'a'.repeat(40),files:modern.map(({path,mode,sha256})=>({path,mode,sha256}))};fs.writeFileSync(snapshot,JSON.stringify({...m,manifestHash:hash(JSON.stringify(m)),files:modern}));}
  saveModern(); const modernApproved=approvedProducers(snapshot);assert(validateProducers(modernApproved,snapshot));
  const {ciFiles}=require('../../dist/modules/project-lifecycle/sourcePrimaryEnvironment');
  assert(ciFiles([...modernApproved,{path:'.system-bootstrapper/build-v2/Dockerfile',sha256:hash('docker')}]).length);
  assert.throws(()=>ciFiles(modernApproved.filter(file=>file.path!=='.gitlab/runtime/project-ci.cjs')),/manifest/);
  const runtime=modern.find(file=>file.path==='.gitlab/runtime/project-ci.cjs');runtime.content=Buffer.from('tampered').toString('base64');runtime.sha256=hash('tampered');saveModern();assert.throws(()=>approvedProducers(snapshot),/exact runtime/);
  console.log('Guided preview producers: accepted Git-pinned snapshot required; changed/missing native CI, browser and environment producers cannot self-approve successful evidence.');
} finally {fs.rmSync(root, {recursive: true, force: true});}
