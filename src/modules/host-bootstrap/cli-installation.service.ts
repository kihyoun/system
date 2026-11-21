import { Inject, Injectable, Optional } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { environmentAssignments } from '../../common/runtime/environment-assignments';
import { checkoutRoot } from '../../common/runtime/installation-paths';
import { nativeProcess, type ProcessRunner } from '../../common/runtime/process';
import { HostInstallService, acceptedMetadata, requireValue, writePrivate } from '../host/install';
import { readPrivateInput } from '../host/private-input';
import { replaceOwned } from '../host/release-selection.service';
import { recoverySource } from '../host/recovery-publication.service';
import { recoveryReference } from '../host/recovery-manifest';
import { storageEnvironment } from '../host-lifecycle/persistence.service';
import { readNpmReceipt, type NpmReceipt } from '../release/npm-identity';
import { acceptedCliArtifact } from '../release/github-cli-artifact';
import { imageId, record } from '../release/source-identity';
import type { InstalledSource } from '../host/install';

export const CLI_INSTALLATION_PATHS = Symbol('CLI_INSTALLATION_PATHS');
export const CLI_INSTALLATION_PROCESS = Symbol('CLI_INSTALLATION_PROCESS');
export interface CliInstallationPaths {
  binding: string;
  command: string;
  packageRoot: string;
  nodeExecutable: string;
}
export const nativeCliInstallationPaths = (): CliInstallationPaths => ({
  binding: '/etc/system-bootstrapper/cli-installation.json',
  command: '/usr/local/bin/system-bootstrapper',
  packageRoot: checkoutRoot(),
  nodeExecutable: process.execPath,
});
export interface CliInstallationInput {
  checkout?: string;
  persistenceEnv?: string;
  runtime?: string;
  releaseMetadata?: string;
  artifact?: string;
}
export interface CliHostSelection {
  checkout: string;
  persistenceEnv: string;
  image?: string;
}
interface CliBinding {
  format: 'system-cli-installation-v1';
  checkout: string;
  persistenceEnv: string;
  packageRoot: string;
  nodeExecutable: string;
  source: InstalledSource;
  cli?: NpmReceipt;
}
const absolute = (value: unknown): value is string =>
  typeof value === 'string' &&
  path.isAbsolute(value) &&
  path.resolve(value) === value &&
  value !== '/' &&
  !/[\0\r\n]/.test(value);

/** One explicit binding to an already verified installation; never searches cwd or host paths. */
@Injectable()
export class CliInstallationService {
  constructor(
    private readonly host: HostInstallService,
    @Inject(CLI_INSTALLATION_PATHS) readonly paths: CliInstallationPaths,
    @Optional()
    @Inject(CLI_INSTALLATION_PROCESS)
    private readonly process: ProcessRunner = nativeProcess,
  ) {}

  private trusted(filename: string, directory = false): void {
    requireValue(absolute(filename), 'cli-absolute-path-required');
    for (let current = filename; ; current = path.dirname(current)) {
      const stat = fs.lstatSync(current);
      requireValue(
        stat.uid === 0 &&
          !stat.isSymbolicLink() &&
          (current === filename && !directory ? stat.isFile() : stat.isDirectory()) &&
          ((stat.mode & 0o022) === 0 || (stat.isDirectory() && (stat.mode & 0o1000) !== 0)),
        'cli-root-owned-path-required',
      );
      if (current === path.dirname(current)) break;
    }
  }

  private privateJson(filename: string): Record<string, unknown> {
    this.trusted(path.dirname(filename), true);
    return record(
      JSON.parse(
        readPrivateInput(filename, 1024 * 1024, { owner: 0, mode: 0o600 }).toString('utf8'),
      ),
    );
  }

