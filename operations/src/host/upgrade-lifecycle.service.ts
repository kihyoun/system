import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { record, revision } from '../release/source-identity';
import { privateFile, writePrivate, requireValue as ensure } from './install';
const format = 'system-public-upgrade-operation-v1';
const phases = [
  'retaining-previous-images',
  'backup-starting',
  'backup-services-resuming',
  'paired-update-starting',
  'completed',
];
const sha = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
/** Durable state decisions shared by CLI and compatibility callers under the coordinator lease. */
export class UpgradeLifecycleService {
  private read(directory: string, name: string): Buffer {
    ensure(
      path.isAbsolute(directory) && fs.realpathSync(directory) === directory,
      'retained-public-upgrade-directory-required',
    );
    const file = path.join(directory, name);
    privateFile(file);
    ensure(fs.statSync(file).size <= 64 * 1024 ** 2, 'bounded-upgrade-journal-required');
    return fs.readFileSync(file);
  }
  interrupt(directory: string): Record<string, unknown> | null {
    if (!fs.existsSync(path.join(directory, 'operation.json'))) return null;
    const previous = record(JSON.parse(this.read(directory, 'operation.json').toString()));
    if (['completed', 'rolled-back', 'needs-inspection'].includes(String(previous.phase)))
      return previous;
    return this.transition(directory, 'needs-inspection', {}, previous.phase);
  }
  approvedPlan(directory: string, confirmation: unknown): Record<string, unknown> {
    const bytes = this.read(directory, 'plan.json');
    ensure(confirmation === sha(bytes), 'explicit-matching-plan-SHA256-confirmation-required');
    const plan = record(JSON.parse(bytes.toString()));
    ensure(plan.format === 'system-public-upgrade-plan-v1', 'invalid-public-upgrade-plan');
    ensure(
      Array.isArray(plan.transitions) && plan.transitions.length === 1,
      'apply-required-intermediate-release-first-see-plan',
    );
    const edge = record(plan.transitions[0]);
    if (edge.databaseMigration === true)
      ensure(
        record(plan.gitlabPrerequisite).checkpoint,
        'complete-native-gitlab-upgrade-first-and-select-retained-checkpoint',
      );
    ensure(
      !fs.existsSync(path.join(directory, 'operation.json')),
      'upgrade-already-started-use-status-or-recover',
    );
    return plan;
  }
  transition(
    directory: string,
    phase: unknown,
    details: unknown = {},
    expectedPhase?: unknown,
  ): Record<string, unknown> {
    ensure(
      typeof phase === 'string' &&
        (phases.includes(phase) || phase === 'needs-inspection' || phase === 'rolled-back'),
      'invalid-public-upgrade-phase',
    );
    ensure(
      path.isAbsolute(directory) && fs.realpathSync(directory) === directory,
      'retained-public-upgrade-directory-required',
    );
    const file = path.join(directory, 'operation.json');
    const previous = fs.existsSync(file)
      ? record(JSON.parse(this.read(directory, 'operation.json').toString()))
      : undefined;
    if (previous)
      ensure(
        previous.format === format && previous.phase === expectedPhase,
        'public-upgrade-phase-changed',
      );
    else
      ensure(
        expectedPhase === undefined && phase === phases[0],
        'invalid-public-upgrade-phase-order',
      );
    if (previous) {
      const index = phases.indexOf(String(previous.phase));
      ensure(
        phase === 'rolled-back' ||
          (phase === 'needs-inspection' &&
            previous.phase !== 'completed' &&
            previous.phase !== 'rolled-back') ||
          (index >= 0 && phase === phases[index + 1]),
        'invalid-public-upgrade-phase-order',
      );
    }
    const extra = record(details),
      now = new Date().toISOString();
    let value: Record<string, unknown> = {
      ...previous,
      format,
      phase,
      ...(!previous ? { startedAt: now } : {}),
    };
    if (phase === 'completed') {
      ensure(
        revision(extra.sourceRevision) &&
          typeof extra.version === 'string' &&
          /^\d+\.\d+\.\d+$/.test(extra.version),
        'completed-public-upgrade-identity-required',
      );
      ensure(
        extra.dataSampleVerified === true &&
          extra.configurationPreserved === true &&
          extra.runnerRegistryOperationalChecks === true,
        'completed-public-upgrade-verification-required',
      );
      value = {
        ...value,
        version: extra.version,
        sourceRevision: extra.sourceRevision,
        databaseMigration: false,
        dataSampleVerified: true,
        configurationPreserved: true,
        runnerRegistryOperationalChecks: true,
        completedAt: now,
      };
    }
    if (phase === 'rolled-back') {
      ensure(
        extra.databaseRewound === false &&
          extra.recoveryImageSelectors === true &&
          typeof extra.restoredVersion === 'string' &&
          typeof extra.originalConfiguration === 'string',
        'paired-recovery-verification-required',
      );
      value = {
        ...value,
        databaseRewound: false,
        recoveryImageSelectors: true,
        restoredVersion: extra.restoredVersion,
        originalConfiguration: extra.originalConfiguration,
        completedAt: now,
      };
    }
    writePrivate(file, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
    return value;
  }
}
