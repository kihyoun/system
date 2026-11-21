import path from 'node:path';

/** Source and compiled modules share one repository/package root. */
export function checkoutRoot(): string {
  return path.resolve(__dirname, '../../..');
}

export function checkoutPath(...parts: string[]): string {
  return path.join(checkoutRoot(), ...parts);
}

export function cliPath(checkout = checkoutRoot()): string {
  if (!path.isAbsolute(checkout)) throw Error('absolute-checkout-required');
  return path.join(checkout, 'dist/cli/main.js');
}

export function cliArguments(
  command: string,
  args: readonly string[],
  checkout = checkoutRoot(),
): string[] {
  return [cliPath(checkout), command, ...args];
}
