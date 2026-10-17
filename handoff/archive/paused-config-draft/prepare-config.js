// Keep wizard uploads outside the bootstrapper container's writable layer.
const fs = require('fs');
const path = require('path');

function prepare(systemDir, stateDir) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  for (const name of ['.docker.env', '.projects.env']) {
    const local = path.join(systemDir, name);
    const saved = path.join(stateDir, name);
    const entry = fs.lstatSync(local, { throwIfNoEntry: false });
    if (entry && entry.isSymbolicLink()) {
      if (fs.readlinkSync(local) !== saved) throw new Error('Unexpected configuration link: ' + local);
      continue;
    }
    // Import only once. A container image may contain an older configuration.
    if (entry && !fs.existsSync(saved)) {
      fs.cpSync(local, saved, { recursive: true, preserveTimestamps: true });
    }
    if (name === '.projects.env') fs.mkdirSync(saved, { recursive: true, mode: 0o700 });
    if (fs.existsSync(saved)) fs.chmodSync(saved, name === '.docker.env' ? 0o600 : 0o700);
    if (entry) fs.rmSync(local, { recursive: true });
    fs.symlinkSync(saved, local);
  }
}

module.exports = prepare;
if (require.main === module) {
  prepare(__dirname, process.env.BOOTSTRAPPER_CONFIG_DIR || '/config');
}
