import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProcessRunner, nativeProcess } from '../../common/runtime/process';
import { requireValue } from './types';
import { durableDirectory } from './manifest';
export type PreviewNormalizer = (input: unknown) => unknown;
export interface ConfigurationCapture {
  main: { data: string };
  projects: { filename: string; data: string }[];
  previewSetup?: unknown;
  seedAssociation?: Record<string, unknown>;
}
export interface CompletedSeed {
  generation: string;
  manifest: string;
  manifestSha256: string;
  completedAt: string;
  gitlabImage: string;
  gitlabImageId: string;
}
export interface BackupStatus {
  format: string;
  id: string;
  startedAt: string;
  state: string;
  phase: string;
  seed: (CompletedSeed & { location: string; status: string }) | null;
  configuration: { status: string; filename?: string; sha256?: string; download?: string };
  completedAt?: string;
  helperCompletedAt?: string;
  error?: string;
}
export interface BackupWorkflowOptions {
  state: string;
  seed: string;
  certbot: string;
  id: string;
  seedTarget?: string;
  harvest(token: string): void;
  exporter(input: string, output: string): void;
  normalizePreview: PreviewNormalizer;
  now?: () => string;
}
const sha256 = (bytes: string | Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
export function directory(state: string, id: string) {
  requireValue(/^[a-f0-9]{32}$/.test(id), 'invalid-backup-operation');
  return path.join(state, '.coordinated-backups', id);
}
export function writeStatus(root: string, value: BackupStatus) {
  fs.writeFileSync(path.join(root, '.status-next'), JSON.stringify(value) + '\n', {
    mode: 0o600,
    flush: true,
  });
  fs.renameSync(path.join(root, '.status-next'), path.join(root, 'status.json'));
  durableDirectory(root);
}
export function capture(state: string, normalizePreview: PreviewNormalizer) {
  const names = fs
    .readdirSync(path.join(state, '.projects.env'))
    .filter((name) => /^\.[A-Za-z0-9_.-]+\.env$/.test(name))
    .sort();
  const read = (filename: string) => {
    const full = path.join(state, filename),
      stat = fs.lstatSync(full);
    requireValue(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 5000000,
      'unsafe-configuration-input',
    );
    return fs.readFileSync(full, 'utf8');
  };
  const main = read('.docker.env');
  requireValue(
    main.charCodeAt(807) === 36 &&
      crypto.createHash('md5').update(main.slice(0, 1184)).digest('hex') ===
        'bd4a8426355824593a5e21ad759830c1',
    'configuration-cube-mismatch',
  );
  const projects = names.map((filename) => ({ filename, data: read('.projects.env/' + filename) }));
  requireValue(
    Buffer.byteLength(main) +
      projects.reduce((sum, item) => sum + Buffer.byteLength(item.data), 0) <=
      50000000,
    'configuration-backup-is-too-large',
  );
  const captured: ConfigurationCapture = { main: { data: main }, projects };
  const intentFile = path.join(state, 'preview-setup.json');

  if (fs.existsSync(intentFile)) {
    const stat = fs.lstatSync(intentFile);
    requireValue(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 100000,
      'unsafe-preview-setup-input',
    );
    const saved = JSON.parse(fs.readFileSync(intentFile, 'utf8'));
    captured.previewSetup = normalizePreview(saved.settings);
  }

  return captured;
}
export function checksums(input: ConfigurationCapture) {
  return [
    { filename: '.docker.env', sha256: sha256(input.main.data) },
    ...input.projects.map((file) => ({
      filename: '.projects.env/' + file.filename,
      sha256: sha256(file.data),
    })),
  ];
}
export function completed(seed: string): CompletedSeed {
  // Harvest already verified every payload byte before atomic publication.
  const relative = fs.readlinkSync(path.join(seed, 'current'));
  requireValue(/^snapshots\/[A-Za-z0-9][A-Za-z0-9.-]*$/.test(relative), 'invalid-seed-generation');
  const root = path.join(seed, relative);
  requireValue(fs.realpathSync(root) === root, 'unsafe-seed-generation');
  const raw = fs.readFileSync(path.join(root, 'manifest.json'));
  const record = JSON.parse(raw.toString('utf8'));
  requireValue(
    record.format === 'system-bootstrapper-seed-v2' &&
      record.consistency === 'gitlab-stopped' &&
      !Number.isNaN(Date.parse(record.completedAt)),
    'incomplete-seed-generation',
  );
  return {
    generation: relative.slice('snapshots/'.length),
    manifest: relative + '/manifest.json',
    manifestSha256: sha256(raw),
    completedAt: record.completedAt,
    gitlabImage: record.gitlabImage,
    gitlabImageId: record.gitlabImageId,
  };
}
export function runWorkflow({
  state,
  seed,
  certbot,
  id,
  harvest,
  exporter,
  normalizePreview,
  seedTarget = seed,
  now = () => new Date().toISOString(),
}: BackupWorkflowOptions): BackupStatus {
  const root = directory(state, id);
  requireValue(
    fs.realpathSync(root) === root && fs.statSync(root).isDirectory(),
    'unsafe-backup-operation',
  );
  const startedAt = now();
  let result: BackupStatus = {
    format: 'system-coordinated-backup-v1',
    id,
    startedAt,
    state: 'working',
    phase: 'capturing-configuration',
    seed: null,
    configuration: { status: 'pending' },
  };
  const update = (changes: Partial<BackupStatus>) => {
    result = { ...result, ...changes };
    writeStatus(root, result);
  };
  const lock = path.join(certbot, '.system-bootstrapper-certificate-lock');
  let held = false,
    token: string | undefined,
    prior: CompletedSeed | null = null,
    uncertain = false;
  try {
    try {
      prior = completed(seed);
    } catch {
      /* A first Harvest need not have a prior Seed. */
    }
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
    } catch {
      throw Error('certificate-operation-busy');
    }
    held = true;
    token = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(path.join(lock, 'coordinated-owner'), token, {
      mode: 0o600,
      flag: 'wx',
      flush: true,
    });
    update({});
    const input = capture(state, normalizePreview),
      capturedAt = now(),
      files = checksums(input);
    update({ phase: 'harvesting' });
    harvest(token);
    const snapshot = completed(seed);
    requireValue(!prior || snapshot.generation !== prior.generation, 'new-completed-seed-required');
    update({
      phase: 'exporting-configuration',
      seed: {
        ...snapshot,
        location: path.join(seedTarget, 'snapshots', snapshot.generation),
        status: 'completed',
      },
    });
    const finalCapture = capture(state, normalizePreview);
    requireValue(
      JSON.stringify(files) === JSON.stringify(checksums(finalCapture)) &&
        JSON.stringify(input.previewSetup) === JSON.stringify(finalCapture.previewSetup),
      'configuration-changed-during-backup',
    );
    input.seedAssociation = {
      format: 'system-backup-pair-v1',
      status: 'matched-completed-seed',
      verified: true,
      operation: id,
      ...snapshot,
      capturedAt,
      configurationFiles: files,
    };
    const inputPath = path.join(root, 'configuration-input.json'),
      output = path.join(root, 'bootstrapper.zip');
    fs.writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600, flag: 'wx', flush: true });
    try {
      exporter(inputPath, output);
    } finally {
      fs.unlinkSync(inputPath);
    }
    requireValue(
      fs.lstatSync(output).isFile() && !fs.lstatSync(output).isSymbolicLink(),
      'configuration-export-failed',
    );
    update({
      state: 'ready',
      phase: 'awaiting-download',
      completedAt: now(),
      configuration: {
        status: 'ready',
        filename: 'bootstrapper.zip',
        sha256: sha256(fs.readFileSync(output)),
        download: 'not-confirmed',
      },
    });
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error('coordinated-backup-failed');
    uncertain = 'uncertain' in error && error.uncertain === true;
    let snapshot;
    try {
      snapshot = completed(seed);
    } catch {
      /* Keep prior successful status if still readable. */
    }
    const fresh = snapshot && (!prior || snapshot.generation !== prior.generation);
    update({
      state: uncertain ? 'interrupted' : fresh ? 'partial' : 'failed',
      phase: uncertain ? 'needs-inspection' : 'failed',
      completedAt: now(),
      seed:
        fresh && snapshot
          ? {
              ...snapshot,
              location: path.join(seedTarget, 'snapshots', snapshot.generation),
              status: result.seed ? 'completed' : 'completed-resumption-unconfirmed',
            }
          : null,
      configuration: { status: 'unavailable' },
      error: /^[a-z][a-z0-9-]+$/.test(error.message) ? error.message : 'coordinated-backup-failed',
    });
    throw error;
  } finally {
    if (held && !uncertain) {
      try {
        requireValue(
          fs.readFileSync(path.join(lock, 'coordinated-owner'), 'utf8') === token,
          'certificate-lease-owner-changed',
        );
        fs.unlinkSync(path.join(lock, 'coordinated-owner'));
        fs.rmdirSync(lock);
      } catch {
        update({
          state: result.seed ? 'partial' : 'failed',
          phase: 'needs-inspection',
          error: 'certificate-lease-cleanup-failed',
          configuration: { status: 'unavailable' },
        });
        throw Error('certificate-lease-cleanup-failed');
      }
    }
  }
  return result;
}
export function helperCompleted(state: string, id: string) {
  const root = directory(state, id),
    status = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8'));
  const leasesRemain =
    fs.existsSync(path.join(state, '.storage-operation-lock')) ||
    fs.existsSync(path.join(state, '.projects.env/.wizard.env.environments.lock'));
  writeStatus(root, {
    ...status,
    helperCompletedAt: new Date().toISOString(),
    ...(status.state === 'ready' && leasesRemain
      ? {
          state: 'interrupted',
          phase: 'needs-inspection',
          error: 'storage-lease-release-unconfirmed',
          configuration: { status: 'unavailable' },
        }
      : {}),
  });
}
export function exportZip(input: string, output: string, runner: ProcessRunner = nativeProcess) {
  runner.run(
    process.execPath,
    ['/opt/system-bootstrapper/export-configuration.cjs', input, output],
    { timeout: 120000 },
  );
}
