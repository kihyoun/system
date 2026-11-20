import type { ChildOptions } from '../runtime/managed-child';
export const WIZARD_RECOVERY_PROCESS = Symbol('WIZARD_RECOVERY_PROCESS');
export const WIZARD_RECOVERY_REGISTRY = Symbol('WIZARD_RECOVERY_REGISTRY');
export const WIZARD_RECOVERY_READY = Symbol('WIZARD_RECOVERY_READY');
export const WIZARD_RECOVERY_DURABILITY = Symbol('WIZARD_RECOVERY_DURABILITY');
export interface RecoveryOptions {
  checkout: string;
  settings: NodeJS.ProcessEnv;
  configDirectory?: string;
  templates?: string;
  signal?: AbortSignal;
}
export interface RegistryInput {
  projectId: number;
  projectPath: string;
  action: 'create' | 'cleanup' | 'revoke';
  tokenId?: number;
}
export interface RegistrySession {
  execute(input: RegistryInput, signal?: AbortSignal): Promise<Record<string, unknown>>;
}
export interface RecoveryRegistryPort {
  open(options: RecoveryOptions): Promise<RegistrySession>;
}
export interface RecoveryReadinessPort {
  wait(options: ChildOptions): Promise<void>;
}
export interface RecoveryDurabilityPort {
  syncDirectory(directory: string): void;
}
