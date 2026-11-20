import path from 'node:path';
export function parseArguments(
  input: string[],
  flags: string[],
  values: string[],
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < input.length; index++) {
    const key = input[index];
    if (key in result) throw Error('Duplicate host bootstrap argument.');
    if (flags.includes(key)) result[key] = true;
    else if (values.includes(key) && input[index + 1] && !input[index + 1].startsWith('--'))
      result[key] = input[++index];
    else throw Error('Unexpected host bootstrap arguments.');
  }
  return result;
}
export function absolute(value: string | boolean | undefined): string {
  if (typeof value !== 'string' || !path.isAbsolute(value))
    throw Error('Explicit absolute path required.');
  return value;
}
export function optionalString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
