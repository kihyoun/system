import type { ProcessOptions } from '../runtime/process';
export type Environment = Record<string, string | undefined>;
export type CommandOptions = ProcessOptions;
export type Execute = (binary: string, args: string[], options?: CommandOptions) => string;
export interface CiIdentity {
  sourceLayout?: string;
  sourceTree?: string;
  wizardSourceTree?: string;
  sourceRevision: string;
  projectId?: number;
  pipelineId?: number;
  candidateJobId?: number;
}
export interface PublicationContext extends Omit<
  CiIdentity,
  'sourceLayout' | 'sourceTree' | 'wizardSourceTree'
> {
  projectId: number;
  pipelineId: number;
  candidateJobId: number;
  registryRepository: string;
}
export interface SecurityProfile {
  fromImage: string;
  toImage: string;
  runner: { toImage: string; toVersion: string; helperImage: string };
  jobCaBundleSha256: string;
}
export interface Stage {
  name: string;
  status: string;
}
export interface CandidateProof {
  format?: string;
  runId: string;
  sourceRevision: string;
  sourceLayout?: string;
  sourceTree?: string;
  wizardSourceTree?: string;
  fullAcceptance: boolean;
  images: Record<string, string>;
  results: Stage[];
  ciIdentity?: Omit<CiIdentity, 'sourceRevision'>;
  evidence: {
    gitlabUpgrade: Record<string, unknown>;
    storage?: Record<string, unknown>;
    recovery?: Record<string, unknown>;
    guidedPreview?: unknown;
    [key: string]: unknown;
  };
  guidedPreviewReceipt?: CandidateProof;
}
/** Required, injected product-specific acceptance policy. No permissive default. */
export interface LifecycleEvidencePort {
  stages: readonly string[];
  stagesV2: readonly string[];
  validateAuthority(
    value: unknown,
    results: Stage[],
    context: CiIdentity & {
      candidateImageId: string;
      wizardImageId: string;
      ciIdentity?: Omit<CiIdentity, 'sourceRevision'>;
    },
  ): { productionImageId: string };
  validate(value: unknown, results: Stage[]): { productionImageId: string };
  sanitize(value: unknown): unknown;
}
export type SourceIdentity =
  | {
      sourceLayout?: undefined;
      sourceRevision: string;
      sourceTree: string;
      wizardRevision: string;
      wizardSourceTree?: never;
    }
  | {
      sourceLayout: 'system-monorepo-v1';
      sourceRevision: string;
      sourceTree: string;
      wizardSourceTree: string;
      wizardRevision?: never;
    };
export type SuccessorRelease = SourceIdentity &
  PublicationContext & {
    format: 'system-successor-release-v1';
    imageId: string;
    registryReference: string;
    candidateEvidenceSha256: string;
    wizardImageId: string;
    wizardRegistryReference: string;
    candidateEvidencePath: 'test-results/successor/candidate-results.json';
  };
