import { createEvidence } from './evidence';
import { publishSuccessor } from './successor-publication';
import { createDockerHubPublisher, type InspectManifest } from './dockerhub-publication';
import type { Environment, Execute, LifecycleEvidencePort, SecurityProfile } from './types';
export * from './types';
export * from './source-identity';
export * from './evidence';
export * from './successor-publication';
export * from './manifest';
export * from './github-source';
export * from './command';
export * from './dockerhub-publication';
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
export { NpmPublicationError, readNpmReceipt, validateNpmPublication } from './npm-identity';
export type { NpmReceipt } from './npm-identity';
export * from './npm-publication.service';
export * from './release.module';
