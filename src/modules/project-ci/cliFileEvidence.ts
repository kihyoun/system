import crypto from 'node:crypto';

export const cliRepositoryPath = '.gitlab/cli/system-bootstrapper.tgz';
export const maxCliArtifactBytes = 8 * 1024 ** 2;
interface CliFileDigest {
  format: 'system-cli-file-digest-v1';
  sha256: string;
  size: number;
}
export function cliFileRoute(route: string, immutable = true): boolean {
  const match = /\/repository\/files\/([^?]+)\?ref=([^&]+)$/.exec(route);

  if (!match) {
    return false;
  }

  try {
    const revision = decodeURIComponent(match[2]);
    return (
      decodeURIComponent(match[1]) === cliRepositoryPath &&
      (immutable
        ? /^[a-f0-9]{40}$/.test(revision)
        : /^[A-Za-z0-9_./-]+$/.test(revision) && !revision.split('/').includes('..'))
    );
  } catch {
    return false;
  }
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('repository-file-evidence-invalid');
  }

  return value as Record<string, unknown>;
}
export function repositoryFileContent(filename: string, value: unknown): Buffer | undefined {
  const file = row(value);

  if (filename === cliRepositoryPath && file.format === 'system-cli-file-digest-v1') {
    if (
      Object.keys(file).sort().join(',') !== 'format,sha256,size' ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      Number(file.size) <= 0 ||
      Number(file.size) > maxCliArtifactBytes
    ) {
      throw Error('cli-file-digest-invalid');
    }

    return undefined;
  }

  if (typeof file.content !== 'string') {
    throw Error('repository-file-evidence-invalid');
  }

  const encoded = file.content.replace(/\n/g, '');
  const bytes = Buffer.from(encoded, 'base64');

  if (bytes.toString('base64') !== encoded) {
    throw Error('repository-file-evidence-invalid');
  }

  return bytes;
}
export function repositoryFileHash(filename: string, value: unknown): string {
  const bytes = repositoryFileContent(filename, value);
  return bytes === undefined
    ? (row(value) as unknown as CliFileDigest).sha256
    : crypto.createHash('sha256').update(bytes).digest('hex');
}
/** Compute the digest from fetched bytes before returning a bounded native evidence response. */
export function compactCliFile(value: unknown): CliFileDigest {
  const bytes = repositoryFileContent('', value);

  if (!bytes || bytes.length === 0 || bytes.length > maxCliArtifactBytes) {
    throw Error('cli-file-size-invalid');
  }

  return {
    format: 'system-cli-file-digest-v1',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  };
}
