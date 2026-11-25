export interface ProductionProof {
  version: 1;
  projectId: number;
  projectPath: string;
  pipelineId: number;
  sourceCommit: string;
  imageRef: string;
  productionHost: string;
}
export interface LockOwner {
  token: string;
  hostname: string;
  pid: number;
  processStart: string;
}
export interface ProductionOptions {
  config?: string;
  projectConfig?: string;
  template?: string;
  wizardEnv?: string;
  directory?: string;
  lock?: string;
  compose?: string;
  command?: (args: string[], input?: string, timeout?: number) => Promise<string>;
  pause?: (ms: number) => Promise<void>;
  ownerAlive?: (owner: LockOwner) => boolean;
}
export interface ContainerInspection {
  id: string;
  imageId: string;
  labels?: Record<string, string>;
  networks?: Record<string, { IPAddress: string }>;
  mounts?: { Destination: string; Type: string; Name: string; RW: boolean }[];
}
export interface ImageInspection {
  id: string;
  digests?: string[];
  labels?: Record<string, string>;
}
export interface VolumeInspection {
  Name: string;
  Driver: string;
  Options?: { device?: string; type?: string; o?: string };
}
export interface Checkpoint {
  version: number;
  operation: string;
  phase?: string;
  plan: { proof: ProductionProof };
  previousImageId: string;
  previousAddress: string;
  previousConfig: string;
  previousTemplate: string;
  liveConfig: string;
  liveTemplate: string;
  targetImageId: string;
  candidateId?: string | null;
  canonicalAttempted?: boolean;
  activeImageId?: string;
  activeConfigHash?: string;
  activeTemplateHash?: string;
}
