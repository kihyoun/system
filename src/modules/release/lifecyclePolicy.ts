import type { LifecycleEvidencePort } from './types';
import * as policy from './guidedPreviewEvidence';

/** The same source-owned policy ships with the offline controller and public CLI. */
export function lifecyclePolicy(): LifecycleEvidencePort {
  return policy;
}
