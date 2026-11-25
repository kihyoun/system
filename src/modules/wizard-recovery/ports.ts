import type { ChildOptions } from '../../common/runtime/managedChild';
export const wizardRecoveryProcess = Symbol('WIZARD_RECOVERY_PROCESS');
export const wizardRecoveryRegistry = Symbol('WIZARD_RECOVERY_REGISTRY');
export const wizardRecoveryReady = Symbol('WIZARD_RECOVERY_READY');
export const wizardRecoveryDurability = Symbol('WIZARD_RECOVERY_DURABILITY');
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
