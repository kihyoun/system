'use strict';
const fs = require('node:fs');
const path = require('node:path');
function includes(root) {
  const paths = ['.'];
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw Error('Prepared static source must not contain links.');
      if (!entry.isDirectory()) continue;
      if (entry.name === '.git' || entry.name === 'node_modules') throw Error('Prepared static source contains Git metadata or dependencies.');
      const name = path.posix.join(relative, entry.name);
      if (entry.name.startsWith('.')) paths.push(name);
      walk(name);
    }
  }
  walk('');
  return paths;
}
module.exports = {includes};
if (require.main === module) {
  try { console.log(includes(path.resolve(process.argv[2])).join('\n')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
