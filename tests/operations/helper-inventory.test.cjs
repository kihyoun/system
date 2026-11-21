'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {helperInventory} = require('../../dist/modules/project-lifecycle/helper-inventory');
test('helper identity includes compiled implementation, native adapters and resolved runtime dependencies', () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-inventory-'));
 const write = (name, text) => {const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text);};
 try {
  write('templates/project-bootstrap/fixture.txt', 'template');
  write('dist/modules/project-lifecycle/state.js', 'compiled');
  write('assets/wizard-source/snapshot.json', '{}');
  write('package.json', JSON.stringify({name: 'fixture', dependencies: {fixture: '1.0.0'}}));
  write('node_modules/fixture/package.json', JSON.stringify({name: 'fixture', version: '1.0.0', main: 'index.js'}));
  write('node_modules/fixture/index.js', 'runtime');
  for (const name of ['cacert-2026-10-20.crt', 'provenance.json']) write('config/ca/' + name, 'fixture');
  write('tools/gitlab/bootstrap-token.rb', 'bootstrap adapter');
  const baseline = helperInventory(root);
  for (const name of ['templates/project-bootstrap/fixture.txt', 'dist/modules/project-lifecycle/state.js', 'config/ca/provenance.json', 'assets/wizard-source/snapshot.json', 'node_modules/fixture/index.js', 'tools/gitlab/bootstrap-token.rb']) {
   const before = fs.readFileSync(path.join(root, name));
   write(name, 'changed'); assert.notEqual(helperInventory(root), baseline, name);
   write(name, before); assert.equal(helperInventory(root), baseline);
  }
  fs.symlinkSync('/outside', path.join(root, 'dist/modules/link'));
  assert.throws(() => helperInventory(root), /links are unsupported/);
 } finally {fs.rmSync(root, {recursive: true, force: true});}
});
