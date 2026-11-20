import { publicSource, publicWizardRevision, type PublicSource } from './github-source';
import type { SuccessorRelease } from './types';
import type { GithubContext } from './github-acceptance';
import {
  publicationHash as hash,
  publicationRecord as record,
  requirePublication as requireValue,
} from './github-transport';
export interface AcceptedPublicMetadata {
  format: 'system-accepted-release-v1';
  version: string;
  tag: string;
  platform: 'linux/amd64';
  source: PublicSource;
  images: Record<
    'controller' | 'wizard',
    { reference: string; imageId: string; configDigest: string }
  >;
  acceptance: {
    candidateJobId: number;
    evidenceSha256: string;
    controllerWizardSameAttempt: true;
    requiredChecksPassed: true;
  };
  compatibility: {
    os: string;
    versions: string[];
    architecture: string;
    minimumMemoryGiB: number;
    minimumFreeDiskGiB: number;
  };
  quickstart: { file: string; sha256: string; hostInstallerSha256?: string };
  releaseNotesSha256: string;
  documentation: Record<string, string>;
  publicUpgrade?: { file: string; sha256: string; format: string };
}
export function githubPublicMetadata(
  ci: GithubContext,
  released: SuccessorRelease,
  value: unknown,
  source: unknown,
  notes: Buffer,
  quickstart: Buffer,
): AcceptedPublicMetadata {
  const acceptedSource = publicSource(ci, released, value, source),
    publication = record(value),
    upstream = record(publication.upstreamRelease);
  requireValue(
    publication.format === 'system-public-release-v1' &&
      publication.versionTag === null &&
      publication.platform === 'linux/amd64' &&
      publication.projectId === released.projectId &&
      publication.pipelineId === released.pipelineId &&
      upstream.candidateJobId === released.candidateJobId &&
      upstream.candidateEvidenceSha256 === released.candidateEvidenceSha256,
    'Public images must belong to the accepted attempt.',
  );
  const roles: ['controller' | 'wizard', string, string, string][] = [
    ['controller', released.imageId, released.sourceRevision, released.registryReference],
    [
      'wizard',
      released.wizardImageId,
      publicWizardRevision(released),
      released.wizardRegistryReference,
    ],
  ];
  const images = {} as AcceptedPublicMetadata['images'];
  for (const [role, id, sourceRevision, internal] of roles) {
    const row = record(publication[role]);
    requireValue(
      row.imageId === id &&
        row.sourceRevision === sourceRevision &&
        typeof row.reference === 'string' &&
        /^(?:docker\.io\/)?[a-z0-9_-]+\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(row.reference) &&
        row.reference.split('@')[1] === internal.split('@')[1] &&
        typeof row.configDigest === 'string' &&
        /^sha256:[a-f0-9]{64}$/.test(row.configDigest),
      'Published digest/source pair differs from the accepted image.',
    );
    images[role] = { reference: row.reference, imageId: id, configDigest: row.configDigest };
  }
  return {
    format: 'system-accepted-release-v1',
    version: ci.version,
    tag: ci.tag,
    platform: 'linux/amd64',
    source: acceptedSource,
    images,
    acceptance: {
      candidateJobId: released.candidateJobId,
      evidenceSha256: released.candidateEvidenceSha256,
      controllerWizardSameAttempt: true,
      requiredChecksPassed: true,
    },
    compatibility: {
      os: 'Ubuntu',
      versions: ['24.04', '26.04'],
      architecture: 'amd64',
      minimumMemoryGiB: 8,
      minimumFreeDiskGiB: 40,
    },
    quickstart: {
      file: 'quickstart.sh',
      sha256: hash(quickstart),
      hostInstallerSha256: ci.hostInstallerSha256,
    },
    releaseNotesSha256: hash(notes),
    documentation: {
      quickstart: 'https://github.com/' + ci.repository + '/blob/' + ci.tag + '/docs/QUICKSTART.md',
      recovery:
        'https://github.com/' + ci.repository + '/blob/' + ci.tag + '/docs/RECOVERY_CONTRACT.md',
      upgrade:
        'https://github.com/' +
        ci.repository +
        '/blob/' +
        ci.tag +
        '/docs/HANDBOOK.md#5-evolving-a-running-system',
      changelog: 'https://github.com/' + ci.repository + '/blob/' + ci.tag + '/CHANGELOG.md',
    },
  };
}
