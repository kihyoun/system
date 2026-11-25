import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { nativeProcess, type ProcessRunner } from '../../common/runtime/process';
import { maxCliArtifactBytes } from './cliFileEvidence';
import { verifyPublicPayload } from '../../common/publicPayload';

export interface CliCompanion {
  format: 'system-cli-companion-v1';
  version: string;
  sourceRevision: string;
  sourceTree: string;
  sha256: string;
}
export interface CliArtifact extends CliCompanion {
  bytes: Buffer;
}
export function cliArtifactFiles(artifact: CliArtifact, prefix = '.gitlab/cli') {
  const { bytes, ...receipt } = artifact;
  return [
    { path: prefix + '/system-bootstrapper.tgz', bytes },
    {
      path: prefix + '/system-bootstrapper.tgz.json',
      bytes: Buffer.from(JSON.stringify(receipt) + '\n'),
    },
    {
      path: prefix + '/system-bootstrapper.tgz.sha256',
      bytes: Buffer.from(artifact.sha256 + '  system-bootstrapper.tgz\n'),
    },
  ];
}
const hash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
const ensure: (value: unknown, code: string) => asserts value = (value, code) => {
  if (!value) {
    throw Error(code);
  }
};
function regular(filename: string, limit: number): Buffer {
  ensure(
    path.isAbsolute(filename) && fs.realpathSync(filename) === filename,
    'cli-artifact-path-required',
  );
  const stat = fs.lstatSync(filename);
  ensure(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit,
    'cli-artifact-file-invalid',
  );
  return fs.readFileSync(filename);
}
export function validateCliCompanion(value: unknown): CliCompanion {
  const record = value as Partial<CliCompanion>;
  ensure(
    record &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      Object.keys(record).sort().join(',') === 'format,sha256,sourceRevision,sourceTree,version' &&
      record.format === 'system-cli-companion-v1' &&
      typeof record.version === 'string' &&
      /^\d+\.\d+\.\d+$/.test(record.version) &&
      typeof record.sourceRevision === 'string' &&
      /^[a-f0-9]{40}$/.test(record.sourceRevision) &&
      typeof record.sourceTree === 'string' &&
      /^[a-f0-9]{40}$/.test(record.sourceTree) &&
      typeof record.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(record.sha256),
    'cli-companion-receipt-invalid',
  );
  return record as CliCompanion;
}
/** The selected regular package is retained separately; never repack an accepted transport implicitly. */
export function readCliArtifact(
  filename: string,
  receiptFile = filename + '.json',
  runner: ProcessRunner = nativeProcess,
): CliArtifact {
  const bytes = regular(filename, maxCliArtifactBytes),
    receipt = validateCliCompanion(JSON.parse(regular(receiptFile, 16384).toString()));
  ensure(hash(bytes) === receipt.sha256, 'cli-artifact-hash-mismatch');
  const read = (name: string) =>
    runner.run('tar', ['-xOzf', filename, 'package/' + name], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    }).stdout;
  const metadata = JSON.parse(read('package.json')) as {
      name?: string;
      version?: string;
      bin?: Record<string, string>;
    },
    source = JSON.parse(read('assets/source.json')) as Record<string, unknown>;
  ensure(
    metadata.name === '@systembootstrapper/cli' &&
      metadata.version === receipt.version &&
      metadata.bin?.['system-bootstrapper'] === 'dist/cli/main.js' &&
      source.format === 'system-cli-source-v1' &&
      source.version === receipt.version &&
      source.sourceRevision === receipt.sourceRevision &&
      source.sourceTree === receipt.sourceTree,
    'cli-artifact-source-mismatch',
  );
  return { ...receipt, bytes };
}
export function selectedCliArtifact(env: NodeJS.ProcessEnv = process.env): CliArtifact {
  const filename = env.SYSTEM_CLI_ARTIFACT;
  ensure(filename && path.isAbsolute(filename), 'select-source-bound-cli-artifact');
  return readCliArtifact(filename, env.SYSTEM_CLI_RECEIPT || filename + '.json');
}
/** Local preparation creates a regular bundled npm package without registry publication. */
export function createCliArtifact(
  root: string,
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
  runner: ProcessRunner = nativeProcess,
): CliCompanion & { filename: string } {
  ensure(
    path.isAbsolute(root) && path.isAbsolute(directory),
    'absolute-cli-package-paths-required',
  );
  verifyPublicPayload(root);
  const git = (revision: string) =>
    runner
      .run('git', ['-c', 'safe.directory=' + root, '-C', root, 'rev-parse', revision], {
        timeout: 30000,
      })
      .stdout.trim();
  const sourceRevision = git('HEAD'),
    sourceTree = git('HEAD^{tree}');
  ensure(
    !runner
      .run('git', ['-c', 'safe.directory=' + root, '-C', root, 'status', '--porcelain'], {
        timeout: 30000,
      })
      .stdout.trim(),
    'cli-package-clean-source-required',
  );
  ensure(
    /^[a-f0-9]{40}$/.test(sourceRevision) &&
      /^[a-f0-9]{40}$/.test(sourceTree) &&
      (!env.CI_COMMIT_SHA || env.CI_COMMIT_SHA === sourceRevision),
    'cli-package-source-required',
  );
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    version: string;
  };
  const retained = path.join(directory, `systembootstrapper-cli-${metadata.version}.tgz`);

  if (fs.existsSync(retained)) {
    const artifact = readCliArtifact(retained, retained + '.json', runner);
    ensure(
      artifact.sourceRevision === sourceRevision &&
        artifact.sourceTree === sourceTree &&
        artifact.version === metadata.version,
      'retained-cli-artifact-source-mismatch',
    );
    return {
      format: artifact.format,
      version: artifact.version,
      sourceRevision,
      sourceTree,
      sha256: artifact.sha256,
      filename: retained,
    };
  }

  const source = {
    format: 'system-cli-source-v1',
    version: metadata.version,
    sourceRevision,
    sourceTree,
    ...(env.CI_PIPELINE_ID && env.CI_JOB_ID
      ? { pipelineId: Number(env.CI_PIPELINE_ID), packageJobId: Number(env.CI_JOB_ID) }
      : {}),
  };
  fs.writeFileSync(path.join(root, 'assets/source.json'), JSON.stringify(source) + '\n');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cli-pack-'));
  try {
    const result: unknown = JSON.parse(
      runner.run(
        'npm',
        ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', directory],
        {
          cwd: root,
          env: { PATH: env.PATH, HOME: home },
          timeout: 120000,
          maxBuffer: 4 * 1024 ** 2,
        },
      ).stdout,
    );
    ensure(Array.isArray(result) && result.length === 1, 'regular-cli-package-required');
    const packed = result[0] as { filename?: string; files?: { path: string }[] };
    ensure(
      packed.filename === `systembootstrapper-cli-${metadata.version}.tgz` &&
        packed.files?.every((file) => !file.path.startsWith(path.relative(root, directory) + '/')),
      'recursive-cli-package-refused',
    );
    const filename = path.join(directory, packed.filename),
      bytes = regular(filename, maxCliArtifactBytes);
    const receipt = validateCliCompanion({
      format: 'system-cli-companion-v1',
      version: metadata.version,
      sourceRevision,
      sourceTree,
      sha256: hash(bytes),
    });
    fs.writeFileSync(filename + '.json', JSON.stringify(receipt) + '\n', { mode: 0o600 });
    readCliArtifact(filename, filename + '.json', runner);
    return { ...receipt, filename };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
