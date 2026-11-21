import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONTEXT_PROCESS, type ContextProcess } from './context-process';
import { snapshotPath } from './context-selection';
import { WizardSourceService, sourceMetadata } from '../source-preparation/wizard-source.service';
import type { SourceFile, SourceSnapshot } from '../project-lifecycle/upgrade-types';
export interface ContextEntry {
  mode: string;
  type: string;
  name: string;
}
export const contextHash = (bytes: Buffer): string =>
  crypto.createHash('sha256').update(bytes).digest('hex');
@Injectable()
export class CommittedContextService {
  constructor(
    @Inject(CONTEXT_PROCESS) private readonly process: ContextProcess,
    private readonly wizard: WizardSourceService,
  ) {}

  git(
    root: string,
    args: string[],
    environment: NodeJS.ProcessEnv = process.env,
    wizardRoot?: string,
  ): Buffer {
    const directory = wizardRoot ?? root;
    const gitdir =
      directory === root ? environment.SYSTEM_SOURCE_GIT_DIR : environment.WIZARD_SOURCE_GIT_DIR;
    return this.process.run(
      'git',
      [
        '--no-replace-objects',
        '-c',
        'safe.directory=' + directory,
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.eol=lf',
        '-c',
        'tar.umask=0022',
        '-C',
        directory,
        ...(gitdir ? ['--git-dir=' + gitdir] : []),
        ...args,
      ],
      { env: environment },
    );
  }

  snapshot(root: string): SourceSnapshot {
    const snapshot = this.wizard.validate(
      JSON.parse(fs.readFileSync(path.join(root, snapshotPath), 'utf8')) as unknown,
    );
    this.wizard.verifyCommitted(root, snapshot);
    return snapshot;
  }

  entries(
    root: string,
    reference = 'HEAD',
    environment: NodeJS.ProcessEnv = process.env,
    wizardRoot?: string,
  ): ContextEntry[] {
    return this.git(root, ['ls-tree', '-rz', reference], environment, wizardRoot)
      .toString()
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const match = /^(\d+) (\w+) [a-f0-9]{40}\t(.+)$/.exec(entry);
        if (!match) throw Error('Unexpected committed tree entry.');
        return { mode: match[1], type: match[2], name: match[3] };
      });
  }

  requireRegular(entries: ContextEntry[], message: string): void {
    if (entries.some((file) => file.type !== 'blob' || !['100644', '100755'].includes(file.mode)))
      throw Error(message);
  }

  verifySourceSelection(entries: ContextEntry[], included: (name: string) => boolean): void {
    if (
      entries.some(
        (file) =>
          file.name.startsWith('src/') && /\.[cm]?[jt]sx?$/.test(file.name) && !included(file.name),
      )
    )
      throw Error('Shared source path conflicts with a private-data exclusion.');
  }

  output(root: string, name: string): string {
    const output = path.join(root, name);
    if (
      fs.existsSync(output) &&
      (fs.lstatSync(output).isSymbolicLink() || !fs.lstatSync(output).isDirectory())
    )
      throw Error('Context output must be a real directory.');
    fs.mkdirSync(output, { recursive: true });
    return output;
  }

  archive(
    root: string,
    files: ContextEntry[],
    archive: string,
    destination: string,
    environment: NodeJS.ProcessEnv = process.env,
    reference = 'HEAD',
    wizardRoot?: string,
  ): void {
    this.git(
      root,
      [
        'archive',
        '--format=tar',
        '--output=' + archive,
        reference,
        '--',
        ...files.map((file) => file.name),
      ],
      environment,
      wizardRoot,
    );
    this.process.run('tar', ['-xf', archive, '-C', destination], { env: environment });
  }

  pack(
    directory: string,
    archive: string,
    files: string[],
    environment: NodeJS.ProcessEnv = process.env,
  ): void {
    this.process.run('tar', ['-cf', archive, '-C', directory, ...files], { env: environment });
  }

  verifyArchive(
    archive: string,
    expected: string[],
    environment: NodeJS.ProcessEnv = process.env,
  ): void {
    const names = this.process
      .run('tar', ['--list', '--file', archive], { env: environment, maxBuffer: 4 * 1024 * 1024 })
      .toString()
      .split(/\r?\n/)
      .filter((name) => name && !name.endsWith('/'))
      .sort();
    if (JSON.stringify(names) !== JSON.stringify([...expected].sort()))
      throw Error('Archive differs from the explicit committed inputs.');
  }

  write(directory: string, name: string, content: string | Buffer, mode?: string): void {
    const filename = path.join(directory, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content, { mode: mode === '100755' ? 0o755 : 0o644 });
  }

  stageSnapshot(directory: string, snapshot: SourceSnapshot): string[] {
    const files = snapshot.files.map(({ path, mode, sha256, content }) => ({
      path,
      mode,
      sha256,
      content,
    }));
    this.write(
      directory,
      snapshotPath,
      JSON.stringify({
        version: snapshot.version,
        sourceRevision: snapshot.sourceRevision,
        ...sourceMetadata(snapshot),
        manifestHash: snapshot.manifestHash,
        files,
      }),
    );
    return [snapshotPath, ...this.stageWizard(directory, files)];
  }

  stageWizard(directory: string, files: SourceFile[]): string[] {
    return files.map((file) => {
      const name = 'wizard/' + file.path;
      this.write(directory, name, Buffer.from(file.content, 'base64'), file.mode);
      return name;
    });
  }

  publish(
    output: string,
    temporary: string,
    revision: string,
    manifest: Record<string, unknown>,
  ): void {
    const checksum = contextHash(fs.readFileSync(path.join(temporary, 'context.tar')));
    this.write(temporary, 'revision', revision + '\n');
    this.write(temporary, 'sha256', checksum + '\n');
    this.write(temporary, 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    for (const name of ['context.tar', 'revision', 'sha256', 'manifest.json'])
      fs.renameSync(path.join(temporary, name), path.join(output, name));
  }
}
