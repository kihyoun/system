/** Keep existing operation messages while narrowing unknown exception values. */
export function failureMessage(error: unknown, fallback = 'The operation failed.'): string {
  return error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
    ? error.message
    : fallback;
}

export function uncertainFailure(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'uncertain' in error && error.uncertain === true;
}
