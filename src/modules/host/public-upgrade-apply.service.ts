import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { record } from '../release/source-identity';
import { requireValue as ensure, privateFile, writePrivate } from './install';
import { UpgradeLifecycleService } from './upgrade-lifecycle.service';
import { releaseInstalledSource } from './recovery-publication.service';
type NativeResult<T> = T | Promise<T>;
type Row = Record<string, unknown>;
export interface PublicUpgradeApplyPort {
  publicInputs(
    repository: string,
    target: string,
  ): NativeResult<{ targetSha256: string; provenanceSha256: string; release: Row }>;
  prerequisite(checkpoint: string): NativeResult<unknown>;
  installed(repository: string, target: string): NativeResult<Row>;
  fingerprints(): NativeResult<{ selectionSha256: string; configurationSha256: string }>;
  assertBaseline(value: Row): NativeResult<void>;
  dataSample(): NativeResult<unknown>;
  host(): NativeResult<void>;
  backupTarget(filename: string): NativeResult<void>;
  invoke(checkOnly: boolean, checkpoint: string, baseline?: Row): NativeResult<void>;
  archive(role: 'controller' | 'wizard', image: Row, source: unknown): NativeResult<unknown>;
  matchingBackup(plan: Row): NativeResult<void>;
  waitReady(baseline: Row): NativeResult<unknown>;
}
export class PublicUpgradeApplyService {
  constructor(
    readonly lifecycle: UpgradeLifecycleService,
    readonly port: PublicUpgradeApplyPort,
  ) {}

  async apply(
    directory: string,
    confirmation: unknown,
    port: PublicUpgradeApplyPort = this.port,
  ): Promise<Row> {
    const plan = this.lifecycle.approvedPlan(directory, confirmation),
      accepted = await port.publicInputs(String(plan.repository), String(plan.targetVersion));
    ensure(
      accepted.targetSha256 === plan.targetSha256 &&
        accepted.provenanceSha256 === plan.provenanceSha256,
      'public-release-changed-after-plan',
    );
    if (plan.gitlabPrerequisite)
      ensure(
        isDeepStrictEqual(
          await port.prerequisite(String(record(plan.gitlabPrerequisite).checkpoint)),
          plan.gitlabPrerequisite,
        ),
        'gitlab-prerequisite-changed-after-plan',
      );
    const previous = await port.installed(String(plan.repository), String(plan.targetVersion)),
      fingerprints = await port.fingerprints();
    const baselinePath = path.join(directory, 'baseline.json');
    privateFile(baselinePath);
    const bytes = fs.readFileSync(baselinePath);
    ensure(
      previous.version === plan.installedVersion &&
        fingerprints.selectionSha256 === plan.selectionSha256 &&
        fingerprints.configurationSha256 === plan.configurationSha256 &&
        crypto.createHash('sha256').update(bytes).digest('hex') === plan.baselineSha256,
      'installation-changed-after-plan',
    );
    const baseline = record(JSON.parse(bytes.toString()));
    await port.assertBaseline(baseline);
    ensure(
      isDeepStrictEqual(await port.dataSample(), plan.dataSample),
      'service-data-sample-changed-after-plan',
    );
    await port.host();
    await port.backupTarget(String(plan.configurationBackup));
    await port.invoke(true, String(plan.checkpoint));
    let state = this.lifecycle.transition(directory, 'retaining-previous-images');
    const journal = async (phase: string, details: unknown = {}) => {
      state = this.lifecycle.transition(directory, phase, details, state.phase);
    };
    const save = (name: string, value: unknown) =>
      writePrivate(path.join(directory, name), Buffer.from(JSON.stringify(value, null, 2) + '\n'));
    try {
      fs.mkdirSync(path.join(directory, 'images'), { mode: 0o700 });
      const source = record(previous.source);
      const identity = releaseInstalledSource({
        sourceRevision: source.revision,
        sourceTree: source.tree,
        sourceLayout: source.sourceLayout,
        wizardSourceTree: source.wizardSourceTree,
        wizardRevision: source.wizardRevision,
      });
      const retained: Row = {};
      for (const role of ['controller', 'wizard'] as const)
        retained[role] = await port.archive(role, record(record(previous.images)[role]), identity);
      save('previous-images.json', retained);
      await journal('backup-starting');
      await port.matchingBackup(plan);
      await journal('backup-services-resuming');
      await port.assertBaseline(baseline);
      save('post-backup-verification.json', await port.waitReady(baseline));
      ensure(
        isDeepStrictEqual(await port.dataSample(), plan.dataSample),
        'service-data-sample-changed-during-backup',
      );
      await journal('paired-update-starting');
      await port.invoke(false, String(plan.checkpoint), baseline);
      ensure(
        isDeepStrictEqual(await port.dataSample(), plan.dataSample),
        'service-data-sample-changed-after-update-inspect-before-acceptance',
      );
      await journal('completed', {
        version: plan.targetVersion,
        sourceRevision: accepted.release.sourceRevision,
        dataSampleVerified: true,
        configurationPreserved: true,
        runnerRegistryOperationalChecks: true,
      });
    } catch (error) {
      await journal('needs-inspection');
      throw error;
    }
    return state;
  }
}
