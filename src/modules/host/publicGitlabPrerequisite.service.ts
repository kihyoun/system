import { checkoutConfiguration } from '../../common/runtime/checkoutLayout';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  HostInstallService,
  HostPolicyError,
  requireValue as ensure,
  writePrivate,
} from './install';
import { ProcessFailure } from '../../common/runtime/process';
import { RuntimeVerificationService } from '../host-bootstrap/runtimeVerification.service';
import { PublicUpgradePreparationService } from './publicUpgradePreparation.service';
import { HostReleaseAuthorityService } from './releaseAuthority.service';
import { RuntimeInspectionService, type RuntimeConfig } from './runtimeInspection';
import { HostSourceService } from './source';
import { readPrivateInput } from './privateInput';
import { bytesSha, directoryBarrier } from './releaseSelection.service';
import { record } from '../release/sourceIdentity';
import { isGitLabPrerequisite } from './upgradePrerequisite.service';
import { upgradePath } from './upgradeGraph';
import type { PublicPrerequisiteExecution } from '../gitlab-upgrade/types';
import { upgradeStatus } from '../gitlab-upgrade/status';
import { upgradeCommandFailureCodes } from '../gitlab-upgrade/commandFailurePolicy';

type Row = Record<string, unknown>;
const helperFailureCodes = Object.fromEntries(
  [
    ...upgradeCommandFailureCodes,
    'upgrade-readiness-timeout',
    'upgrade-readiness-timeout-restarting',
    'upgrade-readiness-timeout-http',
    'upgrade-readiness-timeout-jobs',
    'upgrade-readiness-timeout-background-migrations',
    'upgrade-readiness-timeout-database-migrations',
    'upgrade-readiness-response-invalid',
    'upgrade-jobs-active',
    'upgrade-pending-migrations',
    'upgrade-migration-status-invalid',
    'upgrade-preflight-refused',
    'upgrade-preflight-identity-mismatch',
    'upgrade-current-image-mismatch',
    'upgrade-service-state-invalid',
    'upgrade-service-oom',
    'upgrade-service-dead',
    'upgrade-service-exited',
    'upgrade-operation-failed',
    'upgrade-running-gitlab-required',
    'upgrade-persistent-mount-mismatch',
    'upgrade-owned-gitlab-required',
    'gitlab-preflight-container-identity-required',
    'gitlab-preflight-package-identity-invalid',
    'gitlab-database-topology-invalid',
    'gitlab-database-container-identity-required',
    'gitlab-preflight-service-user-invalid',
    'gitlab-preflight-private-directory-invalid',
    'gitlab-database-session-invalid',
    'gitlab-database-session-options-invalid',
    'gitlab-database-application-name-invalid',
    'project-proxy-runtime-identity-required',
    'project-proxy-runtime-address-required',
  ].map((code) => ['System Bootstrapper: ' + code, code]),
);
const helperFailureValues = new Set(Object.values(helperFailureCodes));
export function prerequisiteMountTarget(destination: unknown): void {
  ensure(
    typeof destination === 'string' &&
      path.posix.isAbsolute(destination) &&
      path.posix.normalize(destination) === destination &&
      !['/system', '/usr/local/bin/node'].some(
        (target) =>
          target === destination || target.startsWith(destination.replace(/\/$/, '') + '/'),
      ),
    'public-gitlab-helper-runtime-overlay-refused',
  );
}
export interface PublicGitlabInput {
  operation: 'prepare' | 'plan' | 'promote' | 'status' | 'abort' | 'rollback';
  checkout: string;
  persistenceEnv: string;
  directory: string;
  repository: string;
  target?: string;
  confirmation?: string;
  pairedCheckpoint?: string;
  timeout: number;
  signal?: AbortSignal;
}
export function prerequisiteController(row: Row): PublicPrerequisiteExecution['controller'] {
  const config = record(row.Config),
    host = record(row.HostConfig);
  ensure(
    typeof row.Id === 'string' &&
      /^[a-f0-9]{64}$/.test(row.Id) &&
      typeof row.Image === 'string' &&
      /^sha256:[a-f0-9]{64}$/.test(row.Image) &&
      row.Name === '/system_bootstrapper_1' &&
      record(row.State).Running === true &&
      record(config.Labels)['com.docker.compose.project'] === 'system' &&
      record(config.Labels)['com.docker.compose.service'] === 'bootstrapper' &&
      Array.isArray(row.Mounts),
    'public-gitlab-owned-running-controller-required',
  );
  return {
    Id: row.Id,
    Image: row.Image,
    Mounts: row.Mounts,
    restartPolicy: record(host.RestartPolicy),
    labels: record(config.Labels),
  };
}
export function prerequisiteDirectory(config: RuntimeConfig, directory: string): string {
  const boundary = path.join(config._root, 'configuration/gitlab-prerequisites');
  ensure(
    path.isAbsolute(directory) &&
      path.dirname(directory) === boundary &&
      /^[a-z0-9][a-z0-9-]{0,79}$/.test(path.basename(directory)) &&
      fs.realpathSync(config._root) === config._root,
    'public-gitlab-preparation-directory-required',
  );
  return directory;
}
/** An explicit completed paired recovery is the only authority to replace the original controller identity. */
export function pairedPrerequisiteRecovery(
  retained: Row,
  current: Row,
  checkpoint: string,
  main: string,
): void {
  const root = String(retained.root),
    original = record(retained.controller),
    previous = record(record(record(retained.previous).images).controller),
    source = record(record(retained.metadata).source);
  ensure(
    path.isAbsolute(checkpoint) &&
      path.dirname(checkpoint) === path.join(root, 'recovery/controller-updates') &&
      fs.realpathSync(checkpoint) === checkpoint,
    'public-gitlab-completed-paired-recovery-required',
  );
  const read = (name: string) =>
      record(JSON.parse(readPrivateInput(path.join(checkpoint, name)).toString())),
    operation = read('operation.json'),
    verification = read('rollback-verification.json'),
    baseline = read('baseline-before.json'),
    before = readPrivateInput(path.join(checkpoint, 'main-before.env')),
    restored = record(operation.previousController),
    identity = prerequisiteController(current);
  ensure(
    operation.format === 'system-public-controller-update-v1' &&
      operation.phase === 'rolled-back' &&
      operation.databaseRewound === false &&
      record(operation.release).sourceRevision === source.revision &&
      restored.imageId === previous.imageId &&
      current.Image === previous.imageId &&
      operation.configurationBeforeSha256 === bytesSha(before) &&
      record(record(baseline.selectedImages).system_bootstrapper_1).imageId === previous.imageId &&
      verification.passed === true &&
      verification.configurationUnchanged === true &&
      verification.cubeExact === true &&
      verification.authenticatedFetchMatchesSavedBytes === true &&
      isDeepStrictEqual(identity.Mounts, original.Mounts) &&
      isDeepStrictEqual(identity.restartPolicy, original.restartPolicy) &&
      isDeepStrictEqual(identity.restartPolicy, restored.restartPolicy),
    'public-gitlab-completed-paired-recovery-required',
  );
  const expected = operation.recoveredConfigurationSha256 ?? operation.configurationBeforeSha256;
  ensure(
    bytesSha(readPrivateInput(main)) === expected,
    'public-gitlab-paired-recovery-configuration-changed',
  );
}
export class PublicGitlabPrerequisiteService {
  constructor(
    readonly host: HostInstallService,
    readonly runtime: RuntimeVerificationService,
    readonly preparation: PublicUpgradePreparationService,
    readonly authority: HostReleaseAuthorityService,
    readonly inspection: RuntimeInspectionService,
    readonly source: HostSourceService,
  ) {}

