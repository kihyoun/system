import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { record } from '../release/source-identity';
import { requireValue as ensure, privateFile, writePrivate } from './install';
import { upgradePath } from './upgrade-graph';
type NativeResult<T> = T | Promise<T>;
type Row = Record<string, unknown>;
export interface PublicUpgradePlanInput {
  attemptId: string;
  target: string;
  repository: string;
  directory: string;
  backupFile: string;
  gitlabCheckpoint?: string;
  root: string;
  checkout: string;
  backupDestination: string;
}
export interface PublicUpgradePlanPort {
  publicInputs(
    repository: string,
    target: string,
  ): NativeResult<{
    raw: string;
    proof: string;
    release: Row;
    metadata: Row;
    evidence: Row;
    graph: unknown;
  }>;
  verifyCheckout(): NativeResult<void>;
  installed(repository: string, target: string): NativeResult<Row>;
  prerequisite(checkpoint: string): NativeResult<unknown>;
  host(): NativeResult<void>;
  syncIdle(): NativeResult<void>;
  freeBytes(): NativeResult<number[]>;
  backupTarget(filename: string): NativeResult<string>;
  selection(): NativeResult<{ json: string; environment: string; configurationSha256: string }>;
  capture(): NativeResult<unknown>;
  invoke(checkpoint: string, metadataFile: string): NativeResult<void>;
  dataSample(): NativeResult<unknown>;
  now(): NativeResult<string>;
}
const sha = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
export class PublicUpgradePlanService {
  constructor(readonly port: PublicUpgradePlanPort) {}

