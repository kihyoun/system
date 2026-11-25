import { repositoryFileContent, repositoryFileHash } from '../project-ci/cliFileEvidence';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ManagedReceipt,
  PrimaryReceipt,
  NativeProject,
  NativePipeline,
  NativeJob,
  SourceGet,
} from './sourcePrimaryTypes';
import { FileRow, ArtifactRow } from './upgradeTypes';
export const hash = (value: string | Buffer) =>
  crypto.createHash('sha256').update(value).digest('hex');
export const sha = (value: string | undefined) => /^[a-f0-9]{40}$/.test(value || '');
const digest = (value: string | undefined) => /^[a-f0-9]{64}$/.test(value || '');
export const projectConfigurationPrefix = '# BOOTSTRAPPER_PROJECT=';
export const ci = '.gitlab/primary.yml';
export function primary(receipt: unknown): receipt is PrimaryReceipt {
  return (receipt as ManagedReceipt | undefined)?.repository?.managementMode === 'source-primary';
}
export function read(file: string) {
  const text = fs.readFileSync(file, 'utf8');

  if (
    text[807] !== '$' ||
    crypto.createHash('md5').update(text.slice(0, 1184)).digest('hex') !==
      'bd4a8426355824593a5e21ad759830c1'
  ) {
    throw Error('Wizard configuration signature changed.');
  }

  const rows = text.split('\n').filter((line) => line.startsWith(projectConfigurationPrefix));

  if (rows.length !== 1) {
    throw Error('Expected one canonical Wizard receipt.');
  }

  const receipt: ManagedReceipt = JSON.parse(
    Buffer.from(rows[0].slice(projectConfigurationPrefix.length), 'base64').toString(),
  );

  if (
    receipt.defaultProject !== true ||
    receipt.template !== 'wizard' ||
    receipt.state !== 'complete' ||
    receipt.repository?.systemProject !== true
  ) {
    throw Error('Managed Wizard ownership changed.');
  }

  return { text, receipt };
}
export function validate(input: unknown): PrimaryReceipt {
  const receipt = input as PrimaryReceipt;
  const r = receipt?.repository,
    p = receipt?.sourcePrimary;

  if (
    !primary(receipt) ||
    r.ciPath !== ci ||
    !Number.isSafeInteger(r.id) ||
    r.id < 1 ||
    !Number.isSafeInteger(receipt.namespaceId) ||
    receipt.namespaceId !== r.namespaceId ||
    !/^[A-Za-z0-9_./-]+$/.test(r.path || '') ||
    !/^[A-Za-z0-9_./-]+$/.test(r.defaultBranch || '') ||
    p?.version !== 1 ||
    !/^[a-f0-9]{48}$/.test(p.operation || '') ||
    !sha(p.adoptionCommit) ||
    !Array.isArray(p.ciFiles) ||
    !p.ciFiles.some((file) => file.path === ci) ||
    new Set(p.ciFiles.map((file) => file.path)).size !== p.ciFiles.length ||
    p.ciFiles.some(
      (file) =>
        !/^(?:\.gitlab|\.system-bootstrapper)\/[A-Za-z0-9_./-]+$/.test(file.path || '') ||
        file.path.split('/').includes('..') ||
        !digest(file.sha256),
    )
  ) {
    throw Error('Invalid source-primary Wizard binding.');
  }

  return receipt;
}
export function pipelineChecks(pipeline: NativePipeline, jobs: NativeJob[]) {
  if (
    ![
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
    ].includes(pipeline.status) ||
    !Array.isArray(jobs)
  ) {
    throw Error('Native Wizard pipeline state is invalid.');
  }

  for (const name of ['build:source', 'test:browser', 'build:wizard', 'test:wizard']) {
    const found = jobs.filter((job) => job.name === name);

    if (
      found.length !== 1 ||
      found[0].status !== 'success' ||
      found[0].allow_failure !== false ||
      found[0].commit?.id !== pipeline.sha ||
      found[0].pipeline?.id !== pipeline.id
    ) {
      throw Error('All required native source and delivery checks must succeed.');
    }
  }
  const publishers = jobs.filter((job) => job.name === 'deploy:github');
  const publisher = publishers[0];

  if (
    publishers.length > 1 ||
    (publisher &&
      (publisher.allow_failure !== false ||
        publisher.commit?.id !== pipeline.sha ||
        publisher.pipeline?.id !== pipeline.id))
  ) {
    throw Error('Public mirror job identity changed.');
  }

  const failures = jobs.filter(
    (job) =>
      job.allow_failure === false && job.name !== 'deploy:github' && job.status !== 'success',
  );

  if (
    failures.length ||
    (pipeline.status !== 'success' && (!publisher || publisher.status === 'success'))
  ) {
    throw Error('Native Wizard pipeline failed outside the optional public mirror.');
  }

  return { mirrorFailed: publisher?.status === 'failed', status: publisher?.status || 'absent' };
}
export async function evidence(
  get: SourceGet,
  input: ManagedReceipt,
  pipelineId: number,
  sourceCommit: string,
  expectedImage: string,
  onVerifiedFiles?: (files: Map<string, Buffer>) => void,
) {
  const receipt = validate(input);
  const getAs = async <T>(route: string) => (await get(route)) as T;
  const r = receipt.repository,
    prefix = 'projects/' + r.id + '/';
  // All routes are known from this invocation's exact binding and pipeline.
  // Fetch the related project, pipeline and job evidence together through the native API.
  const [project, pipeline, jobs, files] = await Promise.all([
    getAs<NativeProject>(prefix.slice(0, -1)),
    getAs<NativePipeline>(prefix + 'pipelines/' + pipelineId),
    getAs<NativeJob[]>(
      prefix + 'pipelines/' + pipelineId + '/jobs?per_page=100&include_retried=false',
    ),
    Promise.all(
      receipt.sourcePrimary.ciFiles.map(async (file) => {
        const row = await getAs<FileRow>(
          prefix + 'repository/files/' + encodeURIComponent(file.path) + '?ref=' + sourceCommit,
        );
        const content = repositoryFileContent(file.path, row);

        if (repositoryFileHash(file.path, row) !== file.sha256) {
          throw Error('Approved native Wizard CI changed.');
        }

        return [file.path, content] as const;
      }),
    ),
  ]);

  if (
    project.id !== r.id ||
    project.path_with_namespace !== r.path ||
    project.namespace?.id !== receipt.namespaceId ||
    project.default_branch !== r.defaultBranch ||
    project.visibility !== 'private' ||
    project.ci_config_path !== ci ||
    project.only_allow_merge_if_pipeline_succeeds !== true ||
    project.only_allow_merge_if_all_discussions_are_resolved !== true
  ) {
    throw Error('Canonical source-primary project identity or merge gates changed.');
  }

  if (
    pipeline.id !== pipelineId ||
    pipeline.sha !== sourceCommit ||
    pipeline.ref !== r.defaultBranch ||
    pipeline.source !== 'push' ||
    pipeline.yaml_errors
  ) {
    throw Error('Require the exact successful native default-branch push pipeline.');
  }

  const publishing = pipelineChecks(pipeline, jobs);
  const artifacts = await Promise.all(
    [
      ['build:wizard', 'build-evidence.json'],
      ['test:wizard', 'wizard-evidence.json'],
    ].map(async ([name, file]) => {
      const matches = jobs.filter((job) => job.name === name);

      if (matches.length !== 1) {
        throw Error('Expected one required native Wizard job.');
      }

      const job = matches[0];

      if (
        job.status !== 'success' ||
        job.allow_failure !== false ||
        job.commit?.id !== sourceCommit ||
        job.pipeline?.id !== pipelineId
      ) {
        throw Error('Native Wizard checks are not successful and required.');
      }

      const artifact = await getAs<ArtifactRow>(prefix + 'jobs/' + job.id + '/artifacts/' + file);

      if (
        artifact.version !== 1 ||
        artifact.pipelineId !== pipelineId ||
        artifact.sourceCommit !== sourceCommit ||
        artifact.imageRef !== expectedImage
      ) {
        throw Error('Native Wizard evidence identity changed.');
      }

      return artifact;
    }),
  );
  const [build, smoke] = artifacts;

  if (
    !['unitTests', 'lint', 'typecheck', 'productionBuild'].every((key) => build[key] === true) ||
    build.testRunner !== 'vitest' ||
    !['http', 'renderedUI', 'projects', 'spa', 'configurationBackup', 'cubeSignature'].every(
      (key) => smoke[key] === true,
    )
  ) {
    throw Error('Native Wizard evidence is incomplete.');
  }

  // A caller may compare the already verified bytes again within this call.
  // They are never retained across invocations or added to the public proof.
  if (onVerifiedFiles) {
    onVerifiedFiles(
      new Map(files.filter((file): file is readonly [string, Buffer] => file[1] !== undefined)),
    );
  }

  return { project, pipeline, build, smoke, publishing };
}
export function environment(file: string) {
  return path.join(path.dirname(path.dirname(file)), '.docker.env');
}