  private ownedCommand(entry: string): boolean {
    const stat = fs.lstatSync(this.paths.command, { throwIfNoEntry: false });
    if (!stat) return false;
    requireValue(stat.isSymbolicLink() && stat.uid === 0, 'cli-command-already-exists');
    const target = fs.readlinkSync(this.paths.command);
    requireValue(!/[\0\r\n]/.test(target), 'cli-command-already-exists');
    let current = '/',
      pending = (
        path.isAbsolute(target) ? target : path.dirname(this.paths.command) + '/' + target
      ).split('/'),
      links = 0;
    const seen = new Set<string>();
    while (pending.length) {
      const part = pending.shift();
      if (!part || part === '.') continue;
      if (part === '..') {
        current = path.dirname(current);
        continue;
      }
      const filename = path.join(current, part),
        parent = fs.lstatSync(filename);
      requireValue(
        parent.uid === 0 &&
          (parent.isSymbolicLink() ||
            (parent.mode & 0o022) === 0 ||
            (parent.isDirectory() && (parent.mode & 0o1000) !== 0)),
        'cli-command-already-exists',
      );
      if (parent.isSymbolicLink()) {
        const state = filename + '\0' + pending.join('/');
        requireValue(++links <= 40 && !seen.has(state), 'cli-command-already-exists');
        seen.add(state);
        const next = fs.readlinkSync(filename);
        requireValue(!/[\0\r\n]/.test(next), 'cli-command-already-exists');
        if (path.isAbsolute(next)) current = '/';
        pending = [...next.split('/'), ...pending];
      } else {
        requireValue(
          pending.length ? parent.isDirectory() : parent.isFile(),
          'cli-command-already-exists',
        );
        current = filename;
      }
    }
    requireValue(
      current === entry && fs.realpathSync(this.paths.command) === entry,
      'cli-command-already-exists',
    );
    return true;
  }

  private configuration(persistenceEnv: string): string {
    requireValue(absolute(persistenceEnv), 'cli-absolute-path-required');
    this.trusted(path.dirname(persistenceEnv), true);
    const saved = environmentAssignments(
      readPrivateInput(persistenceEnv, 16384, { owner: 0, mode: 0o600 }).toString('utf8'),
    );
    requireValue(
      ['local', 'volume'].includes(saved.PERSISTENCE_MODE || '') && absolute(saved.PERSISTENT_DIR),
      'cli-storage-selection-required',
    );
    const selected = storageEnvironment(saved);
    requireValue(absolute(selected.PERSISTENT_DIR), 'cli-storage-selection-required');
    return path.join(selected.PERSISTENT_DIR, 'configuration');
  }