  interrupt(directory: string, attemptId: unknown): void {
    ensure(
      typeof attemptId === 'string' && /^[a-f0-9]{32}$/.test(attemptId),
      'public-upgrade-attempt-identity-required',
    );
    const file = path.join(directory, 'preflight.json');
    if (!fs.existsSync(file)) return;
    ensure(
      path.isAbsolute(directory) && fs.realpathSync(directory) === directory,
      'retained-public-upgrade-directory-required',
    );
    privateFile(file);
    const value = record(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (
      value.format === 'system-public-upgrade-preflight-v1' &&
      value.phase === 'checking' &&
      value.attemptId === attemptId
    )
      writePrivate(
        file,
        Buffer.from(JSON.stringify({ ...value, phase: 'failed' }, null, 2) + '\n'),
      );
  }

  async plan(
    input: PublicUpgradePlanInput,
    port: PublicUpgradePlanPort = this.port,
  ): Promise<{ value: Row; sha256: string }> {
    ensure(/^[a-f0-9]{32}$/.test(input.attemptId), 'public-upgrade-attempt-identity-required');
    const authority = await port.publicInputs(input.repository, input.target);
    ensure(
      input.target === fs.readFileSync(path.join(input.checkout, 'VERSION'), 'utf8').trim(),
      'run-the-selected-target-release-checkout',
    );
    await port.verifyCheckout();
    const previous = await port.installed(input.repository, input.target),
      route = upgradePath(authority.graph, String(previous.version), input.target);
    ensure(
      route.status === 'supported',
      'upgrade-selection-' + route.status + '-see-public-upgrade-guide',
    );
    if (route.transitions.length === 1) {
      const tested = record(record(authority.evidence.evidence).publicUpgrade),
        images = record(previous.images);
      ensure(
        tested.fromVersion === previous.version &&
          tested.fromSourceRevision === record(previous.source).revision &&
          tested.fromControllerImageId === record(images.controller).imageId &&
          tested.fromWizardImageId === record(images.wizard).imageId,
        'installed-release-not-the-tested-upgrade-baseline',
      );
    }
    let prerequisite: unknown = null;
    if (route.transitions.some((edge) => edge.databaseMigration)) {
      ensure(
        route.transitions.length === 1 && input.gitlabCheckpoint,
        'complete-native-gitlab-upgrade-first-and-select-retained-checkpoint',
      );
      prerequisite = await port.prerequisite(input.gitlabCheckpoint);
    }
    await port.host();
    await port.syncIdle();
    const required = Math.max(...route.transitions.map((edge) => edge.minimumFreeGiB)) * 1024 ** 3;
    const free = await port.freeBytes();
    ensure(
      free.length === 2 && free.every((bytes) => Number.isFinite(bytes) && bytes >= required),
      'insufficient-upgrade-checkpoint-or-image-storage',
    );
    const backup = await port.backupTarget(input.backupFile);
    const directory = input.directory,
      boundary = path.join(input.root, 'recovery/public-upgrades');
    let ancestor = directory;
    while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor)
      ancestor = path.dirname(ancestor);
    ensure(
      path.isAbsolute(directory) &&
        directory.startsWith(boundary + path.sep) &&
        path.resolve(directory) === directory &&
        path.join(fs.realpathSync(ancestor), path.relative(ancestor, directory)) === directory,
      'retained-public-upgrade-directory-required',
    );
    const existing = fs.existsSync(directory);
    if (existing) {
      ensure(
        fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(),
        'retained-public-upgrade-directory-required',
      );
      const preflight = path.join(directory, 'preflight.json');
      privateFile(preflight);
      const attempt = record(JSON.parse(fs.readFileSync(preflight, 'utf8'))),
        allowed = [
          'preflight.json',
          'target.json',
          'provenance.json',
          'previous-release.json',
          'previous-selection.json',
          'previous-selection.env',
          'baseline.json',
        ];
      ensure(
        attempt.format === 'system-public-upgrade-preflight-v1' &&
          attempt.phase === 'failed' &&
          fs.readdirSync(directory).every((name) => allowed.includes(name)),
        'existing-upgrade-directory-needs-status-inspection',
      );
    }
    const checkpoint = path.join(
      input.root,
      'recovery/controller-updates',
      path.basename(directory),
    );
    ensure(!fs.existsSync(checkpoint), 'controller-update-checkpoint-already-exists');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const save = (name: string, bytes: Buffer) => writePrivate(path.join(directory, name), bytes),
      json = (name: string, value: unknown) =>
        save(name, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
    const attempt: Row = {
      format: 'system-public-upgrade-preflight-v1',
      phase: 'checking',
      attemptId: input.attemptId,
      targetVersion: input.target,
      at: await port.now(),
    };
    json('preflight.json', attempt);
    try {
      const raw = Buffer.from(authority.raw, 'base64'),
        proof = Buffer.from(authority.proof, 'base64');
      save('target.json', raw);
      save('provenance.json', proof);
      json('previous-release.json', previous);
      const selected = await port.selection();
      save('previous-selection.json', Buffer.from(selected.json, 'base64'));
      save('previous-selection.env', Buffer.from(selected.environment, 'base64'));
      json('baseline.json', await port.capture());
      if (route.transitions.length === 1)
        await port.invoke(checkpoint, path.join(directory, 'target.json'));
      const current = await port.selection();
      const value: Row = {
        format: 'system-public-upgrade-plan-v1',
        installedVersion: previous.version,
        targetVersion: input.target,
        repository: input.repository,
        transitions: route.transitions,
        gitlabPrerequisite: prerequisite,
        requiredIntermediateReleases: route.transitions.slice(0, -1).map((edge) => edge.to),
        targetSha256: sha(raw),
        provenanceSha256: sha(proof),
        selectionSha256: sha(Buffer.from(current.json, 'base64')),
        configurationSha256: current.configurationSha256,
        dataSample: await port.dataSample(),
        baselineSha256: sha(fs.readFileSync(path.join(directory, 'baseline.json'))),
        checkpoint,
        backupDestination: input.backupDestination,
        configurationBackup: backup,
        minimumFreeGiB: required / 1024 ** 3,
        affectedServices: [
          'controller',
          'Sync',
          'Wizard',
          'GitLab',
          'core proxies',
          'runner managers',
        ],
        interruption:
          'Cold matching backup pauses GitLab; controller/Sync and Wizard restart. Core containers, including GitLab, proxies and runner managers, may be recreated when target Compose policies change. This paired phase preserves the already-migrated service/database selections. Any declared GitLab prerequisite must be completed first with its separate cold checkpoint. Wait for running CI jobs first.',
        recovery:
          'Use this command with --operation recover and the same --plan-dir. Paired recovery does not rewind GitLab. For a database-migration transition, use the separate native GitLab cold-checkpoint rollback only after restoring the paired release; never start the old database image on migrated data.',
      };
      json('plan.json', value);
      attempt.phase = 'passed';
      json('preflight.json', attempt);
      return { value, sha256: sha(fs.readFileSync(path.join(directory, 'plan.json'))) };
    } catch (error) {
      attempt.phase = 'failed';
      json('preflight.json', attempt);
      throw error;
    }
  }
}
