import fs from 'node:fs';
import crypto from 'node:crypto';
import { validate as validatePrimary } from '../project-lifecycle/sourcePrimaryBinding';
export function syncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
export function localRegistry(registryUrl: string, domainMode: string | number = 0) {
  const registry = new URL(registryUrl);

  if (
    !['http:', 'https:'].includes(registry.protocol) ||
    registry.username ||
    registry.password ||
    registry.pathname !== '/' ||
    registry.search ||
    registry.hash
  ) {
    throw Error('Invalid local registry URL.');
  }

  if (Number(domainMode || 0) < 2) {
    registry.port = '5050';
  }

  return registry;
}
export function projectForImage(
  content: string,
  image: string,
  registryUrl: string,
  domainMode: string | number = 2,
) {
  if (
    content[807] !== '$' ||
    crypto.createHash('md5').update(content.slice(0, 1184)).digest('hex') !==
      'bd4a8426355824593a5e21ad759830c1'
  ) {
    throw Error('Invalid Wizard configuration signature.');
  }

  const registry = localRegistry(registryUrl, domainMode);
  const match = /^([a-z0-9.-]+(?::[0-9]+)?)\/([a-z0-9._/-]+)@sha256:([a-f0-9]{64})$/.exec(image);

  if (
    !match ||
    match[1] !== registry.host ||
    match[2].split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw Error('Wizard recovery requires an immutable image from the local registry.');
  }

  const marker = '# BOOTSTRAPPER_PROJECT=';
  const markers = content.split('\n').filter((value) => value.startsWith(marker));

  if (markers.length !== 1) {
    throw Error('Managed Wizard receipt is missing or ambiguous.');
  }

  const line = markers[0];
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(line.slice(marker.length), 'base64').toString('utf8'));
  } catch {
    throw Error('Managed Wizard receipt is missing.');
  }

  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw Error('Managed Wizard receipt is missing.');
  }

  const candidate = decoded as Record<string, unknown>;

  if (
    !candidate.repository ||
    typeof candidate.repository !== 'object' ||
    Array.isArray(candidate.repository)
  ) {
    throw Error('Registry image does not belong to the managed Wizard project.');
  }

  const repository = candidate.repository as Record<string, unknown>;

  if (
    candidate.defaultProject !== true ||
    candidate.state !== 'complete' ||
    candidate.template !== 'wizard' ||
    repository?.systemProject !== true ||
    !Number.isSafeInteger(repository.id) ||
    Number(repository.id) < 1 ||
    typeof repository.path !== 'string'
  ) {
    throw Error('Registry image does not belong to the managed Wizard project.');
  }

  if (repository.managementMode === 'source-primary') {
    validatePrimary(decoded);
  }

  if (match[2] !== repository.path && !match[2].startsWith(repository.path + '/')) {
    if (repository.managementMode !== 'source-primary') {
      throw Error('Registry image does not belong to the managed Wizard project.');
    }

    const aliases: unknown = repository.recoveryImages || [];

    if (!Array.isArray(aliases)) {
      throw Error('Registry image does not belong to the managed Wizard project.');
    }

    const allowed = aliases.filter(
      (value: unknown): value is { imageRef: string; projectId: number; projectPath: string } => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return false;
        }

        const row = value as Record<string, unknown>;
        return (
          row.imageRef === image &&
          Number.isSafeInteger(row.projectId) &&
          Number(row.projectId) > 0 &&
          typeof row.projectPath === 'string' &&
          match[2] === row.projectPath
        );
      },
    );

    if (allowed.length !== 1) {
      throw Error('Registry image does not belong to the managed Wizard project.');
    }

    return {
      projectId: allowed[0].projectId,
      projectPath: allowed[0].projectPath,
      registry: registry.host,
      image,
    };
  }

  return {
    projectId: Number(repository.id),
    projectPath: repository.path,
    registry: registry.host,
    image,
  };
}
