export class InspectionInputError extends Error {}
export type Version = readonly [number, number, number];
export interface HostFacts {
  kernelRelease: string;
  ubuntuVersionSignature: string | null;
  upstreamKernel: string | null;
  kernelVersionSource: string;
  architecture: string;
  avx: boolean;
}
export interface Finding {
  code: string;
  message: string;
}
export function version(value: string): Version {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value) || value.includes('\n'))
    throw new InspectionInputError('Use an exact stable version such as 8.0.37.');
  const values = value.split('.').map(Number);
  if (values.some((value) => !Number.isSafeInteger(value)))
    throw new InspectionInputError('Invalid version.');
  return values as unknown as Version;
}
export function hostFacts(
  release: string,
  signature: string,
  cpuinfo: string,
  machine: string,
  ubuntu: boolean,
): HostFacts {
  let upstream = /^(\d+\.\d+\.\d+)/.exec(release)?.[1] || null,
    source = 'uname';
  if (signature) {
    const match = /^Ubuntu (\S+) (\d+\.\d+\.\d+)$/.exec(signature);
    const pkg = match && /^(.+-\d+)(?:\.\d+)?(-[^ ]+)$/.exec(match[1]);
    if (!match || !pkg || pkg[1] + pkg[2] !== release) {
      upstream = null;
      source = 'unrecognized-ubuntu-signature';
    } else {
      upstream = match[2];
      source = 'ubuntu-version-signature';
    }
  } else if (ubuntu) {
    upstream = null;
    source = 'missing-ubuntu-version-signature';
  }
  const flags = [...cpuinfo.matchAll(/^flags\s*:\s*(.*)$/gm)];
  return {
    kernelRelease: release,
    ubuntuVersionSignature: signature || null,
    upstreamKernel: upstream,
    kernelVersionSource: source,
    architecture: machine,
    avx: flags.length > 0 && flags.every((row) => row[1].split(/\s+/).includes('avx')),
  };
}
function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
export function assess(facts: HostFacts, mongo: Version): Finding[] {
  const findings: Finding[] = [],
    fail = (code: string, message: string) => findings.push({ code, message });
  if (!['x86_64', 'amd64'].includes(facts.architecture))
    fail(
      'unsupported-architecture',
      'This preflight supports Linux x86_64 only; consult the MongoDB platform and CPU matrix for other architectures.',
    );
  else if (!facts.avx)
    fail(
      'cpu-avx-missing',
      'MongoDB 5.0+ requires AVX exposed on every CPU. Check hardware and VM CPU feature passthrough; a kernel change does not supply AVX.',
    );
  const kernel = facts.upstreamKernel ? version(facts.upstreamKernel) : null;
  if (!kernel)
    fail(
      'kernel-version-unknown',
      'Cannot establish the upstream kernel. Read /proc/version_signature on the Docker daemon host; do not infer an Ubuntu patch level from uname alone.',
    );
  const line = mongo.slice(0, 2).join('.');
  const floors: Record<string, Version> = {
    '8.0': [8, 0, 37],
    '8.3': [8, 3, 16],
    '9.0': [9, 0, 4],
  };
  if (line !== '7.0' && !Object.hasOwn(floors, line))
    fail(
      'mongodb-version-unreviewed',
      'No compatibility rule is maintained for this MongoDB release line. Consult current vendor notes before selecting it.',
    );
  else if (kernel && mongo[0] >= 8 && compare(kernel, [6, 19, 0]) >= 0) {
    if (compare(kernel, [7, 0, 14]) < 0)
      fail(
        'kernel-mongodb-incompatible',
        'MongoDB 8/9 with Linux 6.19 through 7.0.13 is unsafe or refused at startup (TCMalloc/rseq). Select a vendor-supported combination; never disable its startup check.',
      );
    else if (compare(mongo, floors[line]) < 0)
      fail(
        'mongodb-patch-required',
        'This kernel requires a reviewed MongoDB patch including kernel/Ubuntu detection fixes: use at least ' +
          floors[line].join('.') +
          ' for this line, then probe the exact image.',
      );
  }
  return findings;
}
export interface LogPolicy {
  Type: 'json-file';
  Config: { 'max-size': string; 'max-file': string };
}
export function logPolicy(size = '10m', files = '3'): LogPolicy {
  if (!/^[1-9][0-9]*[kmgKMG]$/.test(size) || /[\r\n]/.test(size))
    throw new InspectionInputError(
      'SYSTEM_LOG_MAX_SIZE must be a positive integer with k, m or g units.',
    );
  if (!/^[1-9][0-9]*$/.test(files) || /[\r\n]/.test(files) || Number(files) > 100)
    throw new InspectionInputError('SYSTEM_LOG_MAX_FILES must be from 1 to 100.');
  return { Type: 'json-file', Config: { 'max-size': size.toLowerCase(), 'max-file': files } };
}
