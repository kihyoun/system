import { configurationLogo } from './configurationSignature';

/** The exact 1184-byte Cube and dollar at offset 807 are the configuration format. */
export function validConfigurationSignature(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const bytes = Buffer.from(value);
  return (
    bytes[807] === 36 && bytes.subarray(0, 1184).equals(Buffer.from(configurationLogo, 'ascii'))
  );
}
