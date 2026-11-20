import { readNpmReceipt, hash, integrity, type NpmReceipt } from './npm-identity';
import { requirePublication } from './github-transport';
export function acceptedCliArtifact(
  input: unknown,
  bytes: Buffer,
  expected: {
    version: string;
    sourceRevision: string;
    sourceTree: string;
    pipelineId: number;
    packageJobId: number;
  },
): NpmReceipt {
  const receipt = readNpmReceipt(input);
  requirePublication(
    Object.keys(receipt).sort().join(',') ===
      [
        'format',
        'name',
        'version',
        'sourceRevision',
        'sourceTree',
        'pipelineId',
        'packageJobId',
        'filename',
        'sha256',
        'integrity',
      ]
        .sort()
        .join(','),
    'Exact CLI artifact receipt required.',
  );
  requirePublication(
    Object.entries(expected).every(([key, value]) => receipt[key as keyof NpmReceipt] === value) &&
      hash(bytes) === receipt.sha256 &&
      integrity(bytes) === receipt.integrity,
    'CLI artifact differs from accepted source, job or bytes.',
  );
  return receipt;
}