  docker(args: string[], timeout = 180000) {
    return this.host.run(
      'docker',
      ['--host=unix:///var/run/docker.sock', ...args],
      undefined,
      timeout,
    );
  }

  inspect(name: string): Row {
    const rows: unknown = JSON.parse(this.docker(['inspect', name]));
    ensure(Array.isArray(rows) && rows.length === 1, 'public-gitlab-container-inspection-required');
    return record(rows[0]);
  }

  async execute(input: PublicGitlabInput): Promise<Row> {
    ensure(this.host.rootUser(), 'public-gitlab-requires-root');
    ensure(
      ['prepare', 'plan', 'promote', 'status', 'abort', 'rollback'].includes(input.operation) &&
        Number.isInteger(input.timeout) &&
        input.timeout >= 60 &&
        input.timeout <= 1800,
      'public-gitlab-operation-invalid',
    );
    for (const value of [input.checkout, input.persistenceEnv, input.directory]) {
      ensure(path.isAbsolute(value), 'absolute-public-gitlab-input-required');
    }
    const config = await this.runtime.settings(
        input.persistenceEnv,
        input.checkout,
        this.host.environment,
        input.signal,
      ),
      directory = prerequisiteDirectory(config, input.directory);

    if (input.operation === 'prepare') {
      return this.prepare(input, config, directory);
    }

    ensure(fs.realpathSync(directory) === directory, 'public-gitlab-preparation-symlink-refused');
    const preparationBytes = readPrivateInput(path.join(directory, 'preparation.json')),
      retained = record(JSON.parse(preparationBytes.toString())),
      metadata = record(retained.metadata),
      previous = record(retained.previous),
      proof = Buffer.from(String(retained.proof), 'base64'),
      security = JSON.parse(
        fs.readFileSync(
          checkoutConfiguration(input.checkout, 'gitlab', 'security-release.json'),
          'utf8',
        ),
      ),
      accepted = this.authority.publicInputs(metadata, proof, security);
    ensure(
      retained.format === 'system-public-gitlab-prerequisite-v1' &&
        retained.root === config._root &&
        retained.directory === directory &&
        retained.timeout === input.timeout &&
        retained.repository === input.repository &&
        (!input.target || input.target === metadata.version),
      'public-gitlab-retained-input-mismatch',
    );

    if (input.operation === 'status') {
      return {
        ...upgradeStatus(String(retained.checkpointDir), path.join(config._root, 'configuration')),
        checkpointDir: retained.checkpointDir,
      };
    }

    this.source.verifyCheckout(accepted.release, input.checkout);
    const controller = this.inspect('system_bootstrapper_1');

    if (!isDeepStrictEqual(prerequisiteController(controller), retained.controller)) {
      ensure(
        input.operation === 'rollback' && input.pairedCheckpoint,
        'public-gitlab-original-controller-changed',
      );
      pairedPrerequisiteRecovery(retained, controller, input.pairedCheckpoint, config._main);
    } else {
      ensure(!input.pairedCheckpoint, 'public-gitlab-paired-checkpoint-not-required');
    }

    ensure(
      controller.Image === record(record(previous.images).controller).imageId,
      'public-gitlab-installed-controller-mismatch',
    );

    if (['plan', 'promote'].includes(input.operation)) {
      const installed = await this.preparation.installed(
        config,
        input.repository,
        input.checkout,
        String(metadata.version),
      );
      ensure(isDeepStrictEqual(installed, previous), 'public-gitlab-installed-release-changed');
      this.preparation.verifyHost(metadata);
    }

    const sha = bytesSha(preparationBytes),
      nonce = crypto.randomBytes(16).toString('hex'),
      launch = path.join(directory, 'launch-' + nonce + '.json'),
      innerDirectory = '/state/gitlab-prerequisites/' + path.basename(directory),
      name = 'system-gitlab-prerequisite-' + nonce,
      image = String(record(record(metadata.images).controller).imageId),
      args = [
        'create',
        '--pull',
        'never',
        '--name',
        name,
        '--restart',
        'no',
        '--pid',
        'host',
        '--network',
        'container:' + controller.Id,
        '--label',
        'system.gitlab.prerequisite=' + sha,
        '--entrypoint',
        'node',
      ];
    // Clone only the already verified controller mounts. In particular, preparation
    // does not attach a Seed medium or invent a backup destination.
    for (const item of controller.Mounts as unknown[]) {
      const mount = record(item);
      prerequisiteMountTarget(mount.Destination);
      ensure(
        ['bind', 'volume'].includes(String(mount.Type)) &&
          ![mount.Source, mount.Name, mount.Destination].some(
            (value) => typeof value === 'string' && /[,\r\n\0]/.test(value),
          ),
        'public-gitlab-controller-mount-invalid',
      );
      args.push(
        '--mount',
        'type=' +
          mount.Type +
          ',src=' +
          (mount.Type === 'volume' ? mount.Name : mount.Source) +
          ',dst=' +
          mount.Destination +
          (mount.RW === true ? '' : ',readonly'),
      );
    }

    if (input.pairedCheckpoint) {
      ensure(!/[,\r\n\0]/.test(input.pairedCheckpoint), 'public-gitlab-paired-checkpoint-invalid');
      args.push(
        '--mount',
        'type=bind,src=' + input.pairedCheckpoint + ',dst=' + input.pairedCheckpoint + ',readonly',
      );
    }

    // Existing controller environment is private Docker metadata. It is passed
    // through a private file rather than putting secret values in command arguments.
    const environmentFile = path.join(directory, 'helper.env');
    const values = record(controller.Config).Env;
    ensure(
      Array.isArray(values) &&
        values.every((value) => typeof value === 'string' && !/\0/.test(value)),
      'public-gitlab-controller-environment-invalid',
    );
    const allowed =
      /^(?:PERSISTENCE_MODE|PERSISTENT_(?:DIR|MOUNT|UUID)|SEED_(?:DIR|MOUNT|UUID)|GITLAB_[A-Z0-9_]+|NGINX_IMAGE|WIZARD_IMAGE|SYSTEM_(?:WIZARD_ENVIRONMENT_IMAGE|LOG_MAX_SIZE|LOG_MAX_FILES|PUBLIC_UPGRADE_FIXTURE))=/;
    const selected = values.filter((value) => allowed.test(String(value))),
      omnibus = selected.filter((value) => String(value).startsWith('GITLAB_OMNIBUS_CONFIG=')),
      lines = selected.filter((value) => !String(value).startsWith('GITLAB_OMNIBUS_CONFIG=')),
      environment = { ...this.host.environment };
    ensure(
      omnibus.length <= 1 && lines.every((value) => !/[\r\n]/.test(String(value))),
      'public-gitlab-controller-environment-invalid',
    );

    // Docker's env-file format has no multiline values. Inherit this one named
    // value from the private process environment, preserving operator Omnibus
    // configuration without exposing its contents in argv or interpreting it.
    if (omnibus.length) {
      environment.GITLAB_OMNIBUS_CONFIG = String(omnibus[0]).slice('GITLAB_OMNIBUS_CONFIG='.length);
      args.push('--env', 'GITLAB_OMNIBUS_CONFIG');
    }

    writePrivate(environmentFile, Buffer.from(lines.join('\n') + '\n'));
    args.push(
      '--env-file',
      environmentFile,
      image,
      '/system/dist/cli/main.js',
      'public-gitlab-prerequisite-helper',
      innerDirectory + '/preparation.json',
      innerDirectory + '/' + path.basename(launch),
      input.operation,
      input.confirmation || '',
    );
    const id = this.host
      .run('docker', ['--host=unix:///var/run/docker.sock', ...args], environment, 180000)
      .trim();
    ensure(/^[a-f0-9]{64}$/.test(id), 'public-gitlab-helper-create-uncertain');
    writePrivate(
      launch,
      Buffer.from(
        JSON.stringify({
          containerId: id,
          preparationSha256: sha,
          controller: prerequisiteController(controller),
          ...(input.pairedCheckpoint ? { pairedCheckpoint: input.pairedCheckpoint } : {}),
        }),
      ),
    );
    let output: string;
    try {
      output = await this.runtime.child.run(
        'docker',
        ['--host=unix:///var/run/docker.sock', 'start', '--attach', id],
        {
          cwd: input.checkout,
          env: this.host.environment,
          signal: input.signal,
          // The owned copy watchdogs and service readiness enforce their own budgets.
          // Do not terminate the foreground migration/restore attachment during cold I/O.
          timeout: ['promote', 'rollback'].includes(input.operation)
            ? null
            : (input.timeout * 2 + 2400) * 1000,
          controlledFailureCodes: helperFailureCodes,
        },
      );
    } catch (error) {
      if (
        error instanceof ProcessFailure &&
        error.binary === 'docker' &&
        !error.uncertain &&
        error.signal === null &&
        Number.isInteger(error.status) &&
        error.status !== null &&
        error.status > 0 &&
        error.status <= 255 &&
        error.controlledCode !== undefined &&
        helperFailureValues.has(error.controlledCode)
      ) {
        const observed = this.inspect(id),
          state = record(observed.State);
        ensure(
          observed.Id === id &&
            observed.Image === image &&
            record(record(observed.Config).Labels)['system.gitlab.prerequisite'] === sha &&
            state.Status === 'exited' &&
            state.Running === false &&
            state.ExitCode === error.status &&
            state.OOMKilled !== true &&
            state.Dead !== true &&
            state.Paused !== true &&
            state.Restarting !== true,
          'public-gitlab-helper-outcome-uncertain',
        );
        // Keep the failed helper, launch record and checkpoint available for recovery.
        throw new HostPolicyError(error.controlledCode);
      }

      throw error;
    }
    const observed = this.inspect(id);
    ensure(
      observed.Id === id &&
        observed.Image === image &&
        record(record(observed.Config).Labels)['system.gitlab.prerequisite'] === sha &&
        record(observed.State).Running === false &&
        record(observed.State).ExitCode === 0,
      'public-gitlab-helper-outcome-uncertain',
    );
    const result = record(JSON.parse(output.trim().split('\n').at(-1)!));
    ensure(
      isDeepStrictEqual(
        prerequisiteController(this.inspect('system_bootstrapper_1')),
        prerequisiteController(controller),
      ),
      'public-gitlab-original-controller-changed',
    );
    this.docker(['rm', id]);
    return { ...result, checkpointDir: retained.checkpointDir };
  }

