'use strict';
const {execFileSync} = require('node:child_process');
// Inspect metadata before extraction: a post-extraction symlink check is too late.
function validateArchive(filename) {
  const options = {encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024};
  const names = execFileSync('unzip', ['-Z1', filename], options).trim().split('\n');
  if (!names.length || names.length > 1000 || new Set(names).size !== names.length || names.some(name =>
    !/^(?:\.[A-Za-z0-9_-]+\.env|\.projects\.env\/(?:[A-Za-z0-9_.-]+\.env)?|bootstrapper\.json|recovery\.json|RECOVERY\.md)$/.test(name)))
    throw Error('Configuration archive contains unsupported or duplicate entries.');
  const metadata = execFileSync('unzip', ['-Z', '-l', filename], options);
  const entries = metadata.split('\n').map(line => /^(\S[rwxstST-]{6}(?:[rwxstST-]{3})?)\s+\d+\.\d+\s+(\S+)\s+([0-9]+)\s/.exec(line)).filter(Boolean);
  if (entries.length !== names.length || entries.some(entry =>
    !['-', 'd', '?'].includes(entry[1][0]) || !(entry[1].length === 10 || entry[1].length === 7 && entry[2] === 'fat')) ||
    entries.reduce((total, entry) => total + Number(entry[3]), 0) > 32 * 1024 * 1024)
    throw Error('Configuration archive contains unsafe entries or is too large.');
  return names;
}
module.exports = {validateArchive};
if (require.main === module) {
  try { validateArchive(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
