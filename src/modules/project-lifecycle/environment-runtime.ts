import { configurationLogo } from '../../common/configuration-signature';
import * as builds from './build-recipe.service';
import * as environments from './environment-recipe.service';
import * as betaBinding from './system-beta-binding';
import * as reviewBinding from './legacy-review-binding';
import { reservation } from './source-primary-environment';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as state from './state';
import * as lifecycle from './entry';
import {
  DeploymentRequest,
  DeploymentRecord,
  DeploymentSlot,
  EnvironmentKind,
  EnvironmentSetting,
} from './types';
import { EnvironmentReservation, Recipe, Workflow } from './upgrade-types';
import { EnvironmentProcess, EnvironmentCommandOptions } from './environment-process';
import {
  RuntimeContext,
  EnvironmentInspection,
  SystemBinding,
  ImageRow,
} from './environment-types';
const sourceRoot = path.resolve(__dirname, '../../..');
const ROOT = '/templates/wizard-environments';
function canonicalLogo() {
  const logo = configurationLogo;
  if (
    !logo ||
    logo[807] !== '$' ||
    crypto.createHash('md5').update(logo.slice(0, 1184)).digest('hex') !==
      'bd4a8426355824593a5e21ad759830c1'
  )
    throw new Error('Immutable helper signature source changed.');
  return logo;
}
export function canonicalRecipe(environment: EnvironmentReservation): Recipe {
  const recipe = environments.generate(canonicalLogo(), environment);
  if (recipe.recipeHash !== environment.recipeHash)
    throw new Error('Immutable helper recipe identity changed.');
  return recipe;
}
export function canonicalLegacyRecipe(recipeHash?: string): Recipe {
  const recipes = builds;
  try {
    return recipeHash
      ? recipes.select(canonicalLogo(), recipeHash)
      : recipes.generate(canonicalLogo());
  } catch (_) {
    throw new Error('Canonical managed build recipe identity changed.');
  }
}
export function parse(args: string[]) {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !/^--[a-z]+$/.test(args[i] || '') ||
      args[i + 1] === undefined ||
      values[args[i].slice(2)] !== undefined
    )
      throw new Error('Invalid helper arguments.');
    values[args[i].slice(2)] = args[i + 1];
  }
  const system = values.delivery === 'system';
  if (
    values.controller !== 'system_bootstrapper_1' ||
    Object.keys(values).length !== (system ? 10 : 9) ||
    (values.delivery !== undefined && !system) ||
    (system && values.kind !== 'beta' && !(values.kind === 'review' && values.action === 'stop'))
  )
    throw new Error('Original controller is required.');
  return state.validRequest({
    action: values.action,
    kind: values.kind,
    projectId: Number(values.project),
    pipelineId: Number(values.pipeline),
    jobId: Number(values.job),
    sourceCommit: values.sha,
    mrIid: Number(values.mr),
    operation: values.operation,
    ...(system ? { delivery: 'system' } : {}),
  });
}
export class Runtime extends EnvironmentProcess {
  request: DeploymentRequest;
  token: string;
  helperName: string;
  root: string;
  context!: RuntimeContext;
  environment!: EnvironmentReservation & {
    ciFiles?: unknown;
    deployments: Partial<Record<EnvironmentKind, DeploymentSlot>>;
  };
  setting!: EnvironmentSetting;

  constructor(request: DeploymentRequest, options: { root?: string } = {}) {
    super();
    this.request = request;
    this.token = crypto.randomBytes(24).toString('hex');
    this.helperName = 'wizard-environment-' + request.projectId + '-' + request.jobId;
    this.root = options.root || ROOT;
  }

  async json<T>(args: string[], input?: string, options?: EnvironmentCommandOptions): Promise<T> {
    try {
      return JSON.parse(await this.command(args, input, options));
    } catch (_) {
      throw new Error('Canonical environment operation failed; inspect the recorded reservation.');
    }
  }

