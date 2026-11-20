'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {helperInventory} = require('../dist/project-lifecycle/helper-inventory');
test('helper identity includes compiled implementation, native adapters and resolved runtime dependencies', () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-inventory-'));
 const write = (name, text) => {const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text);};
 try {
  write('project-bootstrap/helper.js', 'adapter');
  write('operations/dist/project-lifecycle/state.js', 'compiled');
  write('operations/package.json', JSON.stringify({name: 'fixture', dependencies: {fixture: '1.0.0'}}));
  write('operations/node_modules/fixture/package.json', JSON.stringify({name: 'fixture', version: '1.0.0', main: 'index.js'}));
  write('operations/node_modules/fixture/index.js', 'runtime');
  for (const name of ['ca/cacert-2026-10-20.crt', 'ca/provenance.json', 'ca/check.js']) write('bootstrapper/' + name, 'fixture');
  write('tools/gitlab/bootstrap-token.rb', 'bootstrap adapter');
  const baseline = helperInventory(root);
  for (const name of ['project-bootstrap/helper.js', 'operations/dist/project-lifecycle/state.js', 'operations/node_modules/fixture/index.js', 'tools/gitlab/bootstrap-token.rb']) {
   const before = fs.readFileSync(path.join(root, name));
   write(name, 'changed'); assert.notEqual(helperInventory(root), baseline, name);
   write(name, before); assert.equal(helperInventory(root), baseline);
  }
  fs.symlinkSync('/outside', path.join(root, 'operations/dist/link'));
  assert.throws(() => helperInventory(root), /links are unsupported/);
 } finally {fs.rmSync(root, {recursive: true, force: true});}
});