  private verifyArtifact(
    packageRoot: string,
    node: string,
    receipt: NpmReceipt,
    artifact?: string,
  ): void {
    requireValue(absolute(artifact), 'cli-accepted-artifact-required');
    this.trusted(path.dirname(artifact), true);
    const sourceFile = path.join(packageRoot, 'assets/source.json');
    this.trusted(sourceFile);
    requireValue(fs.statSync(sourceFile).size <= 16384, 'cli-package-provenance-invalid');
    const source = record(JSON.parse(fs.readFileSync(sourceFile, 'utf8')));
    requireValue(source.format === 'system-cli-source-v1', 'cli-package-provenance-invalid');
    const bytes = readPrivateInput(artifact, 128 * 1024 ** 2, { owner: 0, mode: 0o600 });
    acceptedCliArtifact(receipt, bytes, {
      version: typeof source.version === 'string' ? source.version : '',
      sourceRevision: typeof source.sourceRevision === 'string' ? source.sourceRevision : '',
      sourceTree: typeof source.sourceTree === 'string' ? source.sourceTree : '',
      pipelineId: typeof source.pipelineId === 'number' ? source.pipelineId : NaN,
      packageJobId: typeof source.packageJobId === 'number' ? source.packageJobId : NaN,
    });
    const run = (args: string[]) =>
      this.process.run('tar', args, { timeout: 120000, maxBuffer: 32 * 1024 ** 2 }).stdout;
    const names = run(['--list', '--gzip', '--quoting-style=literal', '--file', artifact])
      .trimEnd()
      .split('\n');
    const valid = names.every((name) => {
      const clean = name.replace(/\/$/, '');
      return (
        (clean === 'package' || clean.startsWith('package/')) &&
        !/[\0-\x1f\x7f\\]/.test(clean) &&
        clean.split('/').every((part) => part && part !== '.' && part !== '..')
      );
    });
    requireValue(
      valid && new Set(names).size === names.length && names.length <= 100000,
      'cli-artifact-paths-invalid',
    );
    const types = run([
      '--list',
      '--verbose',
      '--gzip',
      '--quoting-style=literal',
      '--file',
      artifact,
    ])
      .trimEnd()
      .split('\n');
    requireValue(
      types.length === names.length && types.every((line) => /^[-d]/.test(line)),
      'cli-artifact-regular-files-required',
    );
    const temporary = fs.mkdtempSync(path.join(path.dirname(artifact), '.cli-verify-'));
    try {
      run([
        '--extract',
        '--gzip',
        '--no-same-owner',
        '--no-same-permissions',
        '--file',
        artifact,
        '--directory',
        temporary,
      ]);
      const expected = new Set<string>();
      for (const name of names.filter((_name, index) => types[index].startsWith('-'))) {
        requireValue(name.startsWith('package/'), 'cli-artifact-paths-invalid');
        const relative = name.slice(8),
          target = path.join(packageRoot, relative);
        this.trusted(target);
        let actual = fs.readFileSync(target),
          original = fs.readFileSync(path.join(temporary, name));
        if (relative === 'dist/cli/main.js') {
          const actualEnd = actual.indexOf(10),
            originalEnd = original.indexOf(10);
          requireValue(
            actualEnd > 0 &&
              originalEnd > 0 &&
              original.subarray(0, originalEnd).toString() === '#!/usr/bin/env node' &&
              ['#!/usr/bin/env node', '#!' + node].includes(
                actual.subarray(0, actualEnd).toString(),
              ),
            'cli-bin-shebang-invalid',
          );
          actual = actual.subarray(actualEnd + 1);
          original = original.subarray(originalEnd + 1);
        }
        requireValue(actual.equals(original), 'cli-installed-artifact-bytes-mismatch');
        expected.add(relative);
      }
      const walk = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const filename = path.join(directory, entry.name),
            relative = path.relative(packageRoot, filename).split(path.sep).join('/');
          if (relative === 'node_modules/.package-lock.json') continue;
          if (entry.isDirectory()) walk(filename);
          else if (entry.isSymbolicLink() && /(?:^|\/)node_modules\/\.bin\//.test(relative)) {
            const target = fs.realpathSync(filename);
            requireValue(
              target.startsWith(packageRoot + '/') &&
                expected.has(path.relative(packageRoot, target).split(path.sep).join('/')),
              'cli-installed-artifact-bytes-mismatch',
            );
          } else
            requireValue(
              entry.isFile() && expected.has(relative),
              'cli-installed-artifact-bytes-mismatch',
            );
        }
      };
      walk(packageRoot);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  private selectedSource(checkout: string, persistenceEnv: string): InstalledSource {
    this.trusted(checkout, true);
    const installed = this.privateJson(
      path.join(this.configuration(persistenceEnv), '.release-images.json'),
    );
    requireValue(
      installed.schemaVersion === 1 &&
        ['selected', 'startup-requested', 'startup-failed'].includes(String(installed.status)),
      'cli-installation-receipt-required',
    );
    const source = recoverySource(installed);
    requireValue(
      JSON.stringify(this.host.source(checkout)) === JSON.stringify(source),
      'cli-installation-source-mismatch',
    );
    return source;
  }

