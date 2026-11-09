'use strict';
const fs = require('fs');
// Same controller functions as the authenticated Wizard; no alternate pipeline.
async function main(args) {
  const setup = require('../../sync/dist/PreviewSetup');
  if (args[0] === 'status' && args.length === 1) return setup.previewSetupStatus();
  if (!['preflight', 'apply'].includes(args[0]) || args.length !== (args[0] === 'apply' ? 3 : 2)) throw Error('Use status, preflight SETTINGS_FILE, or apply SETTINGS_FILE PREFLIGHT_HASH.');
  const stat = fs.lstatSync(args[1]);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20000 || stat.mode & 0o077) throw Error('Use a private regular settings JSON file.');
  const settings = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  if (args[0] === 'preflight') return setup.preflightPreviewSetup({settings});
  const job = setup.applyPreviewSetup({settings, previewHash: args[2]});
  while (job.state === 'running') await new Promise(resolve => setTimeout(resolve, 250));
  if (job.state === 'failed') throw Error(job.message);
  return job;
}
module.exports = {main};
if (require.main === module) main(process.argv.slice(2)).then(value => console.log(JSON.stringify(value))).catch(error => {console.error(error.message); process.exitCode = 1;});
