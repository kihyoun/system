import { assertOperationActive } from './operation-cancellation';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { GitlabPreflightService } from '../gitlab-preflight/gitlab-preflight.service';
import {
  RuntimeVerificationService,
  type RuntimeBaseline,
} from '../host-bootstrap/runtime-verification.service';
import { HostInstallService, HostPolicyError, requireValue as ensure } from './install';
import { ControllerLeaseService } from './controller-lease.service';
import { PublicUpgradePreparationService } from './public-upgrade-preparation.service';
import {
  RuntimeInspectionService,
  failedStoppedController,
  type RuntimeConfig,
  type ContainerRow,
} from './runtime-inspection';
import { bytesSha } from './release-selection.service';
import { record } from '../release/source-identity';

type Row = Record<string, unknown>;
export interface PairedRuntimeInput {
  signal?: AbortSignal;
  checkout: string;
  persistenceEnv: string;
  tokenFile: string;
  timeout: number;
  redirectFrom?: string;
}
export function ownedCore(value: Row, service: string): void {
  const labels = record(record(value.Config).Labels);
  ensure(
    labels['com.docker.compose.project'] === 'system' &&
      labels['com.docker.compose.service'] === service,
    'owned-core-container-required',
  );
}
export function unchangedPairedServices(
  services: Record<string, ContainerRow>,
  baseline: Row,
  controllerOptional = false,
  wizardOptional = false,
): void {
  const expected = record(baseline.selectedImages),
    required = Object.keys(expected).filter(
      (name) =>
        !(controllerOptional && name === 'system_bootstrapper_1') &&
        !(wizardOptional && name === 'system_wizard_1'),
    );
  ensure(
    required.every((name) => name in services) &&
      Object.keys(services).every((name) => name in expected),
    'controller-update-service-set-changed',
  );
  for (const [name, value] of Object.entries(expected))
    if (name !== 'system_bootstrapper_1' && !(wizardOptional && name === 'system_wizard_1'))
      ensure(
        services[name]?.Image === record(value).imageId,
        'controller-update-service-image-changed',
      );
}
export function repairPeers(services: Record<string, ContainerRow>): void {
  for (const [name, row] of Object.entries(services)) {
    if (name === 'system_bootstrapper_1') continue;
    if (name.startsWith('runner_docker_')) {
      const labels = record(record(row.Config).Labels);
      ensure(
        labels['com.docker.compose.project'] === 'runner' &&
          labels['com.docker.compose.service'] === name.slice(7),
        'owned-runner-container-required',
      );
    } else ownedCore(row, name.split('_')[1]);
    const state = record(row.State);
    ensure(
      state.Running === true &&
        !['Paused', 'Restarting', 'Dead', 'OOMKilled'].some((key) => state[key]),
      'repair-peer-service-not-running',
    );
    ensure(
      !state.Health || record(state.Health).Status === 'healthy',
      'repair-peer-service-not-healthy',
    );
    ensure(
      'ExecIDs' in row &&
        (row.ExecIDs === null || (Array.isArray(row.ExecIDs) && row.ExecIDs.length === 0)),
      'repair-peer-active-or-unknown-execs',
    );
  }
}
export function verifyRunnerContainers(
  services: Record<string, ContainerRow>,
  expected: unknown,
): void {
  ensure(
    isDeepStrictEqual(
      Object.fromEntries(
        Object.entries(services)
          .filter(([name]) => name.startsWith('runner_docker_'))
          .map(([name, row]) => [name, row.Id]),
      ),
      expected,
    ),
    'repair-runner-containers-changed',
  );
}
export class PairedRuntimeService {
  constructor(
    readonly host: HostInstallService,
    readonly runtime: RuntimeVerificationService,
    readonly inspection: RuntimeInspectionService,
    readonly lease: ControllerLeaseService,
    readonly preflight: GitlabPreflightService,
    readonly preparation: PublicUpgradePreparationService,
  ) {}
  context(input: PairedRuntimeInput, initial: RuntimeConfig) {
    const service = this;
    let config = initial,
      held = false;
    const inspect = async (name: string): Promise<ContainerRow> => {
      const rows: unknown = JSON.parse(await docker(['inspect', name]));
      ensure(Array.isArray(rows) && rows.length === 1, 'exact-container-inspection-required');
      return record(rows[0]) as ContainerRow;
    };
    const environment = (reference: string): NodeJS.ProcessEnv => {
      const env: NodeJS.ProcessEnv = {
        ...service.host.environment,
        ...config,
        DOCKER_HOST: 'unix:///var/run/docker.sock',
        BOOTSTRAPPER_IMAGE: reference,
        SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER: '1',
        PERSISTENT_DIR: config._root,
      };
      for (const key of [
        'DOCKER_CONTEXT',
        'DOCKER_TLS_VERIFY',
        'DOCKER_CERT_PATH',
        '_root',
        '_main',
        '_persistence_env',
      ])
        delete env[key];
      return env;
    };
    const docker = async (
      args: string[],
      timeout = 300,
      stdin = '',
      reference?: string,
    ): Promise<string> => {
      assertOperationActive(input.signal);
      const argv = ['--host=unix:///var/run/docker.sock', ...args];
      if (held) {
        const output = await service.lease.command(
          ['docker', ...argv],
          timeout,
          Buffer.from(stdin),
          reference ? environment(reference) : undefined,
        );
        assertOperationActive(input.signal);
        return output.toString();
      }
      // Pre-lease probes are read-only; stdin is used for bounded private native DB connection files.
      const env: NodeJS.ProcessEnv = {
        ...service.host.environment,
        DOCKER_HOST: 'unix:///var/run/docker.sock',
      };
      for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'])
        delete env[key];
      if (service.host.deadline !== undefined) {
        ensure(
          Number.isFinite(service.host.deadline) && service.host.deadline > Date.now(),
          'operation-readiness-deadline-expired',
        );
        timeout = Math.min(timeout, (service.host.deadline - Date.now()) / 1000);
      }
      try {
        const result = service.host.runner.run('docker', argv, {
          timeout: Math.max(1, Math.floor(timeout * 1000)),
          maxBuffer: 4 * 1024 ** 2,
          env,
          input: stdin,
        });
        ensure(result.status === 0, 'command-failed:docker');
        return String(result.stdout);
      } catch {
        throw new HostPolicyError('command-failed:docker');
      }
    };
    const services = (stoppedId?: string) => service.runtime.services(config, stoppedId);
    const stoppedIdle = () => {
      ensure(held, 'stopped-repair-requires-owned-lease');
      const locks = [
        path.join(config._root, 'configuration/.gitlab-upgrade-lock'),
        path.join(config._root, 'configuration/.storage-operation-lock'),
        path.join(config._root, 'host/letsencrypt/.system-bootstrapper-certificate-lock'),
        path.join(config._root, 'configuration/.projects.env/.wizard.env.environments.lock'),
        ...(config.SEED_DIR ? [path.join(config.SEED_DIR, '.operation-lock')] : []),
      ];
      const owned = new Set(service.lease.describe().held);
      for (const filename of locks) {
        if (owned.has(filename)) service.lease.assertIdle(filename);
        else
          ensure(
            !fs.lstatSync(filename, { throwIfNoEntry: false }),
            'unfinished-operation-blocks-stopped-repair',
          );
      }
      for (const relative of [
        'gitlab/data/.system-bootstrapper-restore-incomplete',
        'configuration/.wizard-image-recovery.lock',
        'configuration/.wizard-image-recovery.pending',
        'configuration/preview-setup.json.lock',
      ])
        ensure(
          !fs.lstatSync(path.join(config._root, relative), { throwIfNoEntry: false }),
          'unfinished-operation-blocks-stopped-repair',
        );
    };
    const repairBaseline = async (baseline: Row, rows: Record<string, ContainerRow>) => {
      stoppedIdle();
      service.runtime.assertBaseline(config, baseline as unknown as RuntimeBaseline);
      ensure(
        isDeepStrictEqual(service.runtime.publicImages(config, rows), baseline.selectedImages),
        'controller-update-images-changed-before-stop',
      );
      await service.runtime.managementRoutes(config);
    };
    const waitReady = async (baseline: Row): Promise<Row> => {
      const previous = service.host.deadline,
        deadline = Math.min(Date.now() + input.timeout * 1000, previous ?? Infinity);
      service.host.deadline = deadline;
      let last: string | undefined;
      try {
        while (last === undefined || Date.now() < deadline) {
          assertOperationActive(input.signal);
          try {
            const receipt = await service.runtime.verify(
              config,
              baseline as unknown as RuntimeBaseline,
              {
                operation: 'check',
                checkout: input.checkout,
                persistenceEnv: input.persistenceEnv,
                output: '',
                tokenFile: input.tokenFile,
                redirectFrom: input.redirectFrom,
                publicImages: true,
              },
            );
            ensure(
              record(receipt.runnerManagers).checked,
              'controller-update-runner-contact-proof-required',
            );
            assertOperationActive(input.signal);
            return receipt;
          } catch (error) {
            assertOperationActive(input.signal);
            const label =
                error instanceof HostPolicyError ? error.code : 'unexpected-readiness-error',
              remaining = deadline - Date.now();
            const deadlineTransport =
              remaining <= 0 &&
              [
                'application-endpoint-not-ready',
                'command-failed:git',
                'command-failed:docker',
                'command-failed:findmnt',
                'command-failed:systemctl',
              ].includes(label);
            if (!last || (label !== 'operation-readiness-deadline-expired' && !deadlineTransport))
              last = label;
            if (remaining > 0)
              await new Promise((resolve) => setTimeout(resolve, Math.min(3000, remaining)));
          }
        }
        throw new HostPolicyError('controller-update-readiness-failed:' + last);
      } finally {
        service.host.deadline = previous;
      }
    };
    const context = {
      get config() {
        return config;
      },
      input,
      inspect,
      docker,
      services,
      environment,
      stoppedIdle,
      repairBaseline,
      waitReady,
      acquire(operation?: string) {
        assertOperationActive(input.signal);
        ensure(!held, 'paired-operation-already-held');
        const value = { root: config._root, seedDirectory: config.SEED_DIR || undefined };
        if (operation) service.lease.adopt(value, operation);
        else service.lease.acquire(value);
        held = true;
      },
      finish(failed: boolean) {
        try {
          if (held) service.lease.finish(failed);
        } finally {
          held = false;
        }
      },
      operation: () => service.lease.operation,
      critical() {
        service.lease.critical = true;
      },
      async reload() {
        config = await service.runtime.settings(
          input.persistenceEnv,
          input.checkout,
          service.host.environment,
        );
      },
      async current(evidence: Row, security: Row, stoppedId?: string) {
        const rows = services(stoppedId);
        service.inspection.mounts(config, rows);
        service.runtime.publicImages(config, rows);
        ownedCore(rows.system_bootstrapper_1, 'bootstrapper');
        const upgrade = record(record(evidence.evidence).gitlabUpgrade);
        ensure(
          rows.system_gitlab_1.Image === upgrade.toImageId,
          'controller-update-requires-current-GitLab-image',
        );
        for (const [name, row] of Object.entries(rows))
          if (name.startsWith('runner_docker_'))
            ensure(
              row.Image === upgrade.runnerImageId,
              'controller-update-requires-current-runner-image',
            );
        const proof = await service.preflight.probe(String(rows.system_gitlab_1.Id), {
          command: (args, timeout, input) => docker(args, timeout, input),
        });
        ensure(
          proof.version === security.toVersion &&
            proof.edition === 'CE' &&
            proof.runningJobs === 0 &&
            proof.unfinishedBackgroundMigrations === 0,
          'current-GitLab-version-jobs-or-migrations-block-update',
        );
        if (stoppedId) {
          failedStoppedController(rows.system_bootstrapper_1, stoppedId);
          repairPeers(rows);
        }
        return rows;
      },
      async rollbackServices(baseline: Row, state: Row) {
        const present: Record<string, boolean> = {};
        for (const name of [
          'system_bootstrapper_1',
          ...(state.wizard ? ['system_wizard_1'] : []),
        ]) {
          const output = (
            await docker([
              'container',
              'ls',
              '--all',
              '--filter',
              'name=^/' + name + '$',
              '--format',
              '{{.Names}}',
            ])
          ).trim();
          ensure(output === '' || output === name, 'controller-rollback-ambiguous-controller');
          present[name] = !!output;
        }
        const rows: Record<string, ContainerRow> = {};
        for (const name of Object.keys(record(baseline.selectedImages)))
          if (present[name] !== false) rows[name] = await inspect(name);
        unchangedPairedServices(rows, baseline, true, !!state.wizard);
        service.inspection.mounts(config, rows);
        for (const [name, role, key] of [
          ['system_bootstrapper_1', 'bootstrapper', 'Controller'],
          ...(state.wizard ? [['system_wizard_1', 'wizard', 'Wizard']] : []),
        ])
          if (rows[name]) {
            ownedCore(rows[name], role);
            ensure(
              [
                record(state['previous' + key]).imageId,
                record(state[key.toLowerCase()]).imageId,
              ].includes(rows[name].Image),
              'controller-rollback-refuses-unrelated-controller',
            );
          }
        return rows;
      },
      pairedBaseline(baseline: Row, state: Row) {
        if (state.wizard) {
          const current = structuredClone(baseline);
          record(current.configurationFiles)['configuration/.docker.env'] = bytesSha(
            fs.readFileSync(config._main),
          );
          service.runtime.assertBaseline(config, current as unknown as RuntimeBaseline);
        }
      },
      async restoreStopped(baseline: Row, state: Row) {
        const previous = record(state.previousController);
        ensure(
          record(previous.restartPolicy).Name === 'no',
          'stopped-rollback-requires-original-no-restart',
        );
        const args = [
          'compose',
          '--compatibility',
          '-p',
          'system',
          '-f',
          path.join(input.checkout, 'system/docker-compose.yml'),
        ];
        await docker(
          [...args, 'create', '--force-recreate', '--no-build', '--pull', 'never', 'bootstrapper'],
          300,
          '',
          String(previous.reference),
        );
        const row = await inspect('system_bootstrapper_1');
        ownedCore(row, 'bootstrapper');
        const status = record(row.State);
        ensure(
          row.Image === previous.imageId &&
            status.Status === 'created' &&
            status.Pid === 0 &&
            status.Running === false,
          'stopped-rollback-controller-was-started-or-changed',
        );
        await docker(['update', '--restart=no', String(row.Id)]);
        if (state.wizard)
          await docker(
            [...args, 'up', '--no-build', '--no-deps', '--pull', 'never', '-d', 'wizard'],
            300,
            '',
            String(previous.reference),
          );
        const rows = services(String(row.Id));
        failedStoppedController(rows.system_bootstrapper_1, row.Id);
        repairPeers(rows);
        verifyRunnerContainers(rows, state.previousRunnerContainerIds);
        unchangedPairedServices(rows, baseline);
        service.inspection.mounts(config, rows);
        await repairBaseline(baseline, rows);
        return {
          passed: true,
          at: new Date().toISOString(),
          controllerStopped: true,
          controllerId: row.Id,
          controllerImageId: previous.imageId,
          controllerStatus: 'created',
          syncAvailable: false,
          wizardPublicRouteChecked: false,
          configurationUnchanged: true,
          runnerContainerIds: state.previousRunnerContainerIds,
          runnerManagerIdentitySha256: baseline.runnerManagerIdentitySha256,
          runnerContactFreshnessChecked: false,
        };
      },
    };
    return context;
  }
}
export type PairedRuntimeContext = ReturnType<PairedRuntimeService['context']>;