  async prepare(input: PublicGitlabInput, config: RuntimeConfig, directory: string): Promise<Row> {
    ensure(input.target, 'public-gitlab-target-required');
    const accepted = await this.preparation.inputs(input.repository, input.target, input.checkout);
    this.source.verifyCheckout(accepted.release, input.checkout);
    const previous = await this.preparation.installed(
        config,
        input.repository,
        input.checkout,
        input.target,
      ),
      route = upgradePath(accepted.graph, String(previous.version), input.target);
    ensure(
      route.status === 'supported' &&
        route.transitions.some(
          (edge) => edge.databaseMigration && isGitLabPrerequisite(edge.gitlabPrerequisite),
        ),
      'public-gitlab-prerequisite-not-declared',
    );
    this.preparation.verifyHost(accepted.metadata);
    await this.preparation.syncIdle(config);
    const controller = this.inspect('system_bootstrapper_1');
    this.inspection.mounts(config, this.inspection.inspect(config));
    const security = record(accepted.security),
      runner = record(security.runner),
      images = record(accepted.metadata.images),
      checkpointDir = path.join(
        config._root,
        'configuration/gitlab-upgrades/public-' + path.basename(directory),
      );
    // All recovery payloads must be present before downtime; helper invocations
    // use image IDs and cannot download a missing runtime during recovery.
    for (const reference of [
      record(images.controller).reference,
      security.fromImage,
      security.toImage,
      runner.fromImage,
      runner.toImage,
      runner.fromHelperImage,
      runner.helperImage,
    ]) {
      this.docker(['pull', String(reference)], 900000);
    }
    for (const [reference, expected] of [
      [record(images.controller).reference, record(images.controller).imageId],
    ]) {
      const rows = JSON.parse(this.docker(['image', 'inspect', String(reference)]));
      ensure(
        Array.isArray(rows) && rows.length === 1 && record(rows[0]).Id === expected,
        'public-gitlab-target-image-mismatch',
      );
    }
    fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
    ensure(
      fs.realpathSync(path.dirname(directory)) === path.dirname(directory),
      'public-gitlab-preparation-symlink-refused',
    );
    fs.mkdirSync(directory, { mode: 0o700 });
    directoryBarrier(path.dirname(directory));
    const retained = {
      format: 'system-public-gitlab-prerequisite-v1',
      root: config._root,
      directory,
      repository: input.repository,
      timeout: input.timeout,
      checkpointDir,
      metadata: accepted.metadata,
      proof: accepted.proofBytes.toString('base64'),
      previous,
      controller: prerequisiteController(controller),
    };
    writePrivate(path.join(directory, 'preparation.json'), Buffer.from(JSON.stringify(retained)));
    return { status: 'prepared', directory, checkpointDir };
  }
}
