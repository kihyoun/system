export interface StorageSpec {
  PERSISTENCE_MODE?: string;
  PERSISTENT_MOUNT?: string;
  PERSISTENT_DIR?: string;
  PERSISTENT_UUID?: string;
  SEED_DIR?: string;
  SEED_MOUNT?: string;
  SEED_UUID?: string;
  GITLAB_IMAGE?: string;
  SYSTEM_WIZARD_CANONICAL_CONTROLLER?: string;
  operation?: 'harvest' | 'restore';
  checkOnly?: boolean;
  backup?: boolean;
  helperName?: string;
  imageId?: string;
  coordinatedBackup?: string;
}
export interface MountRow {
  device: string;
  target: string;
  options: string[];
  type: string;
}
export function requireValue(value: unknown, code: string): asserts value {
  if (!value) {
    throw new StorageError(code);
  }
}
export class StorageError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false,
  ) {
    super(code);
    this.name = 'StorageError';
  }
}
