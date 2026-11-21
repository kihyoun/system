import { DeploymentSlot, EnvironmentKind, EnvironmentSetting } from './types';
export interface SourceIdentity {
  sourceLayout?: string;
  wizardSourceTree?: string;
}
export interface SourceFile {
  path: string;
  mode: string;
  sha256: string;
  content: string;
}
export interface SourceSnapshot extends SourceIdentity {
  version: number;
  sourceRevision: string;
  manifestHash: string;
  files: SourceFile[];
}
export interface Recipe {
  recipeHash: string;
  ci: string;
  profile?: string;
  files: { path: string; content: string; sha256: string }[];
}
export interface BuildReservation {
  version: number;
  operation: string;
  recipeHash: string;
  activationCommit?: string;
}
export interface EnvironmentReservation {
  version?: number;
  managementMode?: string;
  systemSource?: Record<string, unknown>;
  historicalDeployments?: unknown;
  operation: string;
  controller: string;
  phase: string;
  settingsHash: string;
  helperImage: string;
  buildRecipeHash?: string;
  recipeHash: string;
  activationCommit: string;
  settings: Record<EnvironmentKind, EnvironmentSetting>;
  deployments?: Partial<Record<EnvironmentKind, DeploymentSlot>>;
}
export interface Workflow extends SourceIdentity {
  sourceRevision: string;
  manifestHash: string;
  importCommit: string;
  build: BuildReservation;
  environments: EnvironmentReservation;
  upgradeHistory?: { operation: string; [key: string]: unknown }[];
}
export interface UpgradeReceipt {
  operation: string;
  defaultProject: boolean;
  template: string;
  state: string;
  repository: {
    id: number;
    systemProject: boolean;
    ciPath: string;
    managementMode?: string;
    path: string;
    defaultBranch: string;
  };
  wizardWorkflow: Workflow;
}
export interface UpgradePlan {
  version: number;
  operation: string;
  projectId: number;
  projectPath: string;
  defaultBranch: string;
  expectedHead: string;
  configHash: string;
  mainConfigHash: string;
  requiresFastForward: boolean;
  mergeMethod: string;
  sourceRevision: string;
  manifestHash: string;
  buildRecipeHash: string;
  environmentRecipeHash: string;
  helperImage: string;
  branch: string;
  updates: string[];
  deletes: string[];
  scope?: string;
  managedPaths?: string[];
  preservedTreeHash?: string;
}
export interface UpgradeCheckpoint {
  version: number;
  phase: string;
  plan: UpgradePlan;
  planHash: string;
  originalConfiguration: string;
  receipt: UpgradeReceipt;
  commits: Record<string, string>;
  intents: Record<string, { parent: string; actionsHash: string }>;
  branchIntent?: boolean;
  mrIntent?: boolean;
  mr?: { iid: number; webUrl: string };
  adoptedConfigHash?: string;
}
export interface CommitAction {
  action: string;
  file_path: string;
  content?: string;
  encoding?: string;
  execute_filemode?: boolean;
}
export interface FileRow {
  content: string;
  last_commit_id: string;
  execute_filemode: boolean;
}
export interface TreeRow {
  type: string;
  path: string;
  mode: string;
  id: string;
}
export interface ProjectRow {
  visibility: string;
  id: number;
  path_with_namespace: string;
  default_branch: string;
  ci_config_path: string;
  description: string;
  merge_method: string;
}
export interface CommitRow {
  id: string;
  parent_ids: string[];
}
export interface BranchRow {
  name: string;
  commit: CommitRow;
}
export interface MrRow {
  source_project_id: number;
  target_project_id: number;
  source_branch: string;
  target_branch: string;
  state: string;
  iid: number;
  web_url: string;
  sha: string;
  squash_commit_sha?: string;
}
export interface PipelineRow {
  id: number;
  sha: string;
  source: string;
  status: string;
  web_url: string;
}
export interface JobRow {
  id: number;
  name: string;
  status: string;
  allow_failure: boolean;
  commit?: { id: string };
}
export interface ArtifactRow {
  version: number;
  sourceCommit: string;
  pipelineId: number;
  imageRef: string;
  unitTests?: boolean;
  testRunner?: string;
  lint?: boolean;
  typecheck?: boolean;
  productionBuild?: boolean;
  [key: string]: unknown;
}
export type UpgradeRequest = (
  method: string,
  route: string,
  body?: unknown,
  expected?: number,
) => Promise<unknown>;
export interface UpgradeOptions {
  config?: string;
  directory?: string;
  mainConfig?: string;
  helperImage: string;
  buildProfile?: string;
  snapshot?: unknown;
  credentialFile?: string;
  request?: UpgradeRequest;
  checkHelper?: () => void | Promise<void>;
}
export interface SourceAdapter {
  validate(value: unknown): SourceSnapshot;
  safePath(value: unknown): boolean;
  sourceMetadata(value: SourceIdentity): SourceIdentity;
}
export interface BuildAdapter {
  select(logo: string, hash: string): Recipe;
  generate(logo: string, profile?: string): Recipe;
  forSource(logo: string, revision: string): Recipe;
}
export interface EnvironmentAdapter {
  generate(logo: string, environment: EnvironmentReservation): Recipe;
}
