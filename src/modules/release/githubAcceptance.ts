import * as path from 'node:path';
import type { HubContext } from './dockerhubPublication';
import type { Environment } from './types';
import {
  boundedReleaseInput,
  publicationHash,
  publicationRecord,
  requirePublication,
  type PublicationApi,
} from './githubTransport';
export interface GithubContext extends HubContext {
  version: string;
  tag: string;
  repository: string;
  hostInstallerSha256?: string;
}
export interface PublicationJob {
  id: number;
  name: string;
  status: string;
  allow_failure: boolean;
  pipeline: { id: number };
  commit: { id: string };
}
export function githubContext(
  env: Environment,
  root: string,
  hubContext: (env: Environment) => HubContext,
): GithubContext {
  requirePublication(
    env.GITLAB_CI === 'true' &&
      env.GITHUB_RELEASE_PUBLISH_ENABLED === 'true' &&
      env.GITHUB_BACKUP_ENABLED === 'true' &&
      !env.CI_COMMIT_TAG &&
      env.CI_COMMIT_BRANCH === env.CI_DEFAULT_BRANCH,
    'Protected native default-branch accepted release required.',
  );
  const ci = hubContext(env),
    version = boundedReleaseInput(path.join(root, 'VERSION')).toString().trim();
  const repository = env.GITHUB_RELEASE_REPOSITORY;
  requirePublication(
    /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(version) &&
      typeof repository === 'string' &&
      /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository) &&
      !repository.split('/').some((part) => ['.', '..'].includes(part)),
    'Reviewed product version and GitHub repository required.',
  );
  return { ...ci, version, tag: 'v' + version, repository };
}
function job(value: unknown): PublicationJob {
  const row = publicationRecord(value),
    pipeline = publicationRecord(row.pipeline),
    commit = publicationRecord(row.commit);
  requirePublication(
    Number.isSafeInteger(row.id) &&
      Number(row.id) > 0 &&
      typeof row.name === 'string' &&
      typeof row.status === 'string' &&
      typeof row.allow_failure === 'boolean' &&
      Number.isSafeInteger(pipeline.id) &&
      typeof commit.id === 'string',
    'GitLab job identity unavailable.',
  );
  return {
    id: Number(row.id),
    name: row.name,
    status: row.status,
    allow_failure: row.allow_failure,
    pipeline: { id: Number(pipeline.id) },
    commit: { id: commit.id },
  };
}
export async function githubGates(
  ci: GithubContext,
  env: Environment,
  root: string,
  gitlab: PublicationApi,
  sourceLayout?: unknown,
): Promise<PublicationJob[]> {
  const prefix = '/projects/' + ci.projectId;
  const project = publicationRecord(await gitlab(prefix)),
    pipeline = publicationRecord(await gitlab(prefix + '/pipelines/' + ci.pipelineId));
  requirePublication(
    project.only_allow_merge_if_pipeline_succeeds === true &&
      project.default_branch === env.CI_DEFAULT_BRANCH &&
      pipeline.sha === ci.sourceRevision &&
      pipeline.ref === env.CI_DEFAULT_BRANCH &&
      pipeline.source === 'push' &&
      ['running', 'success'].includes(String(pipeline.status)),
    'Required GitLab acceptance and merge gate missing.',
  );
  const branch = publicationRecord(
    await gitlab(prefix + '/repository/branches/' + encodeURIComponent(env.CI_DEFAULT_BRANCH!)),
  );
  requirePublication(
    branch.protected === true && publicationRecord(branch.commit).id === ci.sourceRevision,
    'Accepted protected source must remain current.',
  );
  const jobs: PublicationJob[] = [];
  for (let page = 1; page <= 20; page++) {
    const rows = await gitlab(
      prefix +
        '/pipelines/' +
        ci.pipelineId +
        '/jobs?include_retried=false&per_page=100&page=' +
        page,
    );
    requirePublication(Array.isArray(rows), 'GitLab jobs unavailable.');
    jobs.push(...rows.map(job));

    if (rows.length < 100) {
      break;
    }

    requirePublication(page < 20, 'GitLab job enumeration too large.');
  }
  const required = [
    ...(sourceLayout === 'system-monorepo-v1' ? ['test:npm-package'] : []),
    'check:documentation',
    'prepare:wizard-source',
    'test:candidate-image',
    'test:platform-candidate',
    'build',
    'test:wizard-browser',
    'test:codeql',
    'deploy:dockerhub',
    'deploy:github',
    ...[
      'gitlab',
      'sync',
      'gitlab-runner',
      'bootstrapper',
      'nginx',
      'wizard',
      'shared',
      'performance',
    ].map((value) => 'test:isolated: [' + value + ']'),
  ];
  for (const name of required) {
    const rows = jobs.filter((row) => row.name.replace(/:\s*\[/, ': [') === name);
    requirePublication(
      rows.length === 1 &&
        rows[0].status === 'success' &&
        rows[0].allow_failure === false &&
        rows[0].pipeline.id === ci.pipelineId &&
        rows[0].commit.id === ci.sourceRevision,
      'Every required same-attempt acceptance/publication job must pass.',
    );
  }
  requirePublication(
    !jobs.some(
      (row) => row.id !== ci.publicationJobId && ['failed', 'canceled'].includes(row.status),
    ),
    'A pipeline job failed.',
  );
  const owners: Record<string, string> = {
    'test-results/successor/release.json': 'test:platform-candidate',
    'test-results/successor/candidate-results.json': 'test:platform-candidate',
    'test-results/dockerhub/release.json': 'deploy:dockerhub',
    ...(sourceLayout === 'system-monorepo-v1'
      ? {}
      : { 'test-results/github/wizard-source.json': 'deploy:github' }),
  };
  for (const [file, owner] of Object.entries(owners)) {
    const ownerJob = jobs.find((row) => row.name === owner)!;
    const bytes = await gitlab(prefix + '/jobs/' + ownerJob.id + '/artifacts/' + file, {
      raw: true,
    });
    requirePublication(
      Buffer.isBuffer(bytes) &&
        publicationHash(bytes) === publicationHash(boundedReleaseInput(path.join(root, file))),
      'Release input differs from its successful CI artifact.',
    );
  }
  return jobs;
}
