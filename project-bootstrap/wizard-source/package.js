// Export committed blobs only; never copy the active Wizard working directory.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const safePath = value => typeof value === 'string' && /^[A-Za-z0-9_.@+/-]+$/.test(value) &&
  !value.split('/').some(part => !part || part === '.' || part === '..' || part === '.git');
const excluded = value => value.startsWith('.system-bootstrapper/build-v1/') || value !== '.system-bootstrapper/preflight.env' && value.split('/').some(part =>
  /(?:^|\.)env(?:\.|$)/i.test(part) || /^(?:node_modules|build|dist|coverage|seed|seeds|\.npmrc|\.netrc|credentials(?:\..*)?|id_rsa|id_ed25519)$/i.test(part) || /\.(?:key|pem|p12|pfx)$/i.test(part));
function validate(snapshot) {
  if (snapshot.version !== 1 || !/^[a-f0-9]{40}$/.test(snapshot.sourceRevision) || !Array.isArray(snapshot.files)) throw Error('Invalid Wizard source manifest.');
  const paths = new Set();
  for (const file of snapshot.files) {
    if (!safePath(file.path) || excluded(file.path) || paths.has(file.path) || !['100644', '100755'].includes(file.mode) ||
      typeof file.content !== 'string' || Buffer.from(file.content, 'base64').toString('base64') !== file.content || hash(Buffer.from(file.content, 'base64')) !== file.sha256) throw Error('Invalid Wizard source file.');
    paths.add(file.path);
  }
  if (!paths.has('package.json') || !paths.has('src/api/Helper.tsx') || !paths.has('.gitlab-ci.yml')) throw Error('Incomplete Wizard source.');
  const manifest = {version: snapshot.version, sourceRevision: snapshot.sourceRevision,
    files: snapshot.files.map(({path, mode, sha256}) => ({path, mode, sha256}))};
  if (hash(JSON.stringify(manifest)) !== snapshot.manifestHash) throw Error('Wizard source manifest hash mismatch.');
  return snapshot;
}
function pack(root) {
  const git = (cwd, args) => {
    const gitdir = cwd === root ? process.env.SYSTEM_SOURCE_GIT_DIR : process.env.WIZARD_SOURCE_GIT_DIR;
    return execFileSync('git', ['-c', 'safe.directory=' + cwd, '-C', cwd,
      ...(gitdir ? ['--git-dir=' + gitdir] : []), ...args], {maxBuffer: 16000000});
  };
  const entry = git(root, ['ls-tree', 'HEAD', 'wizard']).toString().trim();
  const match = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(entry);
  if (!match) throw Error('System must pin a Wizard gitlink.');
  const sourceRevision = match[1];
  const wizard = path.join(root, 'wizard');
  const files = [];
  for (const entry of git(wizard, ['ls-tree', '-rz', sourceRevision]).toString().split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if (!match || !safePath(match[4])) throw Error('Unsafe Wizard source path.');
    const [, mode, type, oid, filename] = match;
    if (!['100644', '100755'].includes(mode) || type !== 'blob') throw Error('Wizard source links and nested submodules are unsupported.');
    if (excluded(filename)) continue;
    const content = git(wizard, ['cat-file', 'blob', oid]);
    files.push({path: filename === 'README.md' ? '.system-bootstrapper/SOURCE_README.md' : filename,
      mode, sha256: hash(content), content: content.toString('base64')});
  }
  // The committed dotenv only supplies this known safe build setting. No dotenv is imported.
  const content = Buffer.from('SKIP_PREFLIGHT_CHECK=true\n');
  files.push({path: '.system-bootstrapper/preflight.env', mode: '100644', sha256: hash(content), content: content.toString('base64')});
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifest = {version: 1, sourceRevision, files: files.map(({path, mode, sha256}) => ({path, mode, sha256}))};
  return validate({...manifest, manifestHash: hash(JSON.stringify(manifest)), files});
}
function verifyCommitted(root, snapshot) {
  validate(snapshot);
  // A self-consistent content hash proves integrity, not provenance. Re-read
  // committed Wizard Git objects so a dirty generated snapshot cannot claim a pin.
  const committed = pack(root);
  if (snapshot.sourceRevision !== committed.sourceRevision || snapshot.manifestHash !== committed.manifestHash) {
    throw Error('Wizard snapshot differs from committed source objects. Regenerate it.');
  }
  return snapshot;
}
module.exports = {pack, validate, verifyCommitted, safePath, excluded};
if (require.main === module) {
  const root = path.resolve(__dirname, '../..');
  const output = path.join(__dirname, 'snapshot.json');
  const snapshot = process.argv[2] === '--verify' ? validate(JSON.parse(fs.readFileSync(output, 'utf8'))) : pack(root);
  if (process.argv[2] === '--stdout') process.stdout.write(JSON.stringify(snapshot));
  else {
    if (process.argv[2] !== '--verify') fs.writeFileSync(output, JSON.stringify(snapshot));
    console.log('Wizard source verified: ' + snapshot.sourceRevision + ' (' + snapshot.files.length + ' files)');
  }
}
