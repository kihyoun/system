import type { PreviewSettings } from '../project-lifecycle/previewSettings';

export type NamespaceId = string | number;
export type ApplicationTemplate = 'empty' | 'angular' | 'react' | 'web' | 'wizard';

export interface ProjectCreationInput {
  projectKey: string;
  namespaceId: NamespaceId;
  data: string;
  template?: ApplicationTemplate;
  ci?: string;
}

export interface SourceInitializationInput {
  manifestHash: string;
}

export interface BuildActivationInput {
  recipeHash: string;
}

export interface PreviewSetupInput {
  settings: PreviewSettings;
  previewHash?: string | null;
}

export interface PipelineIdentity {
  id?: number;
  sha?: string;
  status?: string;
  webUrl?: string;
}

export interface BuildArtifact {
  sourceCommit?: string;
  pipelineId?: number;
  imageRef?: string;
}

export interface WizardBuildState {
  version?: number;
  operation?: string;
  mode?: string;
  recipeHash?: string;
  phase?: string;
  activationCommit?: string;
  message?: string;
  pipeline?: PipelineIdentity | null;
  publishing?: PipelineIdentity | null;
  artifact?: BuildArtifact | null;
}

export interface EnvironmentSettings {
  review: EnvironmentSetting;
  beta: EnvironmentSetting;
}

export interface EnvironmentSetting {
  enabled: boolean;
  host: string;
  domainMode: 2;
  ssl: string;
  sslKey: string;
}

/** Deployment evidence remains untrusted until its owning lifecycle validates it. */
export interface DeploymentFootprint {
  active?: unknown;
  pending?: unknown;
  retired?: unknown[];
  tombstone?: unknown;
  lastPipelineId?: number;
  stoppedThroughPipelineId?: number;
}

export interface EnvironmentSummary {
  version?: number;
  phase?: string;
  operation?: string;
  managementMode?: string;
  settings?: EnvironmentSettings;
  settingsHash?: string;
  helperImage?: string;
  controller?: string;
  recipeHash?: string;
  buildRecipeHash?: string;
  activationCommit?: string;
  externalAttempted?: boolean;
  deployments?: Partial<Record<'review' | 'beta', DeploymentFootprint>>;
  previous?: EnvironmentSummary | null;
  historicalDeployments?: unknown[];
  desiredSettings?: PreviewSettings;
}

export interface WizardWorkflow {
  version?: number;
  operation?: string;
  sourceRevision?: string;
  sourceLayout?: string;
  wizardSourceTree?: string;
  manifestHash?: string;
  importCommit?: string;
  phase?: string;
  message?: string;
  build?: WizardBuildState | null;
  environments?: EnvironmentSummary | null;
}

export interface ProjectRepository {
  id?: number;
  namespaceId?: NamespaceId;
  path?: string;
  defaultBranch?: string;
  ciPath?: string;
  generatedCi?: string | null;
  systemProject?: boolean;
  managementMode?: string;
  deploymentState?: string;
  webUrl?: string;
  pipelineUrl?: string;
  initialPipeline?: PipelineIdentity | null;
}

export interface ProjectReceipt {
  operation?: string;
  fingerprint?: string;
  namespaceId?: NamespaceId;
  template?: string;
  defaultProject?: boolean;
  state?: string;
  repository?: ProjectRepository | null;
  wizardWorkflow?: WizardWorkflow | null;
  sourcePrimary?: unknown;
}

export interface ManagedWizardReceipt extends ProjectReceipt {
  operation: string;
  namespaceId: NamespaceId;
  template: 'wizard';
  defaultProject: true;
  state: 'complete';
  repository: ProjectRepository & { id: number; path: string; ciPath: string };
}

export interface PreviewSourceProject {
  id: number;
  namespaceId: number;
  path: string;
  defaultBranch: string;
  sourceRevision: string;
}

export interface NativeProjectResult {
  state?: string;
  message?: string;
  conflict?: boolean;
  availability?: string;
  path?: string;
  repository?: ProjectRepository | null;
  namespaces?: { id: number; path: string }[];
  namespaceId?: number;
  projects?: PreviewSourceProject[];
  pipeline?: PipelineIdentity | null;
  build?: WizardBuildState | null;
  sourceRevision?: string;
  importCommit?: string;
  environments?: unknown;
  credentials?: unknown[];
}

export interface ProjectJobEnvelope {
  id: string;
  state: string;
  created?: number;
  message?: string;
  uncertain?: boolean;
  uncertainAction?: unknown;
  [key: string]: unknown;
}

export type ProjectJob<Result extends object = NativeProjectResult> = ProjectJobEnvelope &
  Partial<Result>;

export interface NativeProjectRequest {
  action: string;
  [key: string]: unknown;
}
