import { settings } from '../../modules/project-lifecycle/previewSettings';

/** Shared versioned validator used by configuration, storage and preview setup. */
export function normalizePreview(input: unknown): unknown {
  return settings(input);
}