  resolve(storage = false): CliHostSelection {
    requireValue(this.host.rootUser(), 'cli-host-requires-root');
    requireValue(
      fs.lstatSync(this.paths.binding, { throwIfNoEntry: false }),
      'cli-installation-required',
    );
    const value = this.privateJson(this.paths.binding);
    requireValue(
      value.format === 'system-cli-installation-v1' &&
        absolute(value.checkout) &&
        absolute(value.persistenceEnv) &&
        absolute(value.packageRoot) &&
        absolute(value.nodeExecutable),
      'cli-installation-binding-invalid',
    );
    this.trusted(value.checkout, true);
    this.trusted(value.packageRoot, true);
    this.trusted(value.nodeExecutable);
    requireValue(
      value.packageRoot === fs.realpathSync(this.paths.packageRoot) &&
        value.nodeExecutable === fs.realpathSync(this.paths.nodeExecutable),
      'cli-installation-runtime-mismatch',
    );
    const source = recoverySource(value.source);
    requireValue(
      JSON.stringify(this.host.source(value.checkout)) === JSON.stringify(source),
      'cli-installation-source-mismatch',
    );
    if (value.cli !== undefined) readNpmReceipt(value.cli);
    const result: CliHostSelection = {
      checkout: value.checkout,
      persistenceEnv: value.persistenceEnv,
    };
    const configuration = this.configuration(value.persistenceEnv);
    if (storage) {
      this.trusted(configuration, true);
      const main = path.join(configuration, '.docker.env');
      const filename = fs.lstatSync(main, { throwIfNoEntry: false })
        ? main
        : path.join(configuration, '.release-images.env');
      const selected = environmentAssignments(
        readPrivateInput(filename, 1024 * 1024, { owner: 0, mode: 0o600 }).toString('utf8'),
      );
      const image = selected.BOOTSTRAPPER_IMAGE;
      requireValue(
        recoveryReference(image) &&
          (imageId(image) ||
            /@sha256:[a-f0-9]{64}$/.test(image) ||
            /^system-bootstrapper-recovery:[a-f0-9]{64}$/.test(image) ||
            /^system-successor:[a-f0-9]{40}-job[1-9][0-9]*$/.test(image)),
        'cli-saved-controller-image-required',
      );
      result.image = selected.BOOTSTRAPPER_IMAGE;
    }
    return result;
  }

