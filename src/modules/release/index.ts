import { createEvidence } from './evidence';
import { publishSuccessor } from './successorPublication';
import { createDockerHubPublisher, type InspectManifest } from './dockerhubPublication';
import type { Environment, Execute, LifecycleEvidencePort, SecurityProfile } from './types';
export * from './types';
export * from './sourceIdentity';
export * from './evidence';
export * from './successorPublication';
export * from './manifest';
export * from './githubSource';
export * from './command';
export * from './dockerhubPublication';
/** Constructible by CLI or a Nest provider without starting an HTTP application. */
export class ReleaseService {
  readonly evidence: ReturnType<typeof createEvidence>;
  constructor(
    profile: SecurityProfile,
    lifecycle: LifecycleEvidencePort,
    private readonly execute: Execute,
  ) {
    this.evidence = createEvidence(profile, lifecycle);
  }

  publish(env: Environment = process.env, root: string = process.cwd()) {
    return publishSuccessor(this.evidence, this.execute, env, root);
  }

  publishDockerHub(
    env: Environment = process.env,
    root: string = process.cwd(),
    inspectManifest?: InspectManifest,
  ) {
    return createDockerHubPublisher(this.evidence).publish(
      env,
      root,
      this.execute,
      inspectManifest,
    );
  }
}
export { NpmPublicationError, readNpmReceipt, validateNpmPublication } from './npmIdentity';
export type { NpmReceipt } from './npmIdentity';
export * from './npmPublication.service';
export * from './release.module';

export * from './githubPublication.service';
export * from './githubAcceptance';
export * from './githubMetadata';
export * from './githubPresentation';
export * from './githubTransport';
export * from './publicUpgradeAssets';

export * from './publicationRuntime';
export { lifecyclePolicy } from './lifecyclePolicy';
