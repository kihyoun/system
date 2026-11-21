export type EnvironmentKind = 'review' | 'beta';
export interface DeploymentRequest {
  action: 'deploy' | 'stop';
  kind: EnvironmentKind;
  projectId: number;
  pipelineId: number;
  jobId: number;
  sourceCommit: string;
  mrIid: number;
  operation: string;
  delivery?: 'system';
}
export interface DeploymentRecord extends DeploymentRequest {
  host: string;
  imageRef: string;
  generation: string;
  state: 'pending' | 'active' | 'stopped';
  containerName: string;
  networkName: string;
  environment: string;
  routeHash?: string;
  cleanupComplete?: boolean;
  routeRemoved?: boolean;
}
export interface DeploymentSlot {
  pending?: DeploymentRecord | null;
  active?: DeploymentRecord | null;
  tombstone?: DeploymentRecord | null;
  retired?: DeploymentRecord[];
  lastPipelineId?: number;
  stoppedThroughPipelineId?: number;
}
export interface EnvironmentSetting {
  host: string;
  ssl: string;
  sslKey: string;
  enabled?: boolean;
  domainMode?: number;
}
export interface Inspection {
  networks?: Record<string, { IPAddress?: string }>;
}
export interface DeploymentPort {
  request: DeploymentRequest;
  setting: EnvironmentSetting;
  environment: { deployments: Partial<Record<EnvironmentKind, DeploymentSlot>> };
  cleanupDeadline?: number;
  save(
    deployments: Partial<Record<EnvironmentKind, DeploymentSlot>>,
    cleanup?: boolean,
  ): Promise<void>;
  readFragment(kind: EnvironmentKind): string | null;
  writeFragment(kind: EnvironmentKind, value: string | null): void;
  reload(cleanup?: boolean): Promise<void>;
  health(value: DeploymentRecord, options?: { once?: boolean }): Promise<boolean>;
  owned(value: DeploymentRecord): Promise<Inspection | null>;
  inspected(name: string, type: 'network'): Promise<unknown>;
  remove(value: DeploymentRecord, cleanup?: boolean): Promise<void>;
  removeNetwork(value: DeploymentRecord, cleanup?: boolean): Promise<void>;
  network(value: DeploymentRecord): Promise<void>;
  command(args: string[]): Promise<unknown>;
}
export type DeploymentAction =
  | 'reconcile'
  | 'cleanupRetired'
  | 'cleanupTombstone'
  | 'cleanupStoppedRoute'
  | 'refreshActive'
  | 'deploy'
  | 'stop';
