import { DeploymentRequest } from './types';
import { Workflow, EnvironmentReservation } from './upgrade-types';
export interface RuntimeContext {
  contentHash: string;
  publicSettings: Record<string, string>;
  systemBetaBinding?: unknown;
  systemBetaBindingHash?: string;
  systemReviewBinding?: unknown;
  receipt: {
    operation: string;
    repository: {
      id: number;
      path: string;
      defaultBranch: string;
      namespaceId: number;
      managementMode?: string;
    };
    sourcePrimary?: { version: number; ciFiles: unknown };
    wizardWorkflow: Omit<Workflow, 'build' | 'environments'> & {
      build: Workflow['build'] & { mode?: string };
      environments: EnvironmentReservation & { ciFiles?: unknown };
    };
  };
}
export interface EnvironmentInspection {
  labels?: Record<string, string>;
  running?: boolean;
  image?: string;
  networks?: Record<string, { IPAddress: string }>;
  containers?: Record<string, unknown>;
}
export interface SystemBinding {
  helperImage: string;
  wizardImageRef: string;
  wizardImageId: string;
  sourceCommit: string;
  wizardRevision?: string;
  candidateJobId: number;
}
export interface SystemBindingAdapter {
  validate(binding: unknown, context: RuntimeContext, request: DeploymentRequest): SystemBinding;
}
export interface ImageRow {
  Id: string;
  Config?: { Labels?: Record<string, string> };
}
