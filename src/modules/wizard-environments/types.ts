import type { BuildRecipe } from '../project-lifecycle/buildRecipe.service';
import type { CiFile } from '../project-lifecycle/sourcePrimaryEnvironment';
import type { DeploymentSlot } from '../project-lifecycle/types';

export const environmentKinds = ['review', 'beta'] as const;
export type EnvironmentKind = (typeof environmentKinds)[number];
export interface EnvironmentSetting {
  enabled: boolean;
  host: string;
  domainMode: 2;
  ssl: string;
  sslKey: string;
}
export type EnvironmentSettings = Record<EnvironmentKind, EnvironmentSetting>;
export type PlatformSettings = Record<string, string>;
export interface EnvironmentRequest {
  previewHash: string;
  settings: EnvironmentSettings;
}
export type EnvironmentDeployments = Partial<Record<EnvironmentKind, DeploymentSlot>>;
export interface EnvironmentReservation {
  version: number;
  operation: string;
  phase: string;
  settings: EnvironmentSettings;
  settingsHash: string;
  helperImage: string;
  controller: string;
  recipeHash?: string;
  buildRecipeHash?: string;
  activationCommit?: string;
  managementMode?: string;
  ciFiles?: CiFile[];
  deployments?: EnvironmentDeployments;
  previous?: EnvironmentReservation;
  historicalDeployments?: {
    operation: string;
    deployments: EnvironmentDeployments;
    [key: string]: unknown;
  }[];
  externalAttempted?: boolean;
  message?: string;
  [key: string]: unknown;
}
export interface PipelineObservation {
  id?: number;
  sha?: string;
  status?: string;
  [key: string]: unknown;
}
export interface ArtifactObservation {
  imageRef?: string;
  sourceCommit?: string;
  pipelineId?: number;
  [key: string]: unknown;
}
export interface BuildObservation {
  version?: number;
  operation?: string;
  recipeHash: string;
  phase?: string;
  mode?: string;
  activationCommit?: string;
  pipeline?: PipelineObservation | null;
  publishing?: { status?: string; [key: string]: unknown } | null;
  artifact?: ArtifactObservation | null;
  [key: string]: unknown;
}
export interface WizardWorkflow {
  version?: number;
  operation?: string;
  phase?: string;
  sourceRevision: string;
  importCommit?: string;
  build?: BuildObservation;
  environments?: EnvironmentReservation;
  [key: string]: unknown;
}
export interface WizardRepository {
  id: number;
  path: string;
  systemProject: boolean;
  ciPath: string;
  managementMode?: string;
  generatedCi?: string | null;
  [key: string]: unknown;
}
export interface EnvironmentReceipt {
  defaultProject: boolean;
  template: string;
  state: string;
  operation: string;
  namespaceId: string | number;
  repository: WizardRepository;
  wizardWorkflow: WizardWorkflow;
  sourcePrimary?: { version?: number; ciFiles?: CiFile[]; [key: string]: unknown };
  [key: string]: unknown;
}
export interface EnvironmentRecipe {
  version: number;
  recipeHash: string;
  [key: string]: unknown;
}
export interface EnvironmentOutcome {
  environments: EnvironmentReservation;
  message: string;
}
export interface EnvironmentJob {
  id: string;
  state: string;
  created?: number;
  message?: string;
  environments?: EnvironmentReservation;
  [key: string]: unknown;
}
export interface NotActivated {
  state: 'not-activated';
  message: string;
}
export interface EnvironmentContext {
  primary: boolean;
  content: string;
  mainContent: string;
  receipt: EnvironmentReceipt;
  platform: PlatformSettings;
  current?: EnvironmentReservation;
  settings: EnvironmentSettings;
  settingsHash: string;
  helperImage: string;
  controller: string;
  legacyRecipe?: BuildRecipe;
  registryPrefix: string;
  initialVerified: boolean;
  reasons: string[];
  canUpdate: boolean;
  previewHash: string;
}
export interface EnvironmentPreview {
  version: 1;
  previewHash: string;
  settingsHash: string;
  settings: EnvironmentSettings;
  environments?: EnvironmentReservation;
  repository: WizardRepository;
  capabilities: {
    canActivate: boolean;
    canUpdate: boolean;
    reasons: string[];
    reviewLease: 'single-active-mr';
    manualJobsOnly: true;
    productionDeployment: false;
  };
  message: string;
}
export interface Preparation {
  operation: string;
  previewHash: string;
  settingsHash: string;
}
export interface EnvironmentExecution {
  mode: 'activate' | 'status';
  context: EnvironmentContext;
  selected: EnvironmentSettings;
  selectedHash: string;
  updating: boolean;
  reservation: EnvironmentReservation;
  recipe: EnvironmentRecipe;
}