  async canonical<T = { ok?: boolean; contentHash: string }>(
    action: string,
    extra: Record<string, unknown> = {},
    cleanup = false,
  ): Promise<T> {
    const result = await this.json<T & { ok?: boolean }>(
      [
        'exec',
        '-i',
        'system_bootstrapper_1',
        'node',
        '/system/dist/cli/main.js',
        'project-environments-canonical',
      ],
      JSON.stringify({
        action,
        payload: {
          operation: this.request.operation,
          token: this.token,
          helper: this.helperName,
          ...extra,
        },
      }),
      { timeout: 20000, cleanup, release: action === 'unlock' },
    );
    if (result.ok === false)
      throw new Error(
        'Canonical environment check failed; reconcile the reservation or held lock.',
      );
    return result;
  }

  async save(deployments: Partial<Record<EnvironmentKind, DeploymentSlot>>, cleanup = false) {
    const result = await this.canonical(
      'cas',
      { expectedHash: this.context.contentHash, deployments },
      cleanup,
    );
    this.context.contentHash = result.contentHash;
    this.environment.deployments = deployments;
  }

  async inspected(
    name: string,
    type = 'container',
    cleanup = false,
  ): Promise<EnvironmentInspection | null> {
    const format =
      type === 'network'
        ? '{"labels":{{json .Labels}},"containers":{{json .Containers}}}'
        : '{"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"image":{{json .Image}},"networks":{{json .NetworkSettings.Networks}}}';
    const listing = await this.command(
      type === 'network'
        ? ['network', 'ls', '--filter', 'name=^' + name + '$', '--format', '{{.Name}}']
        : [
            'container',
            'ls',
            '--all',
            '--filter',
            'name=^/' + name + '$',
            '--format',
            '{{.Names}}',
          ],
      '',
      { timeout: 15000, cleanup },
    );
    if (!listing) return null;
    if (listing !== name) throw new Error('Ambiguous owned resource identity.');
    return this.json([type, 'inspect', '--format', format, name], '', { timeout: 15000, cleanup });
  }

  async owned(value: DeploymentRecord, cleanup = false) {
    const data = await this.inspected(value.containerName, 'container', cleanup);
    if (!data) return null;
    for (const [key, expected] of Object.entries(state.labels(value))) {
      if (data.labels?.[key] !== expected)
        throw new Error('Candidate container ownership changed.');
    }
    return data;
  }

  async remove(value: DeploymentRecord, cleanup = false) {
    if (await this.owned(value, cleanup))
      await this.command(['rm', '-f', value.containerName], '', { cleanup, timeout: 20000 });
  }

  async network(value: DeploymentRecord) {
    const expected: Record<string, string> = { ...state.labels(value) };
    delete expected['system.wizard.environments.generation'];
    const current = await this.inspected(value.networkName, 'network');
    if (current) {
      if (Object.entries(expected).some(([key, val]) => current.labels?.[key] !== val))
        throw new Error('Candidate network ownership changed.');
      return;
    }
    const args = ['network', 'create', '--internal'];
    for (const [key, val] of Object.entries(expected)) args.push('--label', key + '=' + val);
    args.push(value.networkName);
    await this.command(args);
  }

  async removeNetwork(value: DeploymentRecord, cleanup = false) {
    const data = await this.inspected(value.networkName, 'network', cleanup);
    if (!data) return;
    const expected: Record<string, string> = { ...state.labels(value) };
    delete expected['system.wizard.environments.generation'];
    if (Object.entries(expected).some(([key, val]) => data.labels?.[key] !== val))
      throw new Error('Candidate network ownership changed.');
    if (Object.keys(data.containers || {}).length === 0)
      await this.command(['network', 'rm', value.networkName], '', { cleanup, timeout: 15000 });
  }

