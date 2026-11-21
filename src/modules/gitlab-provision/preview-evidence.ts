import { createHash } from 'node:crypto';
export type PreviewRow = Record<string, unknown>;
export class PreviewError extends Error {}
export function requirePreview(
  value: unknown,
  message = 'Invalid preview evidence route.',
): asserts value {
  if (!value) throw new PreviewError(message);
}
export function previewRow(value: unknown): PreviewRow {
  requirePreview(value && typeof value === 'object' && !Array.isArray(value));
  return value as PreviewRow;
}
export function previewText(value: unknown): string {
  requirePreview(typeof value === 'string');
  return value;
}
export function previewRows(value: unknown): PreviewRow[] {
  requirePreview(Array.isArray(value));
  return value.map(previewRow);
}
export const previewEncode = (value: unknown): string =>
  encodeURIComponent(previewText(value))
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const exactHex = (value: unknown, length: number): value is string =>
  typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
export const previewRequestFailure =
  'Preview setup GitLab request failed; verify readiness, permissions and the recorded operation.';
/** Fresh, bounded read set. Never retained on the singleton service between phases. */
export class PreviewEvidence {
  private count = 0;
  private bytes = 32;
  constructor(
    private readonly input: PreviewRow,
    private readonly get: (route: string) => Promise<unknown>,
  ) {}

  routes(value: unknown): string[] {
    requirePreview(Array.isArray(this.input.projectIds) && this.input.projectIds.every(positive));
    const ids = this.input.projectIds as number[];
    requirePreview(Array.isArray(value) && value.length >= 1 && value.length <= 32);
    return value.map((route) => {
      requirePreview(
        typeof route === 'string' &&
          Buffer.byteLength(route) <= 2048 &&
          !/[\x00-\x20\x7f]/.test(route) &&
          !route.includes('..'),
      );
      const match =
        /^projects\/([1-9][0-9]*)(?:$|\/(?:repository\/(?:branches\/|files\/|tree\?)|pipelines(?:\/|\?)|jobs\/[1-9][0-9]*\/artifacts\/))/.exec(
          route,
        );
      requirePreview(match && ids.includes(Number(match[1])));
      return route;
    });
  }

  result<T>(value: T): T {
    requirePreview(Buffer.byteLength(JSON.stringify(value)) <= 1500000, previewRequestFailure);
    return value;
  }

  async read(route: string, recorded?: PreviewRow[]): Promise<unknown> {
    this.routes([route]);
    requirePreview(++this.count <= 32);
    const value = await this.get(route);
    this.bytes += Buffer.byteLength(JSON.stringify(value)) + 1;
    requirePreview(this.bytes <= 1500000, previewRequestFailure);
    recorded?.push({ route, value });
    return value;
  }

  async context(): Promise<PreviewRow> {
    const id = this.input.projectId;
    requirePreview(
      positive(id) && Array.isArray(this.input.projectIds) && this.input.projectIds.includes(id),
    );
    const prefix = `projects/${id}`,
      project = previewRow(await this.read(prefix)),
      branchName = project.default_branch;
    requirePreview(
      project.id === id && typeof branchName === 'string' && branchName.length > 0,
      'Selected preview source identity is invalid.',
    );
    const branch = previewRow(
      await this.read(prefix + '/repository/branches/' + previewEncode(branchName)),
    );
    const sha = previewRow(branch.commit).id;
    requirePreview(exactHex(sha, 40), 'Selected preview source identity is invalid.');
    const pipelines = previewRows(
      await this.read(
        prefix +
          '/pipelines?sha=' +
          sha +
          '&ref=' +
          previewEncode(branchName) +
          '&source=push&per_page=100',
      ),
    );
    const pipeline = pipelines.find((row) => row.sha === sha && row.source === 'push') ?? null;
    const result: PreviewRow = { project, branch, pipeline };
    if (!pipeline || !['success', 'failed'].includes(String(pipeline.status)))
      return this.result(result);
    requirePreview(positive(pipeline.id), 'Selected preview source identity is invalid.');
    result.jobs = await this.read(
      prefix + `/pipelines/${pipeline.id}/jobs?per_page=100&include_retried=false`,
    );
    const trees: PreviewRow[][] = [];
    for (const directory of ['.gitlab', '.system-bootstrapper/build-v1']) {
      const rows = previewRows(
        await this.read(
          prefix +
            '/repository/tree?path=' +
            previewEncode(directory) +
            '&ref=' +
            sha +
            '&recursive=true&per_page=100',
        ),
      );
      requirePreview(
        rows.length < 100,
        'The approved CI manifest is too large. Review it through the native source-primary tool.',
      );
      trees.push(rows);
    }
    result.trees = trees;
    return this.result(result);
  }

  checks(pipeline: PreviewRow, value: unknown): PreviewRow[] {
    requirePreview(
      [
        'created',
        'pending',
        'running',
        'success',
        'failed',
        'canceled',
        'manual',
        'scheduled',
        'waiting_for_resource',
        'preparing',
      ].includes(String(pipeline.status)) && Array.isArray(value),
      'Native Wizard pipeline state is invalid.',
    );
    const jobs = previewRows(value);
    const bound = (job: PreviewRow) =>
      job.allow_failure === false &&
      previewRow(job.commit).id === pipeline.sha &&
      previewRow(job.pipeline).id === pipeline.id;
    for (const name of ['build:source', 'test:browser', 'build:wizard', 'test:wizard']) {
      const found = jobs.filter((job) => job.name === name);
      requirePreview(
        found.length === 1 && found[0].status === 'success' && bound(found[0]),
        'All required native source and delivery checks must succeed.',
      );
    }
    const publishers = jobs.filter((job) => job.name === 'deploy:github'),
      publisher = publishers[0];
    requirePreview(
      publishers.length <= 1 && (!publisher || bound(publisher)),
      'Public mirror job identity changed.',
    );
    requirePreview(
      !jobs.some(
        (job) =>
          job.allow_failure === false && job.name !== 'deploy:github' && job.status !== 'success',
      ) &&
        (pipeline.status === 'success' || (publisher && publisher.status !== 'success')),
      'Native Wizard pipeline failed outside the optional public mirror.',
    );
    return jobs;
  }

