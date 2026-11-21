import { Injectable } from '@nestjs/common';
import { BOOTSTRAPPER_CUBE } from '../../cli/presentation';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  HostInstallService,
  requireValue as ensure,
  privateFile,
  writePrivate,
} from '../host/install';
import {
  fileSha,
  canonicalDigest,
  RecoveryManifestService,
  type RecoveryManifest,
} from '../host/recovery-manifest';
import { RecoveryImageService } from '../host/recovery-images';
import {
  RuntimeInspectionService,
  inspectServiceRows,
  runtimeImageSelectors,
  serviceNames,
  runnerCount,
  type RuntimeConfig,
  type ContainerRow,
} from '../host/runtime-inspection';
import { record, imageId, revision } from '../release/source-identity';
import { HostPersistenceService } from '../host-lifecycle/persistence.service';
import { readEnvironment, releaseFallback } from '../host-lifecycle/lifecycle.service';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managed-child';

export interface VerificationOptions {
  operation: 'baseline' | 'check';
  checkout: string;
  persistenceEnv: string;
  output: string;
  baseline?: string;
  timeout?: number;
  tokenFile?: string;
  redirectFrom?: string;
  publicImages?: boolean;
}
export interface RuntimeBaseline {
  schemaVersion: 1;
  startedAt: string;
  configurationFiles: Record<string, string>;
  runnerManagerIdentitySha256: Record<string, string>;
  expectedRunnerCount: number;
  hostToolsRevision: string;
  sourceCommit: string;
  sourceTree: string;
  manifestSha256?: string;
  imageMode?: 'public-images-v1';
  selectedImages?: Record<string, { key: string; reference: string; imageId: string }>;
}
const storageKeys = [
  'PERSISTENCE_MODE',
  'PERSISTENT_MOUNT',
  'PERSISTENT_DIR',
  'PERSISTENT_UUID',
  'SEED_DIR',
  'SEED_MOUNT',
  'SEED_UUID',
];
const sha = (raw: Buffer | string) => crypto.createHash('sha256').update(raw).digest('hex');
const now = () => new Date().toISOString();
export function cube(raw: Buffer): void {
  ensure(
    raw[807] === 36 && raw.subarray(0, 1184).equals(Buffer.from(BOOTSTRAPPER_CUBE, 'ascii')),
    'cube-signature-mismatch',
  );
}
export function serviceOrigin(config: RuntimeConfig, prefix: string): string {
  const host = config[prefix + '_HOST'],
    mode = config[prefix + '_DOMAIN_MODE'];
  ensure(host && !/[/@?#\r\n ]/.test(host), 'invalid-service-host');
  ensure(['0', '1', '2', '3'].includes(mode), 'invalid-domain-mode');
  return (['2', '3'].includes(mode) ? 'https://' : 'http://') + host;
}
function baselineValue(input: unknown): RuntimeBaseline {
  const value = record(input);
  ensure(
    value.schemaVersion === 1 &&
      typeof value.startedAt === 'string' &&
      Number.isFinite(Date.parse(value.startedAt)) &&
      Number.isInteger(value.expectedRunnerCount),
    'invalid-runtime-baseline',
  );
  for (const key of ['sourceCommit', 'sourceTree', 'hostToolsRevision'])
    ensure(revision(value[key]), 'invalid-runtime-baseline');
  for (const key of ['configurationFiles', 'runnerManagerIdentitySha256'])
    ensure(
      Object.values(record(value[key])).every(
        (row) => typeof row === 'string' && /^[a-f0-9]{64}$/.test(row),
      ),
      'invalid-runtime-baseline',
    );
  ensure(
    value.imageMode === 'public-images-v1'
      ? !!record(value.selectedImages)
      : typeof value.manifestSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.manifestSha256),
    'invalid-runtime-baseline',
  );
  return value as unknown as RuntimeBaseline;
}
@Injectable()
export class RuntimeVerificationService {
  constructor(
    readonly host = new HostInstallService(),
    readonly child: LifecycleProcess = new ManagedChildProcess(),
    readonly request: typeof fetch = fetch,
    readonly persistence = new HostPersistenceService(),
  ) {}

  async settings(
    selector: string,
    checkout: string,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<RuntimeConfig> {
    privateFile(selector);
    const selected = await this.persistence.prepare(
      await readEnvironment(this.child, [selector], env, checkout, signal),
      undefined,
      signal,
    );
    const root = fs.realpathSync(selected.PERSISTENT_DIR!),
      main = path.join(root, 'configuration/.docker.env'),
      auth = path.join(root, 'configuration/sync-auth.env');
    ensure(fs.lstatSync(main).isFile(), 'saved-configuration-required');
    const authStat = fs.lstatSync(auth, { throwIfNoEntry: false });
    ensure(!authStat?.isSymbolicLink(), 'sync-auth-must-not-be-symlink');
    const values = await readEnvironment(
      this.child,
      [...(authStat?.isFile() ? [auth] : []), main],
      releaseFallback(path.join(root, 'configuration/.release-images.env'), env),
      checkout,
      signal,
    );
    for (const key of storageKeys) values[key] = selected[key];
    return {
      ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value ?? ''])),
      _root: root,
      _main: main,
    };
  }

  git(checkout: string, ...args: string[]): string {
    return this.host.run('git', ['-C', checkout, ...args]).trim();
  }

  files(config: RuntimeConfig): Record<string, string> {
    const root = config._root,
      projects = path.join(root, 'configuration/.projects.env');
    const files = [
      'configuration/.docker.env',
      'configuration/sync-auth.env',
      ...(fs.existsSync(projects)
        ? fs
            .readdirSync(projects)
            .filter((name) => name.endsWith('.env'))
            .sort()
            .map((name) => 'configuration/.projects.env/' + name)
        : []),
    ];
    return Object.fromEntries(
      files
        .filter((name) => fs.statSync(path.join(root, name), { throwIfNoEntry: false })?.isFile())
        .map((name) => [name, fileSha(path.join(root, name))]),
    );
  }

  manifestAbsent(config: RuntimeConfig): void {
    ensure(
      !fs.lstatSync(path.join(config._root, 'recovery/images.json'), { throwIfNoEntry: false }),
      'public-image-mode-refuses-recovery-manifest',
    );
  }

  services(config: RuntimeConfig, stopped?: string): Record<string, ContainerRow> {
    return inspectServiceRows(
      config,
      JSON.parse(
        this.host.run('docker', [
          '--host=unix:///var/run/docker.sock',
          'inspect',
          ...serviceNames(config),
        ]),
      ),
      stopped,
    );
  }

  publicImages(
    config: RuntimeConfig,
    services: Record<string, ContainerRow>,
  ): NonNullable<RuntimeBaseline['selectedImages']> {
    ensure(
      /^system-bootstrapper-recovery:[a-f0-9]{64}$/.test(config.BOOTSTRAPPER_IMAGE) ||
        /^(?:docker\.io\/)?[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9._-]*@sha256:[a-f0-9]{64}$/.test(
          config.BOOTSTRAPPER_IMAGE,
        ),
      'public-controller-digest-required',
    );
    const images = new RecoveryImageService(this.host),
      result: NonNullable<RuntimeBaseline['selectedImages']> = {};
    const keys: Record<string, string> = {
      system_bootstrapper_1: 'BOOTSTRAPPER_IMAGE',
      system_web_1: 'NGINX_IMAGE',
      system_gitlab_1: 'GITLAB_IMAGE',
      system_wizard_1: 'WIZARD_IMAGE',
    };
    for (const [name, reference] of Object.entries(runtimeImageSelectors(config))) {
      const inspected = images.inspect(reference);
      ensure(
        imageId(inspected.Id) && services[name].Image === inspected.Id,
        'service-image-selection-mismatch',
      );
      if (/^system-bootstrapper-recovery:[a-f0-9]{64}$/.test(reference)) {
        const receipt = path.join(config._root, 'configuration/.release-images.recovered.json');
        privateFile(receipt);
        ensure(fs.statSync(receipt).size <= 16384, 'private-recovered-image-receipt-required');
        const value = record(JSON.parse(fs.readFileSync(receipt, 'utf8')));
        ensure(
          value.format === 'system-public-recovered-images-v1' &&
            value.configurationSha256 === fileSha(config._main),
          'recovered-image-configuration-changed',
        );
        ensure(
          Object.values(record(value.images)).some(
            (row) => record(row).reference === reference && record(row).imageId === inspected.Id,
          ),
          'recovered-image-alias-mismatch',
        );
      }
      if (reference.includes('@sha256:')) {
        const normalize = (value: string) => canonicalDigest(value).replace(/^docker\.io\//, '');
        ensure(
          inspected.RepoDigests?.some((value) => normalize(value) === normalize(reference)),
          'running-image-digest-not-verified',
        );
      }
      result[name] = { key: keys[name] || 'GITLAB_RUNNER_IMAGE', reference, imageId: inspected.Id };
    }
    return result;
  }

  capture(
    config: RuntimeConfig,
    checkout: string,
    publicImages = false,
    stoppedControllerId?: string,
    suppliedManifest?: RecoveryManifest,
  ): RuntimeBaseline {
    cube(fs.readFileSync(config._main));
    ensure(!this.git(checkout, 'status', '--porcelain'), 'initialization-checkout-is-modified');
    const identities: Record<string, string> = {};
    for (let index = 1; index <= runnerCount(config); index++) {
      const file = path.join(config._root, `runners/runner/${index}/config/.runner_system_id`);
      if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) identities[index] = fileSha(file);
    }
    const base = {
      schemaVersion: 1 as const,
      startedAt: now(),
      configurationFiles: this.files(config),
      runnerManagerIdentitySha256: identities,
      expectedRunnerCount: runnerCount(config),
      hostToolsRevision: this.git(checkout, 'rev-parse', 'HEAD'),
    };
    if (publicImages) {
      this.manifestAbsent(config);
      const selectedImages = this.publicImages(config, this.services(config, stoppedControllerId));
      const inspection = record(
        JSON.parse(
          this.host.run('docker', [
            '--host=unix:///var/run/docker.sock',
            'image',
            'inspect',
            selectedImages.system_bootstrapper_1.reference,
          ]),
        )[0],
      );
      const sourceCommit = record(record(inspection.Config).Labels)[
        'org.opencontainers.image.revision'
      ];
      ensure(revision(sourceCommit), 'public-controller-source-label-required');
      const sourceTree = this.git(checkout, 'rev-parse', sourceCommit + '^{tree}');
      ensure(revision(sourceTree), 'public-controller-source-tree-required');
      return {
        ...base,
        imageMode: 'public-images-v1',
        selectedImages,
        sourceCommit: sourceCommit as string,
        sourceTree,
      };
    }
    ensure(!stoppedControllerId, 'stopped-controller-requires-public-baseline');
    const manifests = new RecoveryManifestService(this.host),
      manifest = suppliedManifest ?? manifests.load(path.join(config._root, 'recovery'), checkout);
    manifests.validateSelected(manifest, config._main);
    return {
      ...base,
      manifestSha256: fileSha(path.join(config._root, 'recovery/images.json')),
      sourceCommit: manifest.sourceCommit,
      sourceTree: manifest.sourceTree,
    };
  }

  assertBaseline(config: RuntimeConfig, baseline: RuntimeBaseline): void {
    ensure(
      isDeepStrictEqual(this.files(config), baseline.configurationFiles),
      'saved-configuration-changed',
    );
    if (baseline.imageMode === 'public-images-v1') this.manifestAbsent(config);
    else
      ensure(
        fileSha(path.join(config._root, 'recovery/images.json')) === baseline.manifestSha256,
        'recovery-manifest-changed',
      );
    ensure(runnerCount(config) === baseline.expectedRunnerCount, 'runner-count-changed');
    for (const [index, expected] of Object.entries(baseline.runnerManagerIdentitySha256)) {
      ensure(/^[1-9][0-9]*$/.test(index), 'invalid-runner-identity-index');
      ensure(
        fileSha(path.join(config._root, `runners/runner/${index}/config/.runner_system_id`)) ===
          expected,
        'retained-runner-identity-changed',
      );
    }
    cube(fs.readFileSync(config._main));
  }

  async http(
    url: string,
    signal?: AbortSignal,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: Buffer; headers: Headers }> {
    const response = await this.request(url, {
      method: body === undefined ? 'GET' : 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      redirect: 'manual',
      signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
    });
    const chunks: Buffer[] = [];
    let size = 0;
    if (response.body)
      for await (const chunk of response.body) {
        size += chunk.length;
        ensure(size <= 4 * 1024 ** 2, 'application-response-too-large');
        chunks.push(Buffer.from(chunk));
      }
    return { status: response.status, body: Buffer.concat(chunks), headers: response.headers };
  }

  async sync(config: RuntimeConfig, signal?: AbortSignal): Promise<void> {
    ensure(config.SYNC_ENABLE === 'true', 'authenticated-fetch-requires-enabled-sync');
    const base = serviceOrigin(config, 'SYNC');
    const login = await this.http(base + '/login', signal, {
      username: config.SYNC_USER,
      password: config.SYNC_PASS,
    });
    ensure(login.status === 200, 'sync-login-failed');
    const token = await this.http(base + '/token', signal, {
      token: record(JSON.parse(login.body.toString())).refreshToken,
    });
    ensure(token.status === 200, 'sync-token-failed');
    const access = record(JSON.parse(token.body.toString())).accessToken;
    ensure(typeof access === 'string', 'invalid-sync-access-token');
    const fetched = await this.http(base + '/config/main', signal, undefined, {
      Authorization: 'Bearer ' + access,
    });
    ensure(
      fetched.status === 200 &&
        record(JSON.parse(fetched.body.toString())).data === fs.readFileSync(config._main, 'utf8'),
      'authenticated-fetch-does-not-match-saved-config',
    );
  }

  async managementRoutes(config: RuntimeConfig, signal?: AbortSignal): Promise<void> {
    ensure(
      (await this.http(serviceOrigin(config, 'GITLAB') + '/users/sign_in', signal)).status === 200,
      'gitlab-sign-in-not-ready',
    );
    const ready = record(
      JSON.parse(
        await this.child.run(
          'docker',
          [
            '--host=unix:///var/run/docker.sock',
            'exec',
            'system_gitlab_1',
            'curl',
            '-fsS',
            '--max-time',
            '10',
            'http://127.0.0.1/-/readiness',
          ],
          { cwd: '/', env: this.host.environment, signal, timeout: 15000 },
        ),
      ),
    );
    ensure(ready.status === 'ok', 'gitlab-application-not-ready');
    let registry = serviceOrigin(config, 'GITLAB_REGISTRY');
    if (['0', '1'].includes(config.GITLAB_REGISTRY_DOMAIN_MODE) && !new URL(registry).port)
      registry += ':5050';
    const registryResponse = await this.http(registry + '/v2/', signal);
    ensure(
      registryResponse.status === 401 &&
        registryResponse.headers.get('WWW-Authenticate')?.startsWith('Bearer '),
      'registry-authentication-not-ready',
    );
  }

  async routes(
    config: RuntimeConfig,
    services: Record<string, ContainerRow>,
    redirectFrom?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.managementRoutes(config, signal);
    if (config.WIZARD_ENABLE !== 'true') return;
    const origin = serviceOrigin(config, 'WIZARD'),
      publicResponse = await this.http(origin + '/', signal);
    ensure(publicResponse.status === 200, 'wizard-public-not-ready');
    const networks = record(record(services.system_wizard_1.NetworkSettings).Networks),
      addresses = Object.values(networks)
        .map((value) => record(value).IPAddress)
        .filter((value) => typeof value === 'string' && value);
    ensure(addresses.length, 'wizard-container-network-missing');
    const direct = await this.http('http://' + addresses[0] + '/', signal, undefined, {
      Host: new URL(origin).host,
    });
    ensure(
      direct.status === 200 && direct.body.equals(publicResponse.body),
      'public-host-does-not-route-to-wizard',
    );
    if (redirectFrom) {
      const parsed = new URL(redirectFrom);
      ensure(
        ['http:', 'https:'].includes(parsed.protocol) &&
          !parsed.username &&
          !parsed.password &&
          parsed.pathname === '/' &&
          !parsed.search &&
          !parsed.hash,
        'invalid-redirect-origin',
      );
      const suffix = '/bootstrapper-routing-check?probe=1',
        redirect = await this.http(parsed.origin + suffix, signal);
      ensure(
        [301, 308].includes(redirect.status) &&
          redirect.headers.get('Location') === origin + suffix,
        'canonical-host-redirect-mismatch',
      );
    }
  }

  async runnerContacts(
    config: RuntimeConfig,
    baseline: RuntimeBaseline,
    tokenFile?: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!tokenFile) return { checked: false, reason: 'no-operator-supplied-GitLab-API-token' };
    privateFile(tokenFile);
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    ensure(token, 'GitLab-token-file-is-empty');
    const base = serviceOrigin(config, 'GITLAB') + '/api/v4';
    const pages = async (route: string): Promise<Record<string, unknown>[]> => {
      const result: Record<string, unknown>[] = [];
      for (let page = 1; page <= 100; page++) {
        const response = await this.http(
          base + route + (route.includes('?') ? '&' : '?') + 'per_page=100&page=' + page,
          signal,
          undefined,
          { 'PRIVATE-TOKEN': token },
        );
        ensure(response.status === 200, 'GitLab-runner-API-permission-or-readiness');
        const rows: unknown = JSON.parse(response.body.toString());
        ensure(Array.isArray(rows), 'invalid-GitLab-runner-API-response');
        result.push(...rows.map(record));
        if (!response.headers.get('X-Next-Page')) return result;
      }
      throw Error('GitLab-runner-API-pagination-limit');
    };
    const expected: Record<string, string> = {};
    for (let index = 1; index <= runnerCount(config); index++)
      expected[
        sha(
          fs
            .readFileSync(
              path.join(config._root, `runners/runner/${index}/config/.runner_system_id`),
              'utf8',
            )
            .trim(),
        )
      ] = `runner_docker_${index}`;
    ensure(
      Object.keys(expected).length === runnerCount(config),
      'runner-manager-identities-not-unique',
    );
    const matched = new Set<string>();
    let probes = 0;
    for (const runner of await pages('/runners/all')) {
      ensure(Number.isSafeInteger(runner.id) && Number(runner.id) > 0, 'invalid-GitLab-runner-id');
      const route = '/runners/' + runner.id + '/managers';
      for (let manager of await pages(route)) {
        const identity = sha(String(manager.system_id || ''));
        if (!expected[identity]) continue;
        let contact = Date.parse(String(manager.contacted_at));
        if (
          Number.isFinite(contact) &&
          manager.status === 'online' &&
          contact < Date.parse(baseline.startedAt)
        ) {
          await this.child.run(
            'docker',
            [
              '--host=unix:///var/run/docker.sock',
              'exec',
              expected[identity],
              'gitlab-runner',
              'verify',
              '--config',
              '/etc/gitlab-runner/config.toml',
            ],
            { cwd: '/', env: this.host.environment, signal, timeout: 15000 },
          );
          probes++;
          const refreshed = (await pages(route)).filter(
            (row) => sha(String(row.system_id || '')) === identity,
          );
          ensure(refreshed.length === 1, 'runner-manager-identity-changed-during-probe');
          manager = refreshed[0];
          contact = Date.parse(String(manager.contacted_at));
        }
        ensure(
          Number.isFinite(contact) &&
            manager.status === 'online' &&
            contact >= Date.parse(baseline.startedAt),
          'runner-manager-contact-not-fresh',
        );
        matched.add(identity);
      }
    }
    ensure(matched.size === Object.keys(expected).length, 'expected-runner-managers-not-online');
    return {
      checked: true,
      online: matched.size,
      contactsAfterStart: true,
      authenticationProbeCount: probes,
      jobExecutionChecked: false,
    };
  }

  async verify(
    config: RuntimeConfig,
    baseline: RuntimeBaseline,
    options: VerificationOptions,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    ensure(
      !!options.publicImages === (baseline.imageMode === 'public-images-v1'),
      'runtime-image-mode-mismatch',
    );
    this.assertBaseline(config, baseline);
    ensure(
      this.git(options.checkout, 'rev-parse', 'HEAD') === baseline.hostToolsRevision &&
        !this.git(options.checkout, 'status', '--porcelain'),
      'host-tools-checkout-changed',
    );
    const services = this.services(config),
      inspector = new RuntimeInspectionService(this.host);
    if (options.publicImages)
      ensure(
        isDeepStrictEqual(this.publicImages(config, services), baseline.selectedImages),
        'public-service-image-changed',
      );
    else
      inspector.images(
        config,
        new RecoveryManifestService(this.host).load(
          path.join(config._root, 'recovery'),
          options.checkout,
        ),
        services,
      );
    const mounts = inspector.mounts(config, services);
    await this.routes(config, services, options.redirectFrom, signal);
    await this.sync(config, signal);
    const runners = await this.runnerContacts(config, baseline, options.tokenFile, signal);
    const tls = ['WIZARD', 'SYNC', 'GITLAB', 'GITLAB_REGISTRY'].some((key) =>
      ['2', '3'].includes(config[key + '_DOMAIN_MODE']),
    );
    if (tls) {
      ensure(
        fs.realpathSync('/etc/letsencrypt') === path.join(config._root, 'host/letsencrypt'),
        'certificate-state-is-not-on-volume',
      );
      ensure(
        this.host.run('systemctl', ['is-active', 'certbot.timer']).trim() === 'active',
        'certificate-renewal-timer-inactive',
      );
      ensure(
        !['', 'n/a'].includes(
          this.host
            .run('systemctl', [
              'show',
              'certbot.timer',
              '--property=NextElapseUSecRealtime',
              '--value',
            ])
            .trim(),
        ),
        'certificate-renewal-not-scheduled',
      );
    }
    for (const name of ['.wizard-image-recovery.lock', '.wizard-image-recovery.pending'])
      ensure(
        !fs.lstatSync(path.join(config._root, 'configuration', name), { throwIfNoEntry: false }),
        'private-registry-recovery-cleanup-pending',
      );
    this.assertBaseline(config, baseline);
    const final = this.services(config);
    ensure(
      Object.entries(services).every(
        ([name, row]) =>
          final[name].Id === row.Id &&
          record(final[name].State).StartedAt === record(row.State).StartedAt,
      ),
      'services-replaced-during-verification',
    );
    return {
      passed: true,
      at: now(),
      sourceCommit: baseline.sourceCommit,
      sourceTree: baseline.sourceTree,
      hostToolsRevision: baseline.hostToolsRevision,
      runningCoreServices: Object.keys(services).length,
      persistentMountCount: mounts,
      configurationUnchanged: true,
      authenticatedFetchMatchesSavedBytes: true,
      cubeExact: true,
      runnerManagers: runners,
      renewalTimerChecked: tls,
    };
  }

  async execute(
    options: VerificationOptions,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<void> {
    const timeout = options.timeout ?? 0;
    ensure(
      Number.isInteger(timeout) && timeout >= 0 && timeout <= 3600,
      'invalid-readiness-timeout',
    );
    const output = path.join(
        fs.realpathSync(path.dirname(path.resolve(options.output))),
        path.basename(options.output),
      ),
      checkout = fs.realpathSync(options.checkout);
    ensure(
      output !== checkout && !output.startsWith(checkout + '/'),
      'receipts-must-be-outside-checkout',
    );
    const config = await this.settings(options.persistenceEnv, checkout, env, signal);
    if (options.operation === 'baseline') {
      ensure(!fs.lstatSync(output, { throwIfNoEntry: false }), 'baseline-already-exists');
      writePrivate(
        output,
        Buffer.from(
          JSON.stringify(this.capture(config, checkout, options.publicImages), null, 2) + '\n',
        ),
      );
      return;
    }
    ensure(options.baseline, 'pre-start-baseline-required');
    privateFile(options.baseline);
    const baseline = baselineValue(JSON.parse(fs.readFileSync(options.baseline, 'utf8'))),
      deadline = Date.now() + timeout * 1000;
    const bounded = timeout
      ? AbortSignal.any([AbortSignal.timeout(timeout * 1000), ...(signal ? [signal] : [])])
      : signal;
    const previousDeadline = this.host.deadline;
    if (timeout)
      this.host.deadline =
        previousDeadline === undefined ? deadline : Math.min(previousDeadline, deadline);
    try {
      for (;;) {
        try {
          const result = await this.verify(config, baseline, options, bounded);
          writePrivate(output, Buffer.from(JSON.stringify(result, null, 2) + '\n'));
          return;
        } catch (error) {
          writePrivate(
            output,
            Buffer.from(
              JSON.stringify({
                passed: false,
                at: now(),
                failedCheck:
                  error instanceof Error && /^[A-Za-z0-9:-]+$/.test(error.message)
                    ? error.message
                    : 'runtime-verification-failed',
              }) + '\n',
            ),
          );
          if (Date.now() >= deadline || bounded?.aborted) throw error;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, Math.min(10000, deadline - Date.now()));
            function done() {
              clearTimeout(timer);
              bounded?.removeEventListener('abort', done);
              resolve();
            }
            bounded?.addEventListener('abort', done, { once: true });
          });
        }
      }
    } finally {
      this.host.deadline = previousDeadline;
    }
  }
}
