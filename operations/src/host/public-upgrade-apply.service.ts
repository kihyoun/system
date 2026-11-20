import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { record } from '../release/source-identity';
import { requireValue as ensure, privateFile, writePrivate } from './install';
import { UpgradeLifecycleService } from './upgrade-lifecycle.service';
import { releaseInstalledSource } from './recovery-publication.service';
type Row = Record<string, unknown>;
export interface PublicUpgradeApplyPort {
  publicInputs(
    repository: string,
    target: string,
  ): { targetSha256: string; provenanceSha256: string; release: Row };
  prerequisite(checkpoint: string): unknown;
  installed(repository: string, target: string): Row;
  fingerprints(): { selectionSha256: string; configurationSha256: string };
  assertBaseline(value: Row): void;
  dataSample(): unknown;
  host(): void;
  backupTarget(filename: string): void;
  invoke(checkOnly: boolean, checkpoint: string, baseline?: Row): void;
  archive(role: 'controller' | 'wizard', image: Row, source: unknown): unknown;
  matchingBackup(plan: Row): void;
  waitReady(baseline: Row): unknown;
}
export class PublicUpgradeApplyService {
  constructor(
    readonly lifecycle: UpgradeLifecycleService,
    readonly port: PublicUpgradeApplyPort,
  ) {}
  apply(directory: string, confirmation: unknown): Row {
    const plan = this.lifecycle.approvedPlan(directory, confirmation),
      accepted = this.port.publicInputs(String(plan.repository), String(plan.targetVersion));
    ensure(
      accepted.targetSha256 === plan.targetSha256 &&
        accepted.provenanceSha256 === plan.provenanceSha256,
      'public-release-changed-after-plan',
    );
    if (plan.gitlabPrerequisite)
      ensure(
        isDeepStrictEqual(
          this.port.prerequisite(String(record(plan.gitlabPrerequisite).checkpoint)),
          plan.gitlabPrerequisite,
        ),
        'gitlab-prerequisite-changed-after-plan',
      );
    const previous = this.port.installed(String(plan.repository), String(plan.targetVersion)),
      fingerprints = this.port.fingerprints();
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
    this.port.assertBaseline(baseline);
    ensure(
      isDeepStrictEqual(this.port.dataSample(), plan.dataSample),
      'service-data-sample-changed-after-plan',
    );
    this.port.host();
    this.port.backupTarget(String(plan.configurationBackup));
    this.port.invoke(true, String(plan.checkpoint));
    let state = this.lifecycle.transition(directory, 'retaining-previous-images');
    const journal = (phase: string, details: unknown = {}) => {
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
        retained[role] = this.port.archive(role, record(record(previous.images)[role]), identity);
      save('previous-images.json', retained);
      journal('backup-starting');
      this.port.matchingBackup(plan);
      journal('backup-services-resuming');
      this.port.assertBaseline(baseline);
      save('post-backup-verification.json', this.port.waitReady(baseline));
      ensure(
        isDeepStrictEqual(this.port.dataSample(), plan.dataSample),
        'service-data-sample-changed-during-backup',
      );
      journal('paired-update-starting');
      this.port.invoke(false, String(plan.checkpoint), baseline);
      ensure(
        isDeepStrictEqual(this.port.dataSample(), plan.dataSample),
        'service-data-sample-changed-after-update-inspect-before-acceptance',
      );
      journal('completed', {
        version: plan.targetVersion,
        sourceRevision: accepted.release.sourceRevision,
        dataSampleVerified: true,
        configurationPreserved: true,
        runnerRegistryOperationalChecks: true,
      });
    } catch (error) {
      journal('needs-inspection');
      throw error;
    }
    return state;
  }
}
