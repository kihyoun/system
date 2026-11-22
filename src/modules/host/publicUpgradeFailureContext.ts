export const publicUpgradePlanSteps = Object.freeze([
  'request',
  'settings',
  'lock',
  'local',
  'public-inputs',
  'verify-checkout',
  'installed',
  'prerequisite',
  'host',
  'sync-idle',
  'free-bytes',
  'backup-target',
  'selection-before',
  'capture',
  'paired-preflight',
  'selection-after',
  'data-sample',
] as const);
export type PublicUpgradePlanStep = (typeof publicUpgradePlanSteps)[number];
const failureSteps = new WeakMap<object, PublicUpgradePlanStep>();

export function publicUpgradePlanFailureStep(error: unknown): PublicUpgradePlanStep | undefined {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return;
  }

  return failureSteps.get(error);
}

function recordFailure(error: unknown, step: PublicUpgradePlanStep): void {
  if (
    error !== null &&
    (typeof error === 'object' || typeof error === 'function') &&
    publicUpgradePlanSteps.includes(step) &&
    !failureSteps.has(error)
  ) {
    failureSteps.set(error, step);
  }
}

export async function publicUpgradePlanStep<T>(
  step: PublicUpgradePlanStep,
  call: () => T | Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    recordFailure(error, step);
    throw error;
  }
}

export function publicUpgradePlanStepSync<T>(step: PublicUpgradePlanStep, call: () => T): T {
  try {
    return call();
  } catch (error) {
    recordFailure(error, step);
    throw error;
  }
}
