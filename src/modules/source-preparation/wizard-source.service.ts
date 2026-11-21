// Export committed blobs only; never copy the active Wizard working directory.
import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type {
  SourceFile,
  SourceIdentity,
  SourceSnapshot,
} from '../project-lifecycle/upgrade-types';
export interface SourceGitDirectories {
  system?: string;
  wizard?: string;
}
const hash = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
export const safePath = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_.@+/-]+$/.test(value) &&
  !value.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git');
export const excluded = (value: string): boolean =>
  /^\.system-bootstrapper\/build-v[12]\//.test(value) ||
  (value !== '.system-bootstrapper/preflight.env' &&
    value
      .split('/')
      .some(
        (part) =>
          /(?:^|\.)env(?:\.|$)/i.test(part) ||
          /^(?:node_modules|build|dist|coverage|seed|seeds|\.npmrc|\.netrc|credentials(?:\..*)?|id_rsa|id_ed25519)$/i.test(
            part,
          ) ||
          /\.(?:key|pem|p12|pfx)$/i.test(part),
      ));
export function validate(value: unknown): SourceSnapshot {
  const snapshot = value as SourceSnapshot;
  if (!snapshot || typeof snapshot !== 'object') throw Error('Invalid Wizard source manifest.');
  if (
    ![1, 2].includes(snapshot.version) ||
    !/^[a-f0-9]{40}$/.test(snapshot.sourceRevision) ||
    !Array.isArray(snapshot.files)
  )
    throw Error('Invalid Wizard source manifest.');
  if (
    snapshot.version === 1
      ? snapshot.sourceLayout !== undefined || snapshot.wizardSourceTree !== undefined
      : snapshot.sourceLayout !== 'system-monorepo-v1' ||
        !/^[a-f0-9]{40}$/.test(snapshot.wizardSourceTree || '')
  )
    throw Error('Invalid Wizard source layout.');
  const paths = new Set();
  for (const file of snapshot.files) {
    if (
      !safePath(file.path) ||
      excluded(file.path) ||
      paths.has(file.path) ||
      !['100644', '100755'].includes(file.mode) ||
      typeof file.content !== 'string' ||
      Buffer.from(file.content, 'base64').toString('base64') !== file.content ||
      hash(Buffer.from(file.content, 'base64')) !== file.sha256
    )
      throw Error('Invalid Wizard source file.');
    paths.add(file.path);
  }
  if (
    !paths.has('package.json') ||
    !paths.has('src/api/Helper.tsx') ||
    !paths.has('.gitlab-ci.yml')
  )
    throw Error('Incomplete Wizard source.');
  const manifest = {
    version: snapshot.version,
    sourceRevision: snapshot.sourceRevision,
    ...(snapshot.version === 2
      ? { sourceLayout: snapshot.sourceLayout, wizardSourceTree: snapshot.wizardSourceTree }
      : {}),
    files: snapshot.files.map(({ path, mode, sha256 }) => ({ path, mode, sha256 })),
  };
  if (hash(JSON.stringify(manifest)) !== snapshot.manifestHash)
    throw Error('Wizard source manifest hash mismatch.');
  return snapshot;
}
export function pack(root: string, directories: SourceGitDirectories = {}): SourceSnapshot {
  const git = (cwd: string, args: string[]) => {
    const gitdir =
      cwd === root
        ? (directories.system ?? process.env.SYSTEM_SOURCE_GIT_DIR)
        : (directories.wizard ?? process.env.WIZARD_SOURCE_GIT_DIR);
    return execFileSync(
      'git',
      [
        '-c',
        'safe.directory=' + cwd,
        '-C',
        cwd,
        ...(gitdir ? ['--git-dir=' + gitdir] : []),
        ...args,
      ],
      { maxBuffer: 16000000 },
    );
  };
  const entry = git(root, ['ls-tree', 'HEAD', 'wizard']).toString().trim();
  const match = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(entry);
  const tree = /^040000 tree ([a-f0-9]{40})\twizard$/.exec(entry);
  if (!match && !tree)
    throw Error('System must contain a committed Wizard tree or historical gitlink.');
  const sourceRevision = tree ? git(root, ['rev-parse', 'HEAD']).toString().trim() : match![1];
  const wizard = tree ? root : path.join(root, 'wizard');
  const identity = tree
    ? { version: 2, sourceRevision, sourceLayout: 'system-monorepo-v1', wizardSourceTree: tree[1] }
    : { version: 1, sourceRevision };
  const files: SourceFile[] = [];
  for (const entry of git(wizard, ['ls-tree', '-rz', tree ? tree[1] : sourceRevision])
    .toString()
    .split('\0')
    .filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if (!match || !safePath(match[4])) throw Error('Unsafe Wizard source path.');
    const [, mode, type, oid, filename] = match;
    if (!['100644', '100755'].includes(mode) || type !== 'blob')
      throw Error('Wizard source links and nested submodules are unsupported.');
    if (excluded(filename)) continue;
    const content = git(wizard, ['cat-file', 'blob', oid]);
    files.push({
      path: filename === 'README.md' ? '.system-bootstrapper/SOURCE_README.md' : filename,
      mode,
      sha256: hash(content),
      content: content.toString('base64'),
    });
  }
  // The committed dotenv only supplies this known safe build setting. No dotenv is imported.
  const content = Buffer.from('SKIP_PREFLIGHT_CHECK=true\n');
  files.push({
    path: '.system-bootstrapper/preflight.env',
    mode: '100644',
    sha256: hash(content),
    content: content.toString('base64'),
  });
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifest = {
    ...identity,
    files: files.map(({ path, mode, sha256 }) => ({ path, mode, sha256 })),
  };
  return validate({ ...manifest, manifestHash: hash(JSON.stringify(manifest)), files });
}
export function verifyCommitted(root: string, snapshot: unknown): SourceSnapshot {
  const value = validate(snapshot);
  // A self-consistent content hash proves integrity, not provenance. Re-read
  // committed Wizard Git objects so a dirty generated snapshot cannot claim a pin.
  const committed = pack(root);
  if (
    value.sourceRevision !== committed.sourceRevision ||
    value.manifestHash !== committed.manifestHash
  ) {
    throw Error('Wizard snapshot differs from committed source objects. Regenerate it.');
  }
  return value;
}
export function sourceMetadata(snapshot: SourceIdentity): SourceIdentity {
  return snapshot.sourceLayout === 'system-monorepo-v1'
    ? { sourceLayout: snapshot.sourceLayout, wizardSourceTree: snapshot.wizardSourceTree }
    : {};
}

@Injectable()
export class WizardSourceService {
  pack(root: string, directories: SourceGitDirectories = {}): SourceSnapshot {
    return pack(root, directories);
  }

  validate(value: unknown): SourceSnapshot {
    return validate(value);
  }

  verifyCommitted(root: string, snapshot: unknown): SourceSnapshot {
    return verifyCommitted(root, snapshot);
  }
}
