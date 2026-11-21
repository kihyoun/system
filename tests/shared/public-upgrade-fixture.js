'use strict';
const security = require('../../config/gitlab/security-release.json');
const id = char => 'sha256:' + char.repeat(64);
function publicationFixture() {
  const previous = {format:'system-accepted-release-v1',version:'1.1.3',tag:'v1.1.3',platform:'linux/amd64',
    source:{repository:'https://github.com/example/system.git',revision:'a'.repeat(40),tree:'b'.repeat(40),wizardRevision:'c'.repeat(40)},
    acceptance:{requiredChecksPassed:true,controllerWizardSameAttempt:true,candidateJobId:29},
    images:{controller:{reference:'example/system@'+id('e'),imageId:id('d'),configDigest:id('d')},wizard:{reference:'example/wizard@'+id('9'),imageId:id('8'),configDigest:id('8')}}};
  return {runId:'f'.repeat(24),previous,live:'/fixture/live',gitlabUpgrade:{fromImage:security.fromImage,toImage:security.toImage,
    fromImageId:id('3'),toImageId:id('4'),checkpointVerified:true,migrationVerified:true,registryVerified:true,
    runnerImage:security.runner.toImage,runnerVersion:security.runner.toVersion,helperImage:security.runner.helperImage,jobCaBundleSha256:security.jobCaBundleSha256,
    runnerImageId:id('5'),fromRunnerImageId:id('6'),helperImageId:id('7'),fromHelperImageId:id('9'),securityTrustVerified:true,runnerUpgradeVerified:true},
    spec:{sourceRevision:previous.source.revision,sourceTree:previous.source.tree,wizardSourceRevision:previous.source.wizardRevision,
      ciIdentity:{projectId:4,pipelineId:17,candidateJobId:29},images:{candidate:{id:id('d'),configDigest:id('2')},wizard:{id:id('8'),configDigest:id('3')},gitlab:{id:id('4')},runner:{id:id('5')}}}};
}
module.exports = {publicationFixture};