  install(input: CliInstallationInput): void {
    requireValue(this.host.rootUser(), 'cli-installation-requires-root');
    const packageRoot = fs.realpathSync(this.paths.packageRoot),
      node = fs.realpathSync(this.paths.nodeExecutable);
    this.trusted(packageRoot, true);
    this.trusted(node);
    requireValue(process.version === 'v24.22.0', 'cli-pinned-node-required');
    requireValue(
      !/\s/.test(node) &&
        Buffer.byteLength(node) < 240 &&
        (fs.statSync(node).mode & 0o005) === 0o005,
      'cli-public-node-executable-required',
    );
    const metadata = record(
      JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')),
    );
    requireValue(
      metadata.name === '@systembootstrapper/cli' &&
        record(metadata.bin)['system-bootstrapper'] === 'dist/cli/main.js',
      'cli-package-bin-required',
    );
    const entry = path.join(packageRoot, 'dist/cli/main.js');
    this.trusted(entry);
    this.trusted(path.dirname(this.paths.command), true);
    const existing = this.ownedCommand(entry);
    if (input.runtime) {
      this.trusted(input.runtime, true);
      requireValue(
        packageRoot === path.join(input.runtime, 'cli/node_modules/@systembootstrapper/cli') &&
          fs.readFileSync(path.join(input.runtime, 'node-executable'), 'utf8') === node + '\n',
        'cli-offline-runtime-mismatch',
      );
    }
    const releaseMetadata =
        input.releaseMetadata ||
        (input.runtime ? path.join(input.runtime, 'accepted-release.json') : undefined),
      artifact =
        input.artifact ||
        (input.runtime ? path.join(input.runtime, 'accepted-cli.tgz') : undefined);
    let cli: NpmReceipt | undefined;
    if (releaseMetadata) {
      const release = this.privateJson(releaseMetadata),
        source = record(release.source);
      cli = readNpmReceipt(record(release.quickstart).cli);
      requireValue(
        cli.version === metadata.version &&
          cli.sourceRevision === source.revision &&
          cli.sourceTree === source.tree &&
          cli.version === release.version,
        'cli-release-source-mismatch',
      );
      const images = record(release.images);
      acceptedMetadata(
        releaseMetadata,
        {
          sourceCommit: cli.sourceRevision,
          sourceTree: cli.sourceTree,
          sourceLayout: 'system-monorepo-v1',
          wizardSourceTree: String(source.wizardSourceTree),
        },
        String(record(images.controller).reference),
        String(record(images.wizard).reference),
      );
      this.verifyArtifact(packageRoot, node, cli, artifact);
    }
    if (input.runtime) {
      requireValue(cli, 'cli-accepted-runtime-receipt-required');
    }
    requireValue(input.checkout || cli, 'cli-verified-installation-required');
    let binding: CliBinding | undefined;
    if (input.checkout) {
      const persistenceEnv = input.persistenceEnv || '/etc/system-bootstrapper/persistence.env';
      const source = this.selectedSource(input.checkout, persistenceEnv);
      if (cli)
        requireValue(
          source.sourceCommit === cli.sourceRevision && source.sourceTree === cli.sourceTree,
          'cli-release-source-mismatch',
        );
      else
        requireValue(
          packageRoot === input.checkout ||
            JSON.stringify(this.host.source(packageRoot)) === JSON.stringify(source),
          'cli-package-source-mismatch',
        );
      binding = {
        format: 'system-cli-installation-v1',
        checkout: input.checkout,
        persistenceEnv,
        packageRoot,
        nodeExecutable: node,
        source,
        ...(cli ? { cli } : {}),
      };
      this.trusted(path.dirname(this.paths.binding), true);
      if (fs.lstatSync(this.paths.binding, { throwIfNoEntry: false })) {
        requireValue(
          JSON.stringify(this.privateJson(this.paths.binding)) === JSON.stringify(binding),
          'cli-installation-already-bound',
        );
      }
    }
    const bytes = fs.readFileSync(entry),
      newline = bytes.indexOf(10);
    requireValue(
      newline > 0 &&
        ['#!/usr/bin/env node', '#!' + node].includes(bytes.subarray(0, newline).toString('utf8')),
      'cli-bin-shebang-invalid',
    );
    // Only public executable/package bytes become traversable. Private receipts
    // and the host installation's configuration keep their existing permissions.
    const publicRoot = input.runtime || packageRoot;
    const modes = new Map<string, { before: number; after: number }>();
    const publicAncestors = (filename: string) => {
      for (
        let directory = path.dirname(filename);
        directory !== '/';
        directory = path.dirname(directory)
      ) {
        const stat = fs.lstatSync(directory);
        if (directory === publicRoot || directory.startsWith(publicRoot + '/'))
          modes.set(directory, { before: stat.mode & 0o7777, after: 0o755 });
        else requireValue((stat.mode & 0o001) !== 0, 'cli-public-runtime-required');
      }
    };
    for (const filename of [
      entry,
      path.join(packageRoot, 'package.json'),
      path.join(packageRoot, 'dist/cli/presentation.js'),
      path.join(packageRoot, 'dist/cli/application-commands.js'),
    ]) {
      this.trusted(filename);
      modes.set(filename, {
        before: fs.statSync(filename).mode & 0o7777,
        after: filename === entry ? 0o755 : 0o644,
      });
      publicAncestors(filename);
    }
    publicAncestors(node);
    const selected = Buffer.concat([Buffer.from('#!' + node + '\n'), bytes.subarray(newline + 1)]);
    const original = fs.statSync(entry);
    const newBinding = binding && !fs.lstatSync(this.paths.binding, { throwIfNoEntry: false });
    const bindingBytes = binding && Buffer.from(JSON.stringify(binding) + '\n');
    try {
      if (!bytes.equals(selected))
        replaceOwned(entry, selected, { uid: original.uid, gid: original.gid, mode: 0o755 });
      for (const [filename, mode] of modes)
        if (mode.before !== mode.after) fs.chmodSync(filename, mode.after);
      if (newBinding && bindingBytes) writePrivate(this.paths.binding, bindingBytes);
      // Publish only after both executable and private installation selection are durable.
      if (!existing) fs.symlinkSync(entry, this.paths.command);
    } catch (error) {
      try {
        if (
          newBinding &&
          bindingBytes &&
          fs.lstatSync(this.paths.binding, { throwIfNoEntry: false })
        ) {
          requireValue(
            readPrivateInput(this.paths.binding, 1024 * 1024, { owner: 0, mode: 0o600 }).equals(
              bindingBytes,
            ),
            'cli-installation-rollback-failed',
          );
          fs.unlinkSync(this.paths.binding);
        }
        const current = fs.readFileSync(entry);
        if (!current.equals(bytes)) {
          requireValue(current.equals(selected), 'cli-installation-rollback-failed');
          replaceOwned(entry, bytes, {
            uid: original.uid,
            gid: original.gid,
            mode: original.mode & 0o7777,
          });
        }
        for (const [filename, mode] of [...modes].reverse())
          if (mode.before !== mode.after) fs.chmodSync(filename, mode.before);
      } catch {
        throw Error('cli-installation-rollback-failed');
      }
      throw error;
    }
  }
}
