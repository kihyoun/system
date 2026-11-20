'use strict';
// Compatibility entry point; release decisions live in the compiled operations package.
const {createEvidence, publishSuccessor, command} = require('../operations/dist/release');
const release = require('./security-release.json');
const guided = require('./guided-preview-evidence');
const evidence = createEvidence(release, guided);
function publish(env = process.env, root = process.cwd(), execute = command) {
  return publishSuccessor(evidence, execute, env, root);
}
module.exports = {...evidence, publish};
if (require.main === module) {
  try { const value = publish(); console.log('Published the accepted successor image: ' + value.registryReference); }
  catch (_) { console.error('Successor publication refused; inspect candidate, source and image identity checks.'); process.exitCode = 1; }
}
