'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {validateProducers, approvedProducers} = require('../../project-bootstrap/preview-setup/producers');
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
  console.log('Guided preview producers: accepted Git-pinned snapshot required; changed/missing native CI, browser and environment producers cannot self-approve successful evidence.');
} finally {fs.rmSync(root, {recursive: true, force: true});}
