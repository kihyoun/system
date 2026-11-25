import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GitlabCredentialService } from './credential.service';
import { GitlabProjectCredentialService } from './projectCredential.service';
import { GitlabNativeApiService, type GitlabApiResult } from './nativeApi.service';
type Row = Record<string, unknown>;
export interface WizardRepositoryApi {
  request(method: 'GET' | 'POST', route: string, body?: unknown): Promise<GitlabApiResult>;
}
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('Wizard repository response is invalid');
  }

  return value as Row;
}
function text(value: unknown): string {
  if (typeof value !== 'string') {
    throw Error('Wizard repository text is invalid');
  }

  return value;
}
function list(value: unknown): Row[] {
  if (!Array.isArray(value)) {
    throw Error('Wizard repository list is invalid');
  }

  return value.map(row);
}
function hash(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function decoded(value: unknown): Buffer {
  const encoded = text(row(value).content).replace(/\n/g, '');
  const bytes = Buffer.from(encoded, 'base64');

  if (bytes.toString('base64') !== encoded) {
    throw Error('Wizard repository encoding is invalid');
  }

  return bytes;
}
function required(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw Error(message);
  }
}
function sourceManifest(input: Row, snapshot: Row) {
  return JSON.stringify({
    version: 1,
    operation: input.operation,
    sourceRevision: snapshot.sourceRevision,
    manifestHash: snapshot.manifestHash,
    ...(snapshot.sourceLayout
      ? { sourceLayout: snapshot.sourceLayout, wizardSourceTree: snapshot.wizardSourceTree }
      : {}),
  });
}
@Injectable()
export class WizardSourceImportService {
  validate(input: Row, project: Row) {
    const expected = row(input.repository);
    required(
      project.id === expected.id &&
        project.description === 'System Bootstrapper operation ' + text(input.operation) &&
        project.visibility === 'private' &&
        project.path_with_namespace === expected.path &&
        project.default_branch === expected.defaultBranch &&
        project.ci_config_path === '.system-bootstrapper/ci.yml',
      'Wizard repository ownership changed',
    );
  }

  async execute(api: WizardRepositoryApi, input: Row, project: Row) {
    this.validate(input, project);
    const prefix = `projects/${project.id}/repository/`,
      branch = text(project.default_branch);
    const file = async (name: string) => {
      const response = await api.request(
        'GET',
        prefix + 'files/' + encodeURIComponent(name) + '?ref=' + encodeURIComponent(branch),
      );
      required(
        [200, 404].includes(response.status),
        'Wizard source lookup failed; retry initialization',
      );
      return response.status === 200 ? row(response.value) : undefined;
    };
    const ci = await file('.system-bootstrapper/ci.yml');
    required(
      ci && decoded(ci).toString('utf8') === input.expectedCi,
      'Managed CI changed; refusing source initialization',
    );
    const snapshot = row(input.snapshot),
      sources = list(snapshot.files),
      manifestPath = '.system-bootstrapper/wizard-source.json';
    required(
      /^[a-f0-9]{40}$/.test(text(snapshot.sourceRevision)) &&
        /^[a-f0-9]{64}$/.test(text(snapshot.manifestHash)),
      'Wizard snapshot identity is invalid',
    );

    if (snapshot.sourceLayout !== undefined) {
      required(
        snapshot.sourceLayout === 'system-monorepo-v1' &&
          /^[a-f0-9]{40}$/.test(text(snapshot.wizardSourceTree)),
        'Wizard snapshot layout is invalid',
      );
    }

    required(
      new Set(sources.map((source) => source.path)).size === sources.length,
      'Wizard snapshot paths are duplicated',
    );
    for (const source of sources) {
      const name = text(source.path);
      required(
        name.length > 0 &&
          !name.startsWith('/') &&
          !name.split('/').some((part) => ['', '..', '.', '.git'].includes(part)) &&
          !/[\0\r\n\\]/.test(name) &&
          ['100644', '100755'].includes(text(source.mode)) &&
          hash(decoded(source)) === source.sha256,
        'Wizard snapshot content is invalid',
      );
    }
    const manifest = sourceManifest(input, snapshot),
      installed = await file(manifestPath);

    if (installed) {
      required(
        decoded(installed).toString('utf8') === manifest,
        'Wizard source marker changed; refusing overwrite',
      );
      for (const source of sources) {
        const current = await file(text(source.path));
        required(
          current &&
            hash(decoded(current)) === source.sha256 &&
            Boolean(current.execute_filemode) === (source.mode === '100755') &&
            current.last_commit_id === installed.last_commit_id,
          'Imported Wizard source changed; refusing overwrite',
        );
      }
      return { importCommit: installed.last_commit_id, phase: 'source-imported' };
    }

    const actions: Row[] = [];
    for (const source of sources) {
      required(
        !(await file(text(source.path))),
        'Wizard source path is occupied; refusing overwrite: ' + source.path,
      );
      actions.push({
        action: 'create',
        file_path: source.path,
        encoding: 'base64',
        content: source.content,
      });

      if (source.mode === '100755') {
        actions.push({ action: 'chmod', file_path: source.path, execute_filemode: true });
      }
    }
    actions.push(
      { action: 'create', file_path: manifestPath, content: manifest },
      {
        action: 'update',
        file_path: '.system-bootstrapper/ci.yml',
        content: input.expectedCi,
        last_commit_id: ci.last_commit_id,
      },
    );
    const response = await api.request('POST', prefix + 'commits', {
      branch,
      commit_message: 'Initialize pinned Wizard source [skip ci]',
      actions,
    });
    required(
      response.status === 201,
      'Wizard source import conflicted or failed; retry to inspect the same repository',
    );
    return { importCommit: text(row(response.value).id), phase: 'source-imported' };
  }
}
@Injectable()
export class WizardSourcePrimaryStatusService {
  validate(input: Row, project: Row) {
    const repository = row(input.repository),
      binding = row(input.sourcePrimary);
    required(
      repository.managementMode === 'source-primary' &&
        repository.ciPath === '.gitlab/primary.yml' &&
        binding.version === 1 &&
        project.id === repository.id &&
        project.path_with_namespace === repository.path &&
        row(project.namespace).id === input.namespaceId &&
        project.default_branch === repository.defaultBranch &&
        project.visibility === 'private' &&
        project.ci_config_path === repository.ciPath &&
        project.only_allow_merge_if_pipeline_succeeds === true &&
        project.only_allow_merge_if_all_discussions_are_resolved === true,
      'Source-primary Wizard binding changed',
    );
  }

