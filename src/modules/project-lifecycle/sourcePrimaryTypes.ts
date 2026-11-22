import { CiFile, PreviousEnvironment } from './sourcePrimaryEnvironment';
import { ProjectRow, PipelineRow, JobRow } from './upgradeTypes';
export interface SourceRepository {
  id: number;
  path: string;
  defaultBranch: string;
  namespaceId?: number;
  managementMode?: string;
  ciPath: string;
  systemProject: boolean;
  recoveryImages?: { projectId: number; projectPath: string; imageRef?: string }[];
  webUrl?: string;
  pipelineUrl?: string;
}
export interface PrimaryWorkflow {
  version?: number;
  phase?: string;
  sourceRevision?: string;
  build: {
    version?: number;
    mode?: string;
    recipeHash: string;
    phase?: string;
    pipeline?: unknown;
    publishing?: unknown;
    artifact?: unknown;
  };
  environments: PreviousEnvironment & {
    helperImage?: string;
    activationCommit?: string;
    controller?: string;
    ciFiles?: CiFile[];
    recipeHash?: string;
    initialVariablesMissing?: boolean;
  };
}
export interface PrimaryIdentity {
  version: number;
  operation: string;
  adoptionCommit: string;
  ciFiles: CiFile[];
  inputHash?: string;
  pipelineId?: number;
  previousRepository?: { id: number; path: string };
  bootstrap?: boolean;
  archive?: string;
}
export interface ManagedReceipt {
  defaultProject: boolean;
  template: string;
  state: string;
  operation: string;
  namespaceId: number;
  repository: SourceRepository;
  sourcePrimary?: PrimaryIdentity;
  wizardWorkflow?: PrimaryWorkflow;
}
export interface PrimaryReceipt extends ManagedReceipt {
  sourcePrimary: PrimaryIdentity;
}
export interface NativeProject extends ProjectRow {
  namespace?: { id: number };
  only_allow_merge_if_pipeline_succeeds: boolean;
  only_allow_merge_if_all_discussions_are_resolved: boolean;
}
export interface NativePipeline extends PipelineRow {
  ref: string;
  yaml_errors?: unknown;
}
export interface NativeJob extends JobRow {
  pipeline?: { id: number };
}
export type SourceGet = (route: string) => Promise<unknown>;
export interface AdoptionInput {
  version: number;
  projectId: number;
  projectPath: string;
  namespaceId: number;
  defaultBranch: string;
  pipelineId: number;
  sourceCommit: string;
  imageRef: string;
  helperImage: string;
  ciFiles: CiFile[];
  buildProfile?: string;
  action?: string;
}
export interface AdoptionPlan {
  version: number;
  action: string;
  operation: string;
  previousProjectId: number;
  projectId: number;
  projectPath: string;
  sourceCommit: string;
  pipelineId: number;
  imageRef: string;
  retainedProductionImageRef?: string;
  previousImageRef?: string;
  helperImage: string;
  buildProfile?: string;
  previousBuildRecipeHash?: string;
  buildRecipeHash?: string;
  configHash: string;
  mainConfigHash: string;
  nextReceiptHash: string;
}
