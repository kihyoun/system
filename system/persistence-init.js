'use strict';
// Stable compatibility links let existing shell readers keep their paths. Sync
// writes/deletes the canonical SYSTEM_CONFIG_DIR path, never the file symlink.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function initializeState(stateDir, runtimeDir) {
  if (fs.realpathSync(stateDir) === fs.realpathSync(runtimeDir)) throw new Error('Configuration must be separate from runtime source');
  fs.chmodSync(stateDir, 0o700);
  const initializedMarker = path.join(stateDir, '.configuration-initialized');
  const initialized = fs.existsSync(initializedMarker);
  if (initialized && (fs.lstatSync(initializedMarker).isSymbolicLink() || fs.readFileSync(initializedMarker, 'utf8') !== 'v1\n')) throw new Error('Invalid configuration initialization marker');
  const migrate = (name, directory) => {
    const source = path.join(runtimeDir, name);
    const target = path.join(stateDir, name);
    const sourceStat = fs.lstatSync(source, {throwIfNoEntry: false});
    const alreadyLinked = sourceStat && sourceStat.isSymbolicLink();
    if (alreadyLinked) {
      if (path.resolve(path.dirname(source), fs.readlinkSync(source)) !== target) throw new Error(`Unexpected configuration link: ${name}`);
    }
    const targetStat = fs.lstatSync(target, {throwIfNoEntry: false});
    if (targetStat && (targetStat.isSymbolicLink() || (directory ? !targetStat.isDirectory() : !targetStat.isFile()))) throw new Error(`Unsafe configuration destination: ${name}`);
    // The attached volume always wins over configuration baked into an image.
    if (!initialized && !targetStat && sourceStat && !alreadyLinked) {
      if (directory ? !sourceStat.isDirectory() : !sourceStat.isFile()) throw new Error(`Unexpected configuration source: ${name}`);
      fs.cpSync(source, target, {recursive: directory, dereference: false, errorOnExist: true, force: false});
    }
    if (directory) fs.mkdirSync(target, {recursive: true, mode: 0o700});
    if (fs.existsSync(target)) fs.chmodSync(target, directory ? 0o700 : 0o600);
    if (alreadyLinked) return;
    if (sourceStat) fs.rmSync(source, {recursive: directory});
    fs.symlinkSync(target, source, directory ? 'dir' : 'file');
  };
  migrate('.docker.env', false);
  migrate('.projects.env', true);
  const authFile = path.join(stateDir, 'sync-auth.env');
  if (!fs.existsSync(authFile)) {
    const username = 'bootstrapper_' + crypto.randomBytes(8).toString('hex');
    const password = crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(authFile, `export SYNC_USER=${username}\nexport SYNC_PASS=${password}\n`, {mode: 0o600, flag: 'wx'});
  }
  if (!fs.lstatSync(authFile).isFile() || fs.lstatSync(authFile).isSymbolicLink()) throw new Error('Invalid persistent Sync authentication file');
  fs.chmodSync(authFile, 0o600);
  if (!initialized) fs.writeFileSync(initializedMarker, 'v1\n', {mode: 0o600, flag: 'wx'});
}

if (require.main === module) {
  const stateDir = path.resolve(process.env.SYSTEM_CONFIG_DIR || '/state');
  const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n');
  if (!mounts.some(line => line.split(' ')[4] === stateDir)) throw new Error('Persistent configuration directory must be a mounted volume');
  initializeState(stateDir, path.resolve(__dirname));
}
module.exports = {initializeState};
