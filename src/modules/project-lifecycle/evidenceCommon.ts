import { repositoryFileHash } from '../project-ci/cliFileEvidence';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
export type EvidenceRow = Record<string, unknown>;
export interface EvidenceReader {
  get(route: string): Promise<unknown>;
  raw(route: string): Promise<Buffer>;
}
export function accepted(value: unknown): asserts value {
  if (!value) {
    throw Error('canonical-deployment-evidence-invalid');
  }
}
export function row(value: unknown): EvidenceRow {
  accepted(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as EvidenceRow;
}
export function rows(value: unknown): EvidenceRow[] {
  accepted(Array.isArray(value) && value.length <= 10000);
  return value.map(row);
}
export const same = isDeepStrictEqual;
export const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
export const revision = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const image = (value: unknown): value is string =>
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function text(value: unknown): string {
  accepted(typeof value === 'string' && value.length <= 8 * 1024 * 1024);
  return value;
}
export function decoded(value: unknown): Buffer {
  const source = text(value).replace(/\n/g, ''),
    bytes = Buffer.from(source, 'base64');
  accepted(bytes.toString('base64') === source);
  return bytes;
}
export async function pages(reader: EvidenceReader, route: string) {
  const result: EvidenceRow[] = [];
  for (let page = 1; page <= 100; page++) {
    const values = rows(await reader.get(route + (page === 1 ? '' : '&page=' + page)));
    accepted(values.length <= 100);
    result.push(...values);

    if (values.length < 100) {
      return result;
    }
  }
  throw Error('canonical-deployment-evidence-invalid');
}
export const pipelineStatuses = [
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
];
export function boundJob(job: EvidenceRow, pipeline: EvidenceRow, project: unknown): boolean {
  return (
    positive(job.id) &&
    row(job.commit).id === pipeline.sha &&
    row(job.pipeline).id === pipeline.id &&
    (job.project_id === undefined || job.project_id === project)
  );
}
export function nativeJobs(jobs: EvidenceRow[], pipeline: EvidenceRow, project: unknown) {
  for (const name of ['build:source', 'test:browser', 'build:wizard', 'test:wizard']) {
    const selected = jobs.filter((job) => job.name === name);
    accepted(
      selected.length === 1 &&
        boundJob(selected[0], pipeline, project) &&
        selected[0].allow_failure === false &&
        selected[0].status === 'success',
    );
  }
  const publishers = jobs.filter((job) => job.name === 'deploy:github');
  accepted(
    publishers.length === 0 ||
      (publishers.length === 1 &&
        boundJob(publishers[0], pipeline, project) &&
        publishers[0].allow_failure === false &&
        pipelineStatuses.includes(text(publishers[0].status))),
  );
  accepted(
    jobs
      .filter((job) => job.name !== 'deploy:github' && job.allow_failure !== true)
      .every((job) => boundJob(job, pipeline, project) && job.status === 'success'),
  );
  accepted(
    pipelineStatuses.includes(text(pipeline.status)) &&
      (['success', 'running'].includes(text(pipeline.status)) ||
        (publishers.length === 1 && publishers[0].status !== 'success')),
  );
  return ['build:wizard', 'test:wizard'].map((name) => jobs.find((job) => job.name === name)!);
}
export async function managedFiles(
  reader: EvidenceReader,
  prefix: string,
  sha: unknown,
  files: unknown,
  activation: unknown,
) {
  const values = rows(files);
  accepted(
    revision(sha) &&
      revision(activation) &&
      values.length > 0 &&
      new Set(values.map((file) => file.path)).size === values.length,
  );
  for (const file of values) {
    const content = row(
      await reader.get(
        prefix + 'repository/files/' + encodeURIComponent(text(file.path)) + '?ref=' + sha,
      ),
    );
    accepted(
      content.last_commit_id === activation &&
        decoded(content.content).equals(Buffer.from(text(file.content))),
    );
  }
}
export async function sourceFiles(
  reader: EvidenceReader,
  prefix: string,
  sha: unknown,
  files: unknown,
  production = false,
) {
  const values = rows(files);
  accepted(
    revision(sha) &&
      values.length > 0 &&
      values.length <= 40 &&
      new Set(values.map((file) => file.path)).size === values.length,
  );
  accepted(values.some((file) => file.path === '.gitlab/primary.yml'));

  if (!production) {
    accepted(values.some((file) => file.path === '.gitlab/delivery/environment.sh'));
  }

  for (const file of values) {
    const name = text(file.path);
    accepted(
      (production
        ? /^(?:\.gitlab|\.system-bootstrapper)\/[A-Za-z0-9_./-]+$/
        : /^(?:\.gitlab\/|\.system-bootstrapper\/build-v1\/)[A-Za-z0-9_./-]+$/
      ).test(name) &&
        !name.split('/').includes('..') &&
        /^[a-f0-9]{64}$/.test(text(file.sha256)),
    );

    if (!production) {
      accepted(same(Object.keys(file).sort(), ['path', 'sha256']));
    }

    const content = row(
      await reader.get(prefix + 'repository/files/' + encodeURIComponent(name) + '?ref=' + sha),
    );
    accepted(repositoryFileHash(text(file.path), content) === file.sha256);
  }
}
export async function buildArtifacts(
  reader: EvidenceReader,
  prefix: string,
  pipeline: EvidenceRow,
  jobs: EvidenceRow[],
  registryPrefix: string,
  modern: boolean,
  strictJobs = modern,
) {
  const required = ['build:wizard', 'test:wizard'].map((name) => {
    const values = jobs
      .filter((job) => job.name === name)
      .sort((a, b) => Number(b.id) - Number(a.id));
    accepted(values.length > 0 && (!strictJobs || values.length === 1));
    const selected = values[0];
    accepted(
      positive(selected.id) &&
        selected.status === 'success' &&
        selected.allow_failure === false &&
        row(selected.commit).id === pipeline.sha,
    );
    return selected;
  });
  const artifacts: EvidenceRow[] = [];
  for (const [index, filename] of ['build-evidence.json', 'wizard-evidence.json'].entries()) {
    const artifact = row(
      await reader.get(prefix + 'jobs/' + required[index].id + '/artifacts/' + filename),
    );
    const reference = text(artifact.imageRef);
    accepted(
      artifact.version === 1 &&
        artifact.sourceCommit === pipeline.sha &&
        artifact.pipelineId === pipeline.id &&
        reference.startsWith(registryPrefix + '@') &&
        image(reference.slice(registryPrefix.length + 1)),
    );
    artifacts.push(artifact);
  }
  const [build, smoke] = artifacts;
  const vitest =
    build.unitTests === true &&
    build.testRunner === 'vitest' &&
    build.lint === true &&
    build.typecheck === true;
  accepted(
    (modern ? vitest : build.jest === true || vitest) &&
      build.productionBuild === true &&
      ['http', 'renderedUI', 'projects', 'spa'].every((key) => smoke[key] === true) &&
      (build.testRunner !== 'vitest' ||
        ['configurationBackup', 'cubeSignature'].every((key) => smoke[key] === true)) &&
      build.imageRef === smoke.imageRef,
  );
  return { required, build, smoke };
}