  async health(value: DeploymentRecord, options: { once?: boolean; cleanup?: boolean } = {}) {
    for (let attempt = 0; attempt < (options.once ? 1 : 30); attempt++) {
      if (this.cancelled || Date.now() >= this.deadline)
        throw new Error('Environment operation cancelled or timed out.');
      const data = await this.owned(value, options.cleanup);
      if (data?.running) {
        try {
          await this.command(
            [
              'exec',
              value.containerName,
              'wget',
              '-q',
              '-T',
              '2',
              '-O',
              '/dev/null',
              'http://127.0.0.1/',
            ],
            '',
            { timeout: 5000, cleanup: options.cleanup },
          );
          return true;
        } catch (_) {
          if (this.cancelled || Date.now() >= this.deadline)
            throw new Error('Environment operation cancelled or timed out.');
        }
      }
      if (!options.once) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  fragment(kind: EnvironmentKind) {
    return path.join(this.root, kind + '.conf');
  }

  readFragment(kind: EnvironmentKind) {
    try {
      return fs.readFileSync(this.fragment(kind), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  writeFragment(kind: EnvironmentKind, text: string | null) {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (text === null) {
      try {
        fs.unlinkSync(this.fragment(kind));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      return;
    }
    const temporary = this.fragment(kind) + '.next-' + this.token;
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, this.fragment(kind));
  }

  async reload(cleanup = false) {
    await this.command(['exec', 'system_web_1', 'nginx', '-t'], '', { cleanup, timeout: 15000 });
    await this.command(['exec', 'system_web_1', 'nginx', '-s', 'reload'], '', {
      cleanup,
      timeout: 15000,
    });
  }

  async reconcile(slot: DeploymentSlot) {
    return lifecycle.execute(this, 'reconcile', slot);
  }

  async cleanupRetired(slot: DeploymentSlot) {
    return lifecycle.execute(this, 'cleanupRetired', slot);
  }

  async cleanupTombstone(slot: DeploymentSlot) {
    return lifecycle.execute(this, 'cleanupTombstone', slot);
  }

  async cleanupStoppedRoute(slot: DeploymentSlot) {
    return lifecycle.execute(this, 'cleanupStoppedRoute', slot);
  }

  async refreshActive(slot: DeploymentSlot) {
    return lifecycle.execute(this, 'refreshActive', slot);
  }

  async readiness() {
    await this.canonical('dns');
    const production = this.context.publicSettings.WIZARD_HOST;
    const reserved = new Set([
      production,
      this.context.publicSettings.GITLAB_HOST,
      this.context.publicSettings.GITLAB_REGISTRY_HOST,
    ]);
    const hosts: string[] = [];
    for (const kind of ['review', 'beta'] as const) {
      const setting = this.environment.settings[kind];
      if (!setting.enabled) continue;
      if (
        setting.domainMode !== 2 ||
        !/^[a-z0-9][a-z0-9.-]*$/.test(setting.host || '') ||
        reserved.has(setting.host) ||
        hosts.includes(setting.host)
      )
        throw new Error('Candidate host conflicts with a platform route.');
      hosts.push(setting.host);
      if (
        ![setting.ssl, setting.sslKey].every(
          (p) => /^\/ssl\/[A-Za-z0-9_./-]+$/.test(p || '') && !p.includes('..'),
        )
      )
        throw new Error('Invalid candidate certificate path.');
      let certificate;
      try {
        const sslRoot = fs.realpathSync('/ssl') + path.sep;
        if (![setting.ssl, setting.sslKey].every((p) => fs.realpathSync(p).startsWith(sslRoot)))
          throw new Error('certificate-path');
        certificate = new crypto.X509Certificate(fs.readFileSync(setting.ssl));
        const key = crypto.createPrivateKey(fs.readFileSync(setting.sslKey));
        if (!certificate.checkPrivateKey(key)) throw new Error('key');
      } catch (_) {
        throw new Error('Candidate certificate is unavailable.');
      }
      if (
        certificate.checkHost(setting.host, { subject: 'never', wildcards: false }) !==
          setting.host ||
        Date.parse(certificate.validFrom) > Date.now() ||
        Date.parse(certificate.validTo) <= Date.now()
      )
        throw new Error('Candidate certificate does not cover its exact host or is expired.');
    }
  }

  async verify() {
    const registry = new URL(this.context.publicSettings.GITLAB_REGISTRY_URL);
    if (Number(this.context.publicSettings.GITLAB_REGISTRY_DOMAIN_MODE || 0) < 2)
      registry.port = '5050';
    if (this.request.delivery === 'system') {
      const binding = (this.request.kind === 'beta' ? betaBinding : reviewBinding).validate(
        this.request.kind === 'beta'
          ? this.context.systemBetaBinding
          : this.context.systemReviewBinding,
        this.context,
        this.request,
      );
      const result = await this.verifyInput({
        binding,
        request: this.request,
        repository: this.context.receipt.repository,
        environments: this.environment,
        registryHost: registry.host,
        securityRelease: JSON.parse(
          fs.readFileSync(path.join(sourceRoot, 'config/gitlab/security-release.json'), 'utf8'),
        ) as unknown,
      });
      if (this.request.action === 'deploy') {
        const images = await this.json<ImageRow[]>([
          'image',
          'inspect',
          binding.helperImage,
          binding.wizardImageRef,
        ]);
        const [helper, wizard] = images;
        const labels = (item: ImageRow | undefined) => item?.Config?.Labels || {};
        if (
          helper?.Id !== binding.helperImage ||
          wizard?.Id !== binding.wizardImageId ||
          labels(helper)['org.opencontainers.image.revision'] !== binding.sourceCommit ||
          labels(wizard)['org.opencontainers.image.revision'] !==
            (this.request.kind === 'beta' ? binding.sourceCommit : binding.wizardRevision) ||
          labels(wizard)['org.system-bootstrapper.source-revision'] !== binding.sourceCommit ||
          images.some(
            (item) =>
              labels(item)['org.system-bootstrapper.test-job'] !== String(binding.candidateJobId),
          )
        )
          throw new Error('System review images do not match the accepted candidate/source/job.');
      }
      return result;
    }
    const workflow = this.context.receipt.wizardWorkflow;
    const build = workflow?.build;
    if (this.context.receipt.repository.managementMode === 'source-primary') {
      const proof = reservation(this.environment);
      if (
        proof.recipeHash !== this.environment.recipeHash ||
        build?.version !== 1 ||
        build.mode !== 'source-primary' ||
        this.context.receipt.sourcePrimary?.version !== 1 ||
        JSON.stringify(this.context.receipt.sourcePrimary.ciFiles) !==
          JSON.stringify(this.environment.ciFiles)
      )
        throw new Error('Canonical source-primary CI reservation changed.');
      return this.verifyInput({
        repository: this.context.receipt.repository,
        sourcePrimary: this.context.receipt.sourcePrimary,
        request: this.request,
        registryPrefix: registry.host + '/' + this.context.receipt.repository.path,
        environments: this.environment,
      });
    }
    const legacy = canonicalLegacyRecipe(build?.recipeHash);
    if (
      build?.version !== 1 ||
      build.recipeHash !== legacy.recipeHash ||
      (this.environment.buildRecipeHash && this.environment.buildRecipeHash !== build.recipeHash) ||
      !/^[a-f0-9]{40}$/.test(build.activationCommit || '')
    )
      throw new Error('Canonical managed build recipe identity changed.');
    const legacyMarker = {
      path: '.system-bootstrapper/wizard-build.json',
      content: JSON.stringify({
        version: 1,
        operation: build.operation,
        recipeHash: legacy.recipeHash,
        sourceRevision: workflow.sourceRevision,
        importCommit: workflow.importCommit,
      }),
    };
    const input = {
      repository: this.context.receipt.repository,
      registrationOperation: this.context.receipt.operation,
      request: this.request,
      registryPrefix: registry.host + '/' + this.context.receipt.repository.path,
      environments: this.environment,
      recipe: canonicalRecipe(this.environment),
      legacyFiles: legacy.files,
      legacyMarker,
      buildActivationCommit: build.activationCommit,
    };
    return this.verifyInput(input);
  }

  async verifyInput(input: unknown): Promise<{ ok: boolean; imageRef: string }> {
    const kind = this.request.delivery === 'system' ? this.request.kind : 'environment';
    // The helper has no GitLab configuration mount. Verification runs in the
    // original controller's shared service; credentials never leave that owner.
    const result = await this.json<{ ok: boolean; imageRef?: string }>(
      [
        'exec',
        '-i',
        'system_bootstrapper_1',
        'node',
        '/system/dist/modules/project-lifecycle/deployment-evidence-entry.js',
        kind,
      ],
      JSON.stringify({ input }),
      { timeout: 180000 },
    );
    if (!result.ok) throw new Error('Canonical GitLab job, source, or candidate checks failed.');
    if (this.request.action === 'deploy' && !('imageRef' in result))
      throw Error('Verified deployment image required.');
    return result as { ok: boolean; imageRef: string };
  }

  async deploy(slot: DeploymentSlot, imageRef: string) {
    return lifecycle.execute(this, 'deploy', slot, imageRef);
  }

  async stop(slot: DeploymentSlot) {
    return lifecycle.execute(this, 'stop', slot);
  }

  async run() {
    if (
      this.request.action === 'deploy' &&
      (this.request.kind === 'review' || this.request.delivery !== 'system')
    )
      throw Error(
        'System Wizard Review is retired. Use optional Beta from an accepted System candidate.',
      );
    let locked = false,
      lockAttempted = false;
    try {
      lockAttempted = true;
      await this.canonical('lock');
      locked = true;
      this.context = await this.canonical<RuntimeContext>('read');
      this.environment = this.context.receipt.wizardWorkflow
        ?.environments as typeof this.environment;
      const system = this.request.delivery === 'system';
      const binding = system
        ? (this.request.kind === 'beta' ? betaBinding : reviewBinding).validate(
            this.request.kind === 'beta'
              ? this.context.systemBetaBinding
              : this.context.systemReviewBinding,
            this.context,
            this.request,
          )
        : null;
      if (
        !this.environment ||
        this.environment.operation !== this.request.operation ||
        this.environment.phase !== 'ready' ||
        !this.environment.activationCommit ||
        (!system && this.context.receipt.repository.id !== this.request.projectId)
      )
        throw new Error('Managed environment reservation is not ready.');
      const own = await this.inspected(this.helperName);
      if (
        !own ||
        own.image !== (system ? binding!.helperImage : this.environment.helperImage) ||
        own.labels?.['system.wizard.environments.helper'] !== this.request.operation
      )
        throw new Error('Immutable clean helper image does not match the reservation.');
      this.environment.deployments ||= {};
      this.setting = this.environment.settings[this.request.kind];
      if (!this.setting?.enabled) throw new Error('Requested candidate environment is disabled.');
      if (this.request.action === 'deploy') await this.readiness();
      const verified = await this.verify();
      let slot = this.environment.deployments[this.request.kind] || {};
      if (this.request.action === 'stop') {
        state.stopPlan(slot, this.request); // validate before any recovery/cleanup
        slot = await this.cleanupRetired(slot);
        if (!slot.active && slot.tombstone) {
          await this.remove(slot.tombstone);
          await this.removeNetwork(slot.tombstone);
        }
        return await this.stop(slot);
      }
      state.recoveryAllowed(slot, this.request);
      state.deployPlan(
        { ...slot, pending: null },
        state.record(this.request, this.setting.host, verified.imageRef),
      );
      slot = await this.reconcile(slot);
      slot = await this.cleanupRetired(slot);
      return await this.deploy(slot, verified.imageRef);
    } finally {
      if (lockAttempted) {
        try {
          await this.canonical('unlock', {}, true);
        } catch (error) {
          if (locked) throw error;
        }
      }
    }
  }
}