  async execute(api: WizardRepositoryApi, input: Row, project: Row) {
    this.validate(input, project);
    const repository = row(input.repository),
      binding = row(input.sourcePrimary),
      build = row(input.build),
      prefix = `projects/${repository.id}/`;
    const get = async (route: string) => {
      const result = await api.request('GET', prefix + route);
      required(result.status === 200, 'Native Wizard evidence lookup failed');
      return result.value;
    };
    const head = text(
      row(
        row(await get('repository/branches/' + encodeURIComponent(text(repository.defaultBranch))))
          .commit,
      ).id,
    );
    required(/^[a-f0-9]{40}$/.test(head), 'Native Wizard branch identity changed');
    const pipelines = list(
      await get(
        'pipelines?ref=' +
          encodeURIComponent(text(repository.defaultBranch)) +
          '&sha=' +
          head +
          '&source=push&per_page=100',
      ),
    );
    const pipeline = pipelines
      .filter((value) => value.sha === head && value.source === 'push')
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    const pending = (message: string) => ({
      sourceRevision: head,
      build: {
        version: 1,
        mode: 'source-primary',
        phase: 'pending',
        pipeline: pipeline
          ? {
              id: pipeline.id,
              sha: pipeline.sha,
              status: pipeline.status,
              web_url: pipeline.web_url,
            }
          : null,
        recipeHash: build.recipeHash,
      },
      message,
    });

    if (!pipeline) {
      return pending('The current default branch has no successful native delivery pipeline yet.');
    }

    required(
      Number.isSafeInteger(pipeline.id) && Number(pipeline.id) > 0,
      'Native Wizard pipeline identity changed',
    );
    const files = list(binding.ciFiles);
    required(
      files.some((file) => file.path === repository.ciPath) &&
        new Set(files.map((file) => file.path)).size === files.length,
      'Native Wizard CI manifest is invalid',
    );
    for (const file of files) {
      const name = text(file.path);
      required(
        /^(?:\.gitlab|\.system-bootstrapper)\/[A-Za-z0-9_./-]+$/.test(name) &&
          !name.split('/').includes('..'),
        'Invalid native Wizard CI path',
      );
      required(
        hash(
          decoded(await get('repository/files/' + encodeURIComponent(name) + '?ref=' + head)),
        ) === file.sha256,
        'Approved native Wizard CI changed',
      );
    }
    const jobs = list(
      await get(`pipelines/${pipeline.id}/jobs?per_page=100&include_retried=false`),
    );
    const identity = (job: Row) =>
      job.allow_failure === false &&
      row(job.commit).id === head &&
      row(job.pipeline).id === pipeline.id;
    for (const name of ['build:source', 'test:browser', 'build:wizard', 'test:wizard']) {
      const matches = jobs.filter((job) => job.name === name),
        job = matches[0];
      required(
        matches.length === 1 && identity(job),
        'Required native source and delivery check identity changed',
      );

      if (
        [
          'created',
          'pending',
          'running',
          'waiting_for_resource',
          'preparing',
          'scheduled',
        ].includes(String(job.status))
      ) {
        return pending('Native source and delivery checks are still running.');
      }

      required(job.status === 'success', 'Required native source and delivery checks must succeed');
    }
    const publishers = jobs.filter((job) => job.name === 'deploy:github'),
      publisher = publishers[0];
    required(
      publishers.length <= 1 && (!publisher || identity(publisher)),
      'Native public mirror identity changed',
    );
    required(
      !jobs.some(
        (job) =>
          job.allow_failure === false && job.name !== 'deploy:github' && job.status !== 'success',
      ),
      'Native pipeline failed outside the public mirror',
    );

    if (pipeline.status !== 'success' && (!publisher || publisher.status === 'success')) {
      return pending('Native pipeline completion is not independently established.');
    }

    const artifacts: Row[] = [];
    for (const [name, filename] of [
      ['build:wizard', 'build-evidence.json'],
      ['test:wizard', 'wizard-evidence.json'],
    ]) {
      const job = jobs.find((value) => value.name === name)!;
      const artifact = row(await get(`jobs/${job.id}/artifacts/${filename}`));
      required(
        artifact.version === 1 &&
          artifact.sourceCommit === head &&
          artifact.pipelineId === pipeline.id,
        'Native Wizard artifact identity changed',
      );
      artifacts.push(artifact);
    }
    const [built, smoke] = artifacts;
    required(
      built.testRunner === 'vitest' &&
        ['unitTests', 'lint', 'typecheck', 'productionBuild'].every((key) => built[key] === true) &&
        ['http', 'renderedUI', 'projects', 'spa', 'configurationBackup', 'cubeSignature'].every(
          (key) => smoke[key] === true,
        ) &&
        built.imageRef === smoke.imageRef &&
        typeof built.imageRef === 'string' &&
        built.imageRef.startsWith(text(input.registryPrefix) + '@sha256:') &&
        /^[a-f0-9]{64}$/.test(built.imageRef.slice(text(input.registryPrefix).length + 8)),
      'Native Wizard checks are incomplete',
    );
    const mirrorFailed = publisher?.status === 'failed';
    return {
      sourceRevision: head,
      build: {
        version: 1,
        mode: 'source-primary',
        phase: 'candidate-verified',
        recipeHash: build.recipeHash,
        pipeline: { id: pipeline.id, sha: head, status: pipeline.status, webUrl: pipeline.web_url },
        publishing: { mirrorFailed, status: publisher?.status ?? 'absent' },
        artifact: { imageRef: built.imageRef, sourceCommit: head, pipelineId: pipeline.id },
      },
      message: mirrorFailed
        ? 'Native checks passed; the public GitHub mirror failed. Production is independent of mirror availability.'
        : 'Native source-primary build and browser evidence verified. Production remains a separate operator promotion.',
    };
  }
}
@Injectable()
export class WizardSourceOperationService {
  constructor(
    private readonly credentials: GitlabCredentialService,
    private readonly projects: GitlabProjectCredentialService,
    private readonly api: GitlabNativeApiService,
    private readonly importer: WizardSourceImportService,
    private readonly status: WizardSourcePrimaryStatusService,
  ) {}

