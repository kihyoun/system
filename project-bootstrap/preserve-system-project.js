// Keep the server-owned default project across ordinary Wizard configuration Push.
const fs = require('fs');
const marker = '# BOOTSTRAPPER_PROJECT=';
function managed(data) {
  try {
    const line = data.split('\n').find(value => value.startsWith(marker));
    const receipt = JSON.parse(Buffer.from(line.slice(marker.length), 'base64').toString('utf8'));
    return receipt.defaultProject === true && receipt.template === 'wizard';
  } catch (_) { return false; }
}
function preserve(action, file, backup) {
  if (action === 'snapshot') {
    if (fs.existsSync(backup)) fs.unlinkSync(backup);
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      if (managed(data)) fs.writeFileSync(backup, data, {mode: 0o600});
    }
  } else if (action === 'restore' && fs.existsSync(backup)) {
    const data = fs.readFileSync(backup, 'utf8');
    if (!managed(data)) throw Error('Invalid system project snapshot');
    fs.writeFileSync(file + '.tmp', data, {mode: 0o600});
    fs.renameSync(file + '.tmp', file);
    fs.unlinkSync(backup);
  }
}
module.exports = {managed, preserve};
if (require.main === module) preserve(process.argv[2], process.argv[3], process.argv[4]);
