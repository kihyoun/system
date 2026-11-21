export type StorageAction =
  | 'launch'
  | 'host'
  | 'inside'
  | 'validate'
  | 'prepare-local'
  | 'startup-check'
  | 'startup-begin'
  | 'startup-finish'
  | 'startup-settled'
  | 'sync-status';
export interface StorageCommandDto {
  action: StorageAction;
  operation?: 'harvest' | 'restore';
  ownerPid?: string | number;
  exitCode?: number;
  checkOnly?: boolean;
  backup?: string;
  environment?: NodeJS.ProcessEnv;
}