  async execute(checkout: string, value: unknown, signal?: AbortSignal) {
    const input = row(value),
      repository = row(input.repository);
    required(
      ['wizard-source', 'wizard-source-primary-status'].includes(text(input.action)) &&
        Number.isSafeInteger(repository.id) &&
        Number(repository.id) > 0 &&
        Number.isSafeInteger(input.namespaceId) &&
        Number(input.namespaceId) > 0 &&
        /^[a-z0-9]+$/.test(text(input.projectKey)),
      'Invalid Wizard repository selection',
    );
    const authority = await this.credentials.ensure({ checkout, signal });
    const result = await this.api.request(
      authority.context,
      authority.credential.token,
      'GET',
      `projects/${repository.id}`,
    );
    const project = row(result.value);
    required(
      result.status === 200 &&
        project.id === repository.id &&
        project.path_with_namespace === repository.path &&
        row(project.namespace).id === input.namespaceId,
      'Bound Wizard project identity changed',
    );
    const service = input.action === 'wizard-source' ? this.importer : this.status;
    service.validate(input, project);
    const token = await this.projects.current(
      authority.context,
      authority.configDirectory,
      Number(repository.id),
      text(repository.path),
      authority.credential.token,
    );
    const api: WizardRepositoryApi = {
      request: (method, route, body) => {
        required(route.startsWith(`projects/${repository.id}/`), 'Wizard project route changed');
        return this.api.request(authority.context, token.token, method, route, body);
      },
    };
    return service.execute(api, input, project);
  }
}
