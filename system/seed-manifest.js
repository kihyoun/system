'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function inventory(root) {
  if (fs.existsSync(path.join(root, 'srv/gitlab/data/.system-bootstrapper-restore-incomplete'))) throw new Error('Seed contains an incomplete restore');
  const entries = [];
  function visit(relative) {
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    const record = {path: relative, mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid};
    if (stat.isSymbolicLink()) {
      record.type = 'link'; record.target = fs.readlinkSync(full);
    } else if (stat.isDirectory()) {
      record.type = 'directory';
    } else if (stat.isFile()) {
      record.type = 'file'; record.size = stat.size;
      // Stream large database/registry objects instead of buffering them in RAM.
      const digest = crypto.createHash('sha256');
      const descriptor = fs.openSync(full, 'r');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      try {
        let count;
        while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, count));
      } finally { fs.closeSync(descriptor); }
      record.sha256 = digest.digest('hex');
    } else throw new Error('Unsupported Seed entry type');
    entries.push(record);
    if (record.type === 'directory') fs.readdirSync(full).sort().forEach(name => visit(path.posix.join(relative, name)));
  }
  for (const directory of ['srv', 'ssl', 'letsencrypt']) {
    if (!fs.existsSync(path.join(root, directory))) throw new Error(`Incomplete Seed: missing ${directory}`);
    visit(directory);
  }
  return entries;
}
function durableDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function create(root) {
  const manifest = {format: 'system-bootstrapper-seed-v2', completedAt: new Date().toISOString(),
    consistency: 'gitlab-stopped', gitlabImage: process.env.GITLAB_IMAGE || '',
    gitlabImageId: process.env.GITLAB_IMAGE_ID || '',
    runnerImage: process.env.GITLAB_RUNNER_IMAGE || '', entries: inventory(root)};
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest) + '\n', {mode: 0o600, flush: true});
  manifest.entries.filter(entry => entry.type === 'directory').reverse().forEach(entry => durableDirectory(path.join(root, entry.path)));
  durableDirectory(root);
  return manifest;
}
function verify(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'system-bootstrapper-seed-v2' || manifest.consistency !== 'gitlab-stopped') throw new Error('Unsupported or incomplete Seed manifest');
  if (JSON.stringify(inventory(root)) !== JSON.stringify(manifest.entries)) throw new Error('Seed payload does not match completed manifest');
  if (manifest.gitlabImage && manifest.gitlabImage !== process.env.GITLAB_IMAGE) throw new Error('Restore requires the harvested GitLab version and edition');
  return manifest;
}
function publish(seed, stage) {
  verify(stage);
  const relative = path.posix.join('snapshots', path.basename(stage).replace(/^\.harvest-/, ''));
  fs.mkdirSync(path.join(seed, 'snapshots'), {recursive: true, mode: 0o700});
  fs.renameSync(stage, path.join(seed, relative));
  durableDirectory(path.join(seed, 'snapshots'));
  const next = path.join(seed, '.current-next');
  if (fs.existsSync(next) || (() => {try {return fs.lstatSync(next).isSymbolicLink();} catch {return false;}})()) fs.unlinkSync(next);
  fs.symlinkSync(relative, next);
  fs.renameSync(next, path.join(seed, 'current'));
  durableDirectory(seed);
}
function current(seed) {
  const link = path.join(seed, 'current');
  if (!fs.lstatSync(link).isSymbolicLink()) throw new Error('Seed current must be a snapshot link');
  const relative = fs.readlinkSync(link);
  if (!/^snapshots\/[A-Za-z0-9.-]+$/.test(relative)) throw new Error('Invalid Seed snapshot path');
  const root = path.join(seed, relative);
  if (fs.realpathSync(root) !== path.resolve(seed, relative)) throw new Error('Seed snapshot escapes its root');
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Unsafe Seed snapshot');
  verify(root);
  return root;
}
function markRestore(srv, io = fs) {
  const directory = path.join(srv, 'gitlab/data');
  const marker = path.join(directory, '.system-bootstrapper-restore-incomplete');
  const descriptor = io.openSync(marker, 'w', 0o600);
  try {
    io.writeFileSync(descriptor, 'system-bootstrapper-restore-incomplete\n');
    io.fsyncSync(descriptor);
  } finally { io.closeSync(descriptor); }
  const parent = io.openSync(directory, 'r');
  try { io.fsyncSync(parent); } finally { io.closeSync(parent); }
}
function finishRestore(source, srv, ssl, certbot, io = fs) {
  const manifest = JSON.parse(io.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  const roots = {srv, ssl, letsencrypt: certbot};
  // rsync --fsync persists file bytes; persist destination directory entries,
  // including symlinks and removals, before clearing the restore barrier.
  for (const entry of manifest.entries.filter(entry => entry.type === 'directory').reverse()) {
    const [root, ...relative] = entry.path.split('/');
    if (!roots[root] || relative.some(part => part === '..' || !part)) throw new Error('Invalid restore directory');
    const descriptor = io.openSync(path.join(roots[root], ...relative), 'r');
    try { io.fsyncSync(descriptor); } finally { io.closeSync(descriptor); }
  }
  const directory = path.join(srv, 'gitlab/data');
  io.unlinkSync(path.join(directory, '.system-bootstrapper-restore-incomplete'));
  const descriptor = io.openSync(directory, 'r');
  try { io.fsyncSync(descriptor); } finally { io.closeSync(descriptor); }
}
module.exports = {inventory, create, verify, publish, current, markRestore, finishRestore};
if (require.main === module) {
  try {
    const [command, root, ...arguments_] = process.argv.slice(2);
    if (command === 'create') create(root);
    else if (command === 'verify') verify(root);
    else if (command === 'publish') publish(root, arguments_[0]);
    else if (command === 'current') console.log(current(root));
    else if (command === 'mark-restore') markRestore(root);
    else if (command === 'finish-restore') finishRestore(root, ...arguments_);
    else throw new Error('Unknown Seed manifest command');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
