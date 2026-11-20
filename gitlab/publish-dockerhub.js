'use strict';
// Compatibility entry point; the operations module owns publication decisions.
const {createEvidence, createDockerHubPublisher} = require('../operations/dist/release');
const evidence = createEvidence(require('./security-release.json'), require('./guided-preview-evidence'));
const publisher = createDockerHubPublisher(evidence);
module.exports = publisher;
if (require.main === module) publisher.publish().then(value => {
  console.log('Published accepted controller: ' + value.controller.reference);
  console.log('Published accepted Wizard: ' + value.wizard.reference);
  console.log('Release receipt: test-results/dockerhub/release.json (with SHA-256 sidecar).');
}).catch(() => {
  console.error('Docker Hub publication refused; check protected source, complete candidate evidence, immutable tags and anonymous pulls.');
  process.exitCode = 1;
});