  async source(): Promise<PreviewRow> {
    const result = await this.context(),
      pipeline = result.pipeline ? previewRow(result.pipeline) : null;
    if (!pipeline || !['success', 'failed'].includes(String(pipeline.status))) return result;
    const jobs = this.checks(pipeline, result.jobs);
    requirePreview(Array.isArray(result.trees));
    const blobs = result.trees.flatMap(previewRows).filter((row) => row.type === 'blob');
    if (blobs.length + 7 > 32) return result;
    const prefix = `projects/${this.input.projectId}`,
      sha = previewRow(previewRow(result.branch).commit).id;
    const artifact =
      prefix +
      `/jobs/${jobs.find((job) => job.name === 'build:wizard')!.id}/artifacts/build-evidence.json`;
    const routes = blobs.map(
      (row) => prefix + '/repository/files/' + previewEncode(row.path) + '?ref=' + sha,
    );
    this.routes([artifact, ...routes]);
    result.artifact = await this.read(artifact);
    const files: PreviewRow[] = [];
    for (let index = 0; index < routes.length; index++)
      files.push({ path: blobs[index].path, value: await this.read(routes[index]) });
    result.files = files;
    return this.result(result);
  }

  async adoption(): Promise<PreviewRow> {
    const receipt = previewRow(this.input.receipt),
      repository = previewRow(receipt.repository),
      binding = previewRow(receipt.sourcePrimary);
    const id = repository.id,
      previous = this.input.previousProjectId,
      pipelineId = this.input.pipelineId,
      sha = this.input.sourceCommit,
      files = previewRows(binding.ciFiles);
    requirePreview(
      [id, previous, pipelineId, receipt.namespaceId].every(positive) &&
        repository.namespaceId === receipt.namespaceId &&
        repository.managementMode === 'source-primary' &&
        repository.ciPath === '.gitlab/primary.yml' &&
        typeof repository.path === 'string' &&
        typeof repository.defaultBranch === 'string' &&
        exactHex(sha, 40) &&
        files.length >= 1 &&
        files.length <= 25 &&
        new Set(files.map((file) => file.path)).size === files.length &&
        files.some((file) => file.path === '.gitlab/primary.yml') &&
        files.every(
          (file) =>
            typeof file.path === 'string' &&
            /^(?:\.gitlab|\.system-bootstrapper)\/[A-Za-z0-9_./-]+$/.test(file.path) &&
            !/[\r\n]/.test(file.path) &&
            !file.path.split('/').includes('..') &&
            exactHex(file.sha256, 64),
        ),
    );
    const prefix = `projects/${id}`,
      routes = [
        `projects/${previous}`,
        prefix + '/repository/branches/' + previewEncode(repository.defaultBranch),
        prefix,
        prefix + `/pipelines/${pipelineId}`,
        prefix + `/pipelines/${pipelineId}/jobs?per_page=100&include_retried=false`,
        ...files.map(
          (file) => prefix + '/repository/files/' + previewEncode(file.path) + '?ref=' + sha,
        ),
      ];
    this.routes(routes);
    const recorded: PreviewRow[] = [];
    await this.read(routes[0], recorded);
    const branch = previewRow(await this.read(routes[1], recorded)),
      project = previewRow(await this.read(routes[2], recorded)),
      pipeline = previewRow(await this.read(routes[3], recorded)),
      value = await this.read(routes[4], recorded);
    requirePreview(
      project.id === id &&
        project.path_with_namespace === repository.path &&
        previewRow(project.namespace).id === receipt.namespaceId &&
        project.default_branch === repository.defaultBranch &&
        project.visibility === 'private' &&
        project.ci_config_path === '.gitlab/primary.yml' &&
        project.only_allow_merge_if_pipeline_succeeds === true &&
        project.only_allow_merge_if_all_discussions_are_resolved === true,
      'Canonical source-primary project identity or merge gates changed.',
    );
    requirePreview(
      previewRow(branch.commit).id === sha &&
        pipeline.id === pipelineId &&
        pipeline.sha === sha &&
        pipeline.ref === repository.defaultBranch &&
        pipeline.source === 'push' &&
        [undefined, null, false, '', 0].includes(pipeline.yaml_errors as undefined),
      'Require the exact successful native default-branch push pipeline.',
    );
    const jobs = this.checks(pipeline, value);
    for (let index = 0; index < files.length; index++) {
      const file = previewRow(await this.read(routes[index + 5], recorded));
      const encoded = previewText(file.content).replace(/\n/g, '');
      requirePreview(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded),
        'Approved native Wizard CI changed.',
      );
      requirePreview(
        createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex') ===
          files[index].sha256,
        'Approved native Wizard CI changed.',
      );
    }
    for (const [name, filename] of [
      ['build:wizard', 'build-evidence.json'],
      ['test:wizard', 'wizard-evidence.json'],
    ])
      await this.read(
        prefix + `/jobs/${jobs.find((job) => job.name === name)!.id}/artifacts/${filename}`,
        recorded,
      );
    return this.result({ reads: recorded });
  }
}
