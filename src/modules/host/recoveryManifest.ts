import { environmentAssignments } from '../../common/runtime/environmentAssignments';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HostInstallService, requireValue } from './install';
import { imageId, revision, record, readSourceIdentity } from '../release/sourceIdentity';
export function fileSha(filename: string): string {
  const hash = crypto.createHash('sha256'),
    fd = fs.openSync(filename, 'r'),
    buffer = Buffer.alloc(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}
export function recoveryReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,500}$/.test(value) &&
    !value.includes('\n')
  );
}
export function canonicalDigest(value: string): string {
  const separator = value.lastIndexOf('@');
  let repository = value.slice(0, separator);
  const digest = value.slice(separator + 1);
  requireValue(separator >= 0 && imageId(digest), 'invalid-repository-digest');

  if (repository.lastIndexOf(':') > repository.lastIndexOf('/')) {
    repository = repository.slice(0, repository.lastIndexOf(':'));
  }

  requireValue(repository, 'invalid-repository-digest');
  return repository + '@' + digest;
}
export function canonicalSelector(value: unknown): string {
  requireValue(recoveryReference(value), 'invalid-image-selector');
  return value.includes('@') || value.split('/').at(-1)!.includes(':') ? value : value + ':latest';
}
export interface Archive {
  file: string;
  sha256: string;
  imageId: string;
  imageRef?: string;
  sourceCommit?: string;
  sourceTree?: string;
  wizardSourceRevision?: string;
  sourceLayout?: string;
  wizardSourceTree?: string;
}
export interface DeclaredImage {
  tag: string;
  reference?: string;
  imageId?: string;
}
export interface RecoveryManifest {
  archives: Archive[];
  publicImages: DeclaredImage[];
  localImages: DeclaredImage[];
  sourceCommit: string;
  sourceTree: string;
  wizardSourceRevision?: string;
  sourceLayout?: string;
  wizardSourceTree?: string;
  deployedCodeTree?: string;
  currentController: {
    imageId: string;
    reference: string;
    sourceCommit: string;
    sourceTree: string;
    productionWizardReference?: string;
  };
}
export function declaredImage(
  manifest: RecoveryManifest,
  selected: unknown,
): DeclaredImage | undefined {
  const value = canonicalSelector(selected);
  return (
    [...manifest.publicImages, ...manifest.localImages].find(
      (row) => canonicalSelector(row.tag) === value,
    ) || manifest.publicImages.find((row) => canonicalSelector(row.reference) === value)
  );
}
export class RecoveryManifestService {
  constructor(readonly host = new HostInstallService()) {}

