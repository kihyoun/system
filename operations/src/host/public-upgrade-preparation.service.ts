import { readPrivateInput } from './private-input';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { record } from '../release/source-identity';
import { environmentAssignments } from '../runtime/environment-assignments';
import {
  RuntimeVerificationService,
  serviceOrigin,
} from '../host-bootstrap/runtime-verification.service';
import { HostInstallService, reference, requireValue as ensure } from './install';
import { RuntimeInspectionService, type RuntimeConfig } from './runtime-inspection';
import { HostSourceService } from './source';
import { HostReleaseAuthorityService } from './release-authority.service';
import { PublicReleaseAssetsService } from './public-release-assets.service';
import { semver, upgradePath, validateUpgradeGraph } from './upgrade-graph';
type Row = Record<string, unknown>;
export interface PublicHostFacts {
  release: Record<string, string>;
  architecture: string;
  memoryBytes: number;
}
export class PublicUpgradePreparationService {
  constructor(
    readonly host: HostInstallService,
    readonly runtime: RuntimeVerificationService,
    readonly inspection: RuntimeInspectionService,
    readonly source: HostSourceService,
    readonly authority: HostReleaseAuthorityService,
    readonly assets: PublicReleaseAssetsService,
    readonly hostFacts?: PublicHostFacts,
  ) {}
  graph(checkout: string) {
    return validateUpgradeGraph(
      JSON.parse(fs.readFileSync(path.join(checkout, 'bootstrapper/upgrade-paths.json'), 'utf8')),
    );
  }
  async inputs(repository: string, version: string, checkout: string) {
    const raw = await this.assets.load(
        repository,
        'v' + version,
        'system-release-v' + version + '.json',
      ),
      metadata = record(JSON.parse(raw.toString())),
      source = record(metadata.source);
    ensure(
      metadata.version === version &&
        metadata.tag === 'v' + version &&
        source.repository === `https://github.com/${repository}.git`,
      'selected-public-release-source-mismatch',
    );
    const descriptor = record(metadata.publicUpgrade);
    ensure(typeof descriptor.file === 'string', 'invalid-public-release-location');
    const proof = await this.assets.load(repository, 'v' + version, descriptor.file),
      security = record(
        JSON.parse(fs.readFileSync(path.join(checkout, 'gitlab/security-release.json'), 'utf8')),
      ),
      accepted = this.authority.publicInputs(metadata, proof, security);
    ensure(
      isDeepStrictEqual(accepted.graph, this.graph(checkout)),
      'checkout-and-public-upgrade-metadata-differ',
    );
    return { ...accepted, metadata, security, raw, proofBytes: proof };
  }
  async installed(
    config: RuntimeConfig,
    repository: string,
    checkout: string,
    target?: string,
  ): Promise<Row> {
    ensure(
      !config.BOOTSTRAPPER_IMAGE.startsWith('system-bootstrapper-recovery:') &&
        !config.WIZARD_IMAGE.startsWith('system-bootstrapper-recovery:'),
      'archive-recovered-selectors-repull-original-public-images-and-restore-checkpoint-selectors-see-upgrade-guide',
    );
    const selected = record(
        JSON.parse(
          readPrivateInput(
            path.join(config._root, 'configuration/.release-images.json'),
          ).toString(),
        ),
      ),
      version = record(selected.productRelease).version;
    ensure(
      typeof version === 'string' && semver.test(version),
      'unknown-installation-release-use-source-build-or-recovery-guide',
    );
    if (target !== undefined) {
      const route = upgradePath(this.graph(checkout), version, target);
      ensure(
        route.status === 'supported',
        'upgrade-selection-' + route.status + '-see-public-upgrade-guide',
      );
    }
    const metadata = record(
        JSON.parse(
          (
            await this.assets.load(
              repository,
              'v' + version,
              'system-release-v' + version + '.json',
            )
          ).toString(),
        ),
      ),
      source = record(metadata.source),
      images = record(metadata.images),
      acceptance = record(metadata.acceptance);
    ensure(
      metadata.version === version &&
        source.repository === `https://github.com/${repository}.git` &&
        [
          ['sourceCommit', 'revision'],
          ['sourceTree', 'tree'],
          ['wizardSourceRevision', 'wizardRevision'],
          ['sourceLayout', 'sourceLayout'],
          ['wizardSourceTree', 'wizardSourceTree'],
        ].every(([key, field]) => selected[key] === source[field]),
      'installed-source-does-not-match-official-release',
    );
    this.source.verifyObjects(
      {
        sourceRevision: source.revision,
        sourceTree: source.tree,
        ...(source.sourceLayout
          ? { sourceLayout: source.sourceLayout, wizardSourceTree: source.wizardSourceTree }
          : { wizardRevision: source.wizardRevision }),
      },
      checkout,
    );
    const profile = readPrivateInput(path.join(config._root, 'configuration/.release-images.env'));
    ensure(
      profile.equals(
        Buffer.from(
          'BOOTSTRAPPER_IMAGE=' +
            reference(String(record(images.controller).reference)) +
            '\nWIZARD_IMAGE=' +
            reference(String(record(images.wizard).reference)) +
            '\n',
        ),
      ),
      'modified-or-incomplete-official-release-profile',
    );
    const services = this.inspection.inspect(config);
    this.inspection.mounts(config, services);
    this.runtime.publicImages(config, services);
    for (const [role, key, name] of [
      ['controller', 'BOOTSTRAPPER_IMAGE', 'system_bootstrapper_1'],
      ['wizard', 'WIZARD_IMAGE', 'system_wizard_1'],
    ]) {
      const expected = record(images[role]),
        retained = record(record(selected.images)[role]);
      ensure(
        reference(config[key]) === reference(String(expected.reference)) &&
          reference(String(retained.reference)) === reference(String(expected.reference)) &&
          retained.imageId === services[name].Image,
        'modified-or-inconsistent-official-image-selection',
      );
      ensure(
        services[name].Image === expected.imageId,
        'official-upgrade-requires-recorded-runtime-image-id-see-source-recovery-guide',
      );
      const rows: unknown = JSON.parse(
        this.host.run('docker', [
          '--host=unix:///var/run/docker.sock',
          'image',
          'inspect',
          config[key],
        ]),
      );
      ensure(Array.isArray(rows) && rows.length === 1, 'unexpected-image-inspection');
      const image = record(rows[0]),
        labels = record(record(image.Config).Labels);
      ensure(
        image.Id === expected.imageId &&
          labels['org.opencontainers.image.revision'] ===
            source[
              role === 'controller' || source.sourceLayout === 'system-monorepo-v1'
                ? 'revision'
                : 'wizardRevision'
            ] &&
          labels['org.system-bootstrapper.test-job'] === String(acceptance.candidateJobId) &&
          (role !== 'wizard' ||
            labels['org.system-bootstrapper.source-revision'] === source.revision),
        'installed-official-image-labels-mismatch',
      );
    }
    return metadata;
  }
  verifyHost(metadataValue: unknown, facts: PublicHostFacts | undefined = this.hostFacts): void {
    const metadata = record(metadataValue),
      compatibility = record(metadata.compatibility);
    if (!facts) {
      const match = /^MemTotal:\s+(\d+) kB$/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
      ensure(match, 'host-memory-unavailable');
      facts = {
        release: environmentAssignments(fs.readFileSync('/etc/os-release', 'utf8')),
        architecture: process.arch,
        memoryBytes: Number(match[1]) * 1024,
      };
    }
    ensure(
      facts.release.ID === 'ubuntu' &&
        Array.isArray(compatibility.versions) &&
        compatibility.versions.includes(facts.release.VERSION_ID) &&
        facts.architecture === 'x64' &&
        metadata.platform === 'linux/amd64',
      'supported-Ubuntu-amd64-host-required',
    );
    const minimum = compatibility.minimumMemoryGiB ?? 8;
    ensure(
      typeof minimum === 'number' && Number.isFinite(minimum) && minimum > 0,
      'invalid-upgrade-memory-requirement',
    );
    ensure(
      Number.isFinite(facts.memoryBytes) &&
        facts.memoryBytes >= minimum * 1024 ** 3 - 512 * 1024 ** 2,
      'insufficient-upgrade-memory',
    );
  }
  async syncIdle(config: RuntimeConfig): Promise<void> {
    const base = serviceOrigin(config, 'SYNC'),
      login = await this.runtime.http(base + '/login', undefined, {
        username: config.SYNC_USER,
        password: config.SYNC_PASS,
      });
    ensure(login.status === 200, 'controller-promotion-sync-authentication-failed');
    const token = record(JSON.parse(login.body.toString())).accessToken;
    ensure(typeof token === 'string', 'controller-promotion-sync-token-missing');
    const status = await this.runtime.http(base + '/status', undefined, undefined, {
      Authorization: 'Bearer ' + token,
    });
    ensure(status.status === 200, 'controller-promotion-sync-status-unavailable');
    const value = record(JSON.parse(status.body.toString()));
    ensure(
      Object.hasOwn(value, 'projectOperationInProgress'),
      'controller-promotion-versioned-quiescence-bridge-required',
    );
    ensure(
      [
        'projectOperationInProgress',
        'runnerSetupInProgress',
        'harvestInProgress',
        'defaultWizardSetupInProgress',
        'needRestart',
      ].every((key) => value[key] === false),
      'controller-promotion-operation-is-busy',
    );
  }
}
