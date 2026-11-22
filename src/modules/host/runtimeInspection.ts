import fs from 'node:fs';
import { canonicalDigest, declaredImage, type RecoveryManifest } from './recoveryManifest';
import { RecoveryImageService } from './recoveryImages';
import path from 'node:path';
import { HostInstallService, requireValue as ensure } from './install';
import { record } from '../release/sourceIdentity';
export type RuntimeConfig = Record<string, string>;
export type ContainerRow = Record<string, unknown>;
export function runnerCount(config: RuntimeConfig): number {
  ensure(
    /^\d+$/.test(config.GITLAB_RUNNER_SCALE) && Number(config.GITLAB_RUNNER_SCALE) <= 50,
    'invalid-runner-count',
  );
  return Number(config.GITLAB_RUNNER_SCALE);
}
export function serviceNames(config: RuntimeConfig): string[] {
  return [
    'system_bootstrapper_1',
    'system_web_1',
    'system_gitlab_1',
    ...(config.WIZARD_ENABLE === 'true' ? ['system_wizard_1'] : []),
    ...Array.from({ length: runnerCount(config) }, (_, i) => `runner_docker_${i + 1}`),
  ];
}
export function failedStoppedController(row: ContainerRow, expectedId: unknown): void {
  const state = record(row.State),
    policy = record(record(row.HostConfig).RestartPolicy);
  ensure(
    typeof expectedId === 'string' &&
      expectedId.length > 0 &&
      row.Name === '/system_bootstrapper_1' &&
      row.Id === expectedId,
    'stopped-controller-identity-mismatch',
  );
  const exited =
    state.Status === 'exited' &&
    Number.isInteger(state.ExitCode) &&
    Number(state.ExitCode) > 0 &&
    Number(state.ExitCode) < 128;
  const created = state.Status === 'created' && state.ExitCode === 0;
  ensure(
    (exited || created) &&
      state.Pid === 0 &&
      ['Running', 'Paused', 'Restarting', 'Dead', 'OOMKilled'].every((key) => state[key] === false),
    'controller-is-not-quiescent-stopped-failure',
  );
  ensure(
    'ExecIDs' in row &&
      (row.ExecIDs === null || (Array.isArray(row.ExecIDs) && row.ExecIDs.length === 0)),
    'stopped-controller-active-or-unknown-execs',
  );
  ensure(
    policy.Name === 'no' && (policy.MaximumRetryCount ?? 0) === 0,
    'stopped-controller-restart-policy-must-be-no',
  );
}
export function inspectServiceRows(
  config: RuntimeConfig,
  value: unknown,
  stoppedId?: string,
): Record<string, ContainerRow> {
  const names = serviceNames(config);
  ensure(Array.isArray(value), 'expected-services-missing');
  const rows = value.map(record),
    actual = rows.map((row) => String(row.Name).replace(/^\//, ''));
  ensure(
    actual.length === names.length &&
      new Set(actual).size === names.length &&
      names.every((name) => actual.includes(name)),
    'expected-services-missing',
  );
  for (const row of rows) {
    if (stoppedId !== undefined && row.Name === '/system_bootstrapper_1') {
      failedStoppedController(row, stoppedId);
      continue;
    }

    const state = record(row.State);
    ensure(state.Running === true && !state.OOMKilled, 'service-not-running');

    if (state.Health) {
      ensure(record(state.Health).Status === 'healthy', 'service-not-healthy');
    }
  }
  return Object.fromEntries(rows.map((row, i) => [actual[i], row]));
}
export function runtimeImageSelectors(config: RuntimeConfig): Record<string, string> {
  const selected: Record<string, string> = {
    system_bootstrapper_1: config.BOOTSTRAPPER_IMAGE || 'system_bootstrapper',
    system_web_1: config.NGINX_IMAGE || 'nginx',
    system_gitlab_1: config.GITLAB_IMAGE,
  };
  for (let i = 1; i <= runnerCount(config); i++) {
    selected[`runner_docker_${i}`] = config.GITLAB_RUNNER_IMAGE;
  }

  if (config.WIZARD_ENABLE === 'true') {
    selected.system_wizard_1 = config.WIZARD_IMAGE;
  }

  return selected;
}
export function verifyImageInspections(
  config: RuntimeConfig,
  manifest: RecoveryManifest,
  services: Record<string, ContainerRow>,
  inspections: Record<string, { Id: string; RepoDigests?: string[] }>,
): void {
  const selected = runtimeImageSelectors(config),
    expected: Record<string, string> = {
      system_bootstrapper_1: manifest.currentController.imageId,
    };
  for (const [name, reference] of Object.entries(selected)) {
    if (name === 'system_bootstrapper_1') {
      continue;
    }

    ensure(reference, 'saved-image-selection-required');
    const inspected = inspections[reference];
    ensure(inspected, 'saved-image-inspection-required');
    expected[name] = inspected.Id;

    if (reference.includes('@sha256:')) {
      ensure(
        inspected.RepoDigests?.includes(canonicalDigest(reference)),
        'running-image-digest-not-verified',
      );
    }
  }
  for (const [key, fallback] of [
    ['BOOTSTRAPPER_IMAGE', 'system_bootstrapper'],
    ['NGINX_IMAGE', 'nginx'],
    ['GITLAB_IMAGE', ''],
    ['GITLAB_RUNNER_IMAGE', ''],
  ]) {
    const reference = config[key] || fallback,
      match = declaredImage(manifest, reference);
    ensure(match, 'saved-image-is-not-declared-in-manifest');
    ensure(inspections[reference], 'saved-image-inspection-required');

    if (match.imageId) {
      ensure(inspections[reference].Id === match.imageId, 'image-alias-retargeted');
    }
  }
  for (const [name, id] of Object.entries(expected)) {
    ensure(services[name]?.Image === id, 'service-image-selection-mismatch');
  }
}
const docker = ['--host=unix:///var/run/docker.sock'];
const within = (root: string, target: string) =>
  target === root || target.startsWith(root + path.sep);
export class RuntimeInspectionService {
  constructor(readonly host = new HostInstallService()) {}

  inspect(config: RuntimeConfig, stoppedId?: string): Record<string, ContainerRow> {
    return inspectServiceRows(
      config,
      JSON.parse(this.host.run('docker', [...docker, 'inspect', ...serviceNames(config)])),
      stoppedId,
    );
  }

  images(
    config: RuntimeConfig,
    manifest: RecoveryManifest,
    services: Record<string, ContainerRow>,
  ): void {
    const images = new RecoveryImageService(this.host),
      selectors = new Set([
        ...Object.values(runtimeImageSelectors(config)),
        config.GITLAB_RUNNER_IMAGE,
      ]);
    verifyImageInspections(
      config,
      manifest,
      services,
      Object.fromEntries(
        [...selectors].map((reference) => {
          ensure(reference, 'saved-image-selection-required');
          return [reference, images.inspect(reference)];
        }),
      ),
    );
  }

  mounts(config: RuntimeConfig, services: Record<string, ContainerRow>): number {
    const root = fs.realpathSync(config._root),
      mount = fs.realpathSync(config.PERSISTENT_MOUNT);
    const device = (p: string) =>
        this.host.run('findmnt', ['-rn', '-T', p, '-o', 'MAJ:MIN']).trim(),
      selectedDevice = device(mount);
    ensure(selectedDevice.length > 0, 'persistent-mount-device-missing');
    const required: Record<string, Record<string, string | null>> = {
      system_bootstrapper_1: {
        '/var/run/docker.sock': null,
        '/state': 'configuration',
        '/wizard-public': 'wizard-public',
        '/host-letsencrypt': 'host/letsencrypt',
        [path.join(root, 'runners')]: 'runners',
        '/templates': 'templates',
        '/synctemplates': 'synctemplates',
        '/ssl': 'ssl',
        '/srv/gitlab/config': 'gitlab/config',
        '/srv/gitlab/log': 'gitlab/logs',
        '/srv/gitlab/data': 'gitlab/data',
      },
      system_web_1: { '/etc/nginx/templates': 'templates', '/ssl': 'ssl' },
      system_gitlab_1: {
        '/etc/gitlab': 'gitlab/config',
        '/var/log/gitlab': 'gitlab/logs',
        '/var/opt/gitlab': 'gitlab/data',
      },
    };

    if (config.WIZARD_ENABLE === 'true') {
      required.system_wizard_1 = { '/usr/share/nginx/wizard-public': 'wizard-public' };
    }

    for (let i = 1; i <= runnerCount(config); i++) {
      required[`runner_docker_${i}`] = {
        '/var/run/docker.sock': null,
        '/etc/gitlab-runner': `runners/runner/${i}/config`,
        '/home/gitlab-runner': `runners/runner/${i}/home`,
      };
    }
    const volumes = new Map<string, Record<string, unknown>>();
    let count = 0;
    for (const [name, row] of Object.entries(services)) {
      ensure(Array.isArray(row.Mounts), 'essential-persistent-mount-missing');
      const entries = row.Mounts.map(record),
        destinations = entries.map((entry) => String(entry.Destination));
      ensure(
        new Set(destinations).size === destinations.length,
        'duplicate-service-mount-destination',
      );
      ensure(
        Object.keys(required[name] ?? {}).every((destination) =>
          destinations.includes(destination),
        ),
        'essential-persistent-mount-missing',
      );
      for (const entry of entries) {
        const destination = String(entry.Destination);

        if (destination === '/var/run/docker.sock') {
          ensure(
            entry.Type === 'bind' &&
              fs.realpathSync(String(entry.Source)) === fs.realpathSync('/var/run/docker.sock') &&
              entry.RW === true,
            'service-Docker-socket-mismatch',
          );
          continue;
        }

        if (entry.Type === 'tmpfs') {
          ensure(!(destination in (required[name] ?? {})), 'essential-data-mounted-as-tmpfs');
          continue;
        }

        let source = String(entry.Source);

        if (entry.Name) {
          const volumeName = String(entry.Name);

          if (!volumes.has(volumeName)) {
            const rows: unknown = JSON.parse(
              this.host.run('docker', [...docker, 'volume', 'inspect', volumeName]),
            );
            ensure(Array.isArray(rows) && rows.length === 1, 'invalid-volume-inspection');
            volumes.set(volumeName, record(rows[0]));
          }

          const options = record(volumes.get(volumeName)!.Options ?? {});
          ensure(options.type === 'none' && options.o === 'bind', 'persistent-volume-not-bind');
          source = String(options.device ?? '');
        }

        ensure(source.length > 0, 'persistent-mount-escapes-selected-data');
        const target = fs.realpathSync(source),
          expected = required[name]?.[destination];
        ensure(
          expected == null || target === fs.realpathSync(path.join(root, expected)),
          'essential-persistent-mount-is-misdirected',
        );

        if (destination === '/seed') {
          ensure(
            (config.PERSISTENCE_MODE ?? 'volume') === 'volume' && config.SEED_DIR,
            'backup-medium-must-not-be-a-permanent-service-mount',
          );
          const seed = fs.realpathSync(config.SEED_DIR);
          ensure(
            target === seed &&
              seed !== mount &&
              within(mount, seed) &&
              !within(root, seed) &&
              !within(seed, root),
            'legacy-seed-mount-is-misdirected',
          );
          ensure(device(target) === selectedDevice, 'legacy-seed-mount-is-on-another-filesystem');
        } else {
          ensure(within(root, target), 'persistent-mount-escapes-selected-data');
          ensure(device(target) === selectedDevice, 'persistent-mount-is-on-another-filesystem');
        }

        count++;
      }
    }
    ensure(count > 0, 'persistent-mounts-missing');
    return count;
  }
}