  load(
    directory: string,
    checkout: string,
    expectedSha?: string,
    checksumsOnly = false,
    manifestBytes?: string,
  ): RecoveryManifest {
    const stat = fs.lstatSync(directory);
    requireValue(
      stat.isDirectory() && !stat.isSymbolicLink(),
      'recovery-directory-must-not-be-symlink',
    );
    const images = path.join(directory, 'images'),
      imageStat = fs.lstatSync(images);
    requireValue(
      imageStat.isDirectory() && !imageStat.isSymbolicLink(),
      'images-directory-must-not-be-symlink',
    );
    directory = fs.realpathSync(directory);
    const filename = path.join(directory, 'images.json'),
      manifestStat = fs.lstatSync(filename);
    requireValue(
      manifestStat.isFile() && !manifestStat.isSymbolicLink(),
      'manifest-must-be-regular-file',
    );

    if (expectedSha) {
      requireValue(
        /^[a-f0-9]{64}$/.test(expectedSha) && fileSha(filename) === expectedSha,
        'manifest-checksum-mismatch',
      );
    }

    const value = record(
      JSON.parse(manifestBytes === undefined ? fs.readFileSync(filename, 'utf8') : manifestBytes),
    );
    requireValue(Array.isArray(value.archives), 'invalid-manifest-archives');
    requireValue(Array.isArray(value.publicImages), 'invalid-manifest-publicImages');
    requireValue(value.archives.length, 'manifest-has-no-archives');
    const manifest = value as unknown as RecoveryManifest,
      files = new Set(),
      ids = new Set(),
      tags = new Map<string, string | undefined>();
    for (const archive of manifest.archives) {
      record(archive);
      requireValue(
        typeof archive.file === 'string' &&
          /^images\/[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz$/.test(archive.file),
        'unexpected-archive-path',
      );
      const selected = path.join(directory, archive.file),
        entry = fs.lstatSync(selected, { throwIfNoEntry: false });
      requireValue(
        !entry?.isSymbolicLink() &&
          (!entry ||
            path.dirname(fs.realpathSync(selected)) ===
              fs.realpathSync(path.join(directory, 'images'))),
        'archive-escapes-images-directory',
      );
      requireValue(!files.has(archive.file) && entry?.isFile(), 'duplicate-or-missing-archive');
      files.add(archive.file);
      requireValue(
        typeof archive.sha256 === 'string' && /^[a-f0-9]{64}$/.test(archive.sha256),
        'invalid-archive-checksum',
      );
      requireValue(fileSha(selected) === archive.sha256, 'archive-checksum-mismatch');

      if (!checksumsOnly) {
        requireValue(imageId(archive.imageId), 'archive-image-id-required');
        ids.add(archive.imageId);
      }
    }
    const localAlias = (value: unknown) =>
      recoveryReference(value) && !value.includes('@') && !value.startsWith('sha256:');
    for (const image of manifest.publicImages) {
      record(image);
      requireValue(
        recoveryReference(image.reference) &&
          /@sha256:[a-f0-9]{64}$/.test(image.reference) &&
          localAlias(image.tag),
        'public-image-must-be-digest-pinned',
      );

      if (image.imageId !== undefined && image.imageId !== null) {
        requireValue(imageId(image.imageId), 'invalid-public-image-id');
      }

      const alias = canonicalSelector(image.tag);
      requireValue(!tags.has(alias), 'duplicate-image-alias');
      tags.set(alias, image.imageId || image.reference);
    }

    if (checksumsOnly) {
      return manifest;
    }

    requireValue(
      Array.isArray(manifest.localImages) && manifest.localImages.length,
      'local-image-aliases-required',
    );
    for (const image of manifest.localImages) {
      record(image);
      requireValue(localAlias(image.tag) && imageId(image.imageId), 'invalid-local-image');
      requireValue(ids.has(image.imageId), 'local-alias-has-no-declared-archive');
      const alias = canonicalSelector(image.tag);
      requireValue(!tags.has(alias), 'duplicate-image-alias');
      tags.set(alias, image.imageId);
    }
    requireValue(
      revision(manifest.sourceCommit) && revision(manifest.sourceTree),
      'recorded-source-identities-required',
    );
    let identity;
    try {
      identity = readSourceIdentity({
        sourceRevision: manifest.sourceCommit,
        sourceTree: manifest.sourceTree,
        sourceLayout: manifest.sourceLayout,
        wizardRevision: manifest.wizardSourceRevision,
        wizardSourceTree: manifest.wizardSourceTree,
      });
    } catch {
      throw Error('recorded-source-identities-required');
    }
    checkout = fs.realpathSync(checkout);
    const git = (...args: string[]) => this.host.run('git', ['-C', checkout, ...args]).trim();
    requireValue(
      git('rev-parse', identity.sourceRevision + '^{tree}') === identity.sourceTree,
      'recorded-source-tree-mismatch',
    );

    if (manifest.deployedCodeTree !== undefined) {
      requireValue(
        manifest.deployedCodeTree === identity.sourceTree,
        'deployed-source-tree-mismatch',
      );
    }

    const entry =
      identity.sourceLayout === 'system-monorepo-v1'
        ? '040000 tree ' + identity.wizardSourceTree
        : '160000 commit ' + identity.wizardRevision;
    requireValue(
      git('ls-tree', identity.sourceRevision, 'wizard') === entry + '\twizard',
      'recorded-wizard-gitlink-mismatch',
    );
    const controller = manifest.currentController;
    record(controller);
    requireValue(
      ids.has(controller.imageId) &&
        manifest.localImages.some((row) => row.tag === controller.reference) &&
        tags.get(canonicalSelector(controller.reference)) === controller.imageId,
      'declared-controller-required',
    );
    requireValue(
      controller.sourceCommit === identity.sourceRevision &&
        controller.sourceTree === identity.sourceTree,
      'controller-source-mismatch',
    );
    const matches = manifest.archives.filter((row) => row.imageId === controller.imageId);
    requireValue(
      matches.length === 1 &&
        matches[0].sourceCommit === identity.sourceRevision &&
        matches[0].sourceTree === identity.sourceTree &&
        (identity.sourceLayout === 'system-monorepo-v1'
          ? matches[0].sourceLayout === identity.sourceLayout &&
            matches[0].wizardSourceTree === identity.wizardSourceTree &&
            matches[0].wizardSourceRevision === undefined
          : matches[0].wizardSourceRevision === identity.wizardRevision &&
            matches[0].sourceLayout === undefined &&
            matches[0].wizardSourceTree === undefined),
      'controller-archive-source-mismatch',
    );
    return manifest;
  }

  validateSelected(manifest: RecoveryManifest, configuration: string): void {
    const keys = [
      'BOOTSTRAPPER_IMAGE',
      'NGINX_IMAGE',
      'GITLAB_IMAGE',
      'GITLAB_RUNNER_IMAGE',
      'WIZARD_ENABLE',
      'WIZARD_IMAGE',
    ];
    const values = environmentAssignments(fs.readFileSync(configuration, 'utf8'));
    const selected = Object.fromEntries(keys.map((key) => [key, values[key] || '']));
    for (const [key, fallback] of [
      ['BOOTSTRAPPER_IMAGE', 'system_bootstrapper'],
      ['NGINX_IMAGE', 'nginx'],
      ['GITLAB_IMAGE', ''],
      ['GITLAB_RUNNER_IMAGE', ''],
    ]) {
      const row = declaredImage(manifest, selected[key] || fallback);
      requireValue(row, 'saved-image-is-not-declared-in-manifest');

      if (key === 'BOOTSTRAPPER_IMAGE') {
        requireValue(
          row.imageId === manifest.currentController.imageId,
          'saved-controller-is-not-declared-current-controller',
        );
      }
    }

    if (selected.WIZARD_ENABLE === 'true') {
      const candidates = [
        ...manifest.archives.map((row) => row.imageRef),
        ...manifest.publicImages.map((row) => row.reference),
        manifest.currentController.productionWizardReference,
      ];
      requireValue(
        declaredImage(manifest, selected.WIZARD_IMAGE) ||
          candidates.includes(selected.WIZARD_IMAGE),
        'saved-wizard-image-is-not-declared',
      );
    }
  }
}
