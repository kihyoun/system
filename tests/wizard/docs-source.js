'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {check} = require('../../docs/check-wizard-docs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-docs-source-'));
try {
  fs.mkdirSync(path.join(root, 'wizard/src/docs'), {recursive: true});
  fs.mkdirSync(path.join(root, 'docs'));
  const text = '# Install\n\n```sh\necho hello\n```\n\n## Configure\nMore details.\n';
  fs.writeFileSync(path.join(root, 'docs/guide.md'), text);
  const split = text.indexOf('## Configure');
  const content = {sources: {'docs/guide.md': crypto.createHash('sha256').update(text).digest('hex')}, chapters: [
    {id: 'installation', source: 'docs/guide.md', sourceStart: 0, markdown: text.slice(0, split)},
    {id: 'configuration', source: 'docs/guide.md', sourceStart: split, markdown: text.slice(split)}]};
  const output = path.join(root, 'wizard/src/docs/content.json');
  const save = data => fs.writeFileSync(output, JSON.stringify(data));
  save(content); assert.equal(check(root), 2);
  fs.appendFileSync(path.join(root, 'docs/guide.md'), 'Changed\n');
  assert.throws(() => check(root), /stale/);
  fs.writeFileSync(path.join(root, 'docs/guide.md'), text);
  for (const mutate of [
    c => { c.chapters.pop(); }, c => { c.chapters[1].markdown = 'Summary replacing the guide'; },
    c => { c.chapters[0].id = c.chapters[1].id; }, c => { c.sources['../private.md'] = '0'.repeat(64); },
  ]) {
    const changed = structuredClone(content); mutate(changed); save(changed);
    assert.throws(() => check(root));
  }
  console.log('Wizard Docs source drift, complete guide preservation, chapter identity and path boundaries passed.');
} finally { fs.rmSync(root, {recursive: true, force: true}); }
