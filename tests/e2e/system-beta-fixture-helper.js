'use strict';
// This executable belongs only to the disposable test harness. Production
// launchers never import it and have no switch for selecting this verifier.
async function execute(input) {
  if(input.fixtureNamespace!=='system-beta-contract-fixture-v1'||input.verifierMode!=='contract-fixture'||
    input.verifierPassed!==true||input.negativeGatesPassed!==true||!/^[a-f0-9]{24}$/.test(input.owner||''))throw Error('Explicit disposable contract fixture required.');
  const {Runtime}=require('/system/project-bootstrap/wizard-environments/helper');
  const {validate}=require('/system/project-bootstrap/system-beta/binding');
  class DisposableRuntime extends Runtime {
    async verifyInput(value) {
      const binding=validate(value.binding,this.context,this.request);
      if(binding.helperImage!==input.helperImage||binding.wizardImageId!==input.wizardImageId||binding.wizardImageRef!==input.wizardImageRef||
        binding.sourceCommit!==input.request.sourceCommit||binding.candidateJobId!==input.fixtureCandidateJobId)
        throw Error('Fixture identity changed.');
      // Pipeline authorization is tested separately by the unchanged Ruby
      // verifier and negative cases. This result makes no native CI claim.
      return {ok:true,imageRef:binding.wizardImageRef,helperImage:binding.helperImage};
    }
  }
  return new DisposableRuntime(input.request).run();
}
module.exports={execute};
