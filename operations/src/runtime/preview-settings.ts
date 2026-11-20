import { settings } from '../project-lifecycle/preview-settings';

/** Shared versioned validator used by configuration, storage and preview setup. */
export function normalizePreview(input: unknown): unknown {
  return settings(input);
}
