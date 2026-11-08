'use strict';
// CI uses Node already present in the source-packaging job. The authoring
// generator remains docs/export-wizard-docs.py; this independently checks its
// public inputs and full-text preservation before packaging the exact gitlink.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function check(root) {
  const content = JSON.parse(fs.readFileSync(path.join(root, 'wizard/src/docs/content.json'), 'utf8'));
  if (!content || !Array.isArray(content.chapters) || !content.sources ||
      !Object.keys(content.sources).length || new Set(content.chapters.map(c => c.id)).size !== content.chapters.length)
    throw Error('A complete unique documentation chapter catalog is required.');
  for (const [source, expected] of Object.entries(content.sources)) {
    if (!/^[A-Za-z0-9_.\/-]+\.md$/.test(source) || source.split('/').includes('..'))
      throw Error('Documentation source must be a repository Markdown path.');
    const raw = fs.readFileSync(path.join(root, source));
    if (crypto.createHash('sha256').update(raw).digest('hex') !== expected)
      throw Error('Bundled Wizard docs are stale; regenerate from repository sources.');
    const chapters = content.chapters.filter(c => c.source === source && Number.isInteger(c.sourceStart))
      .sort((a, b) => a.sourceStart - b.sourceStart);
    if (!chapters.length || chapters[0].sourceStart !== 0 ||
        chapters.map(c => c.markdown).join('') !== raw.toString('utf8'))
      throw Error('The complete original guide must remain available in Docs.');
  }
  return content.chapters.length;
}
module.exports = {check};
if (require.main === module) {
  try { console.log('Bundled Wizard docs verified: ' + check(path.resolve(__dirname, '..')) + ' chapters.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
