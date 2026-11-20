import type { LifecycleEvidencePort } from './types';

/** The same source-owned policy ships with the offline controller and public CLI. */
export function lifecyclePolicy(): LifecycleEvidencePort {
  const value: unknown = require('../../assets/gitlab/guided-preview-evidence');
  if (!value || typeof value !== 'object') throw Error('lifecycle-evidence-policy-required');
  const policy = value as Record<string, unknown>;
  if (
    !['stages', 'stagesV2'].every(
      (key) =>
        Array.isArray(policy[key]) &&
        (policy[key] as unknown[]).every((item) => typeof item === 'string'),
    ) ||
    !['validateAuthority', 'validate', 'sanitize'].every((key) => typeof policy[key] === 'function')
  )
    throw Error('lifecycle-evidence-policy-required');
  return value as LifecycleEvidencePort;
}
