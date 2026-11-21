import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GitlabDatabaseService, type GitlabDatabasePort } from './gitlab-database.service';

export interface GitlabDataSamplePort extends GitlabDatabasePort {
  /** Authenticated, local, read-only GitLab API request. Never create credentials here. */
  get(route: string): Promise<unknown>;
}
function requireValue(value: unknown): asserts value {
  if (!value) throw Error('read-only-data-sample-unavailable');
}
function record(value: unknown): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function id(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
/** Bounded identity samples; only the digest and count leave the operation. */
@Injectable()
export class GitlabDataSampleService {
  constructor(private readonly database: GitlabDatabaseService) {}

  async sample(containerId: string, port: GitlabDataSamplePort) {
    const session = await this.database.open(containerId, port);
    try {
      const select = async (table: string, columns: string, valid: (row: unknown[]) => boolean) => {
        // Table and column expressions are fixed below, never supplied by the caller.
        const raw = await session.query(
          session.main,
          `SELECT COALESCE(json_agg(sample.value ORDER BY sample.id), '[]'::json) FROM ` +
            `(SELECT id, json_build_array(${columns}) AS value FROM public.${table} ORDER BY id LIMIT 10) sample`,
        );
        let rows: unknown;
        try {
          rows = JSON.parse(raw);
        } catch {
          throw Error('read-only-data-sample-unavailable');
        }
        requireValue(Array.isArray(rows) && rows.length <= 10);
        let previous = 0;
        for (const row of rows) {
          requireValue(Array.isArray(row) && id(row[0]) && Number(row[0]) > previous && valid(row));
          previous = Number(row[0]);
        }
        return rows as unknown[][];
      };
      const projectIds = await select('projects', 'id', (row) => row.length === 1);
      const projects: unknown[][] = [];
      for (const [projectId] of projectIds) {
        const project = record(await port.get(`projects/${projectId}`));
        requireValue(
          project.id === projectId &&
            typeof project.path_with_namespace === 'string' &&
            project.path_with_namespace.length > 0 &&
            typeof project.empty_repo === 'boolean',
        );
        let head: string | null = null;
        if (!project.empty_repo) {
          const commit = record(await port.get(`projects/${projectId}/repository/commits/HEAD`));
          requireValue(
            typeof commit.id === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.id),
          );
          head = commit.id;
        }
        projects.push([projectId, project.path_with_namespace, head]);
      }
      const users = await select(
        'users',
        'id, username',
        (row) => row.length === 2 && typeof row[1] === 'string',
      );
      const issues = await select(
        'issues',
        'id, project_id, iid',
        (row) =>
          row.length === 3 && (row[1] === null || id(row[1])) && (row[2] === null || id(row[2])),
      );
      const mergeRequests = await select(
        'merge_requests',
        'id, target_project_id, iid',
        (row) => row.length === 3 && (row[1] === null || id(row[1])) && id(row[2]),
      );
      const registries = await select(
        'container_repositories',
        'id, project_id, name',
        (row) => row.length === 3 && id(row[1]) && (row[2] === null || typeof row[2] === 'string'),
      );
      return {
        format: 'system-upgrade-data-sample-v1',
        sha256: createHash('sha256')
          .update(JSON.stringify({ projects, users, issues, mergeRequests, registries }))
          .digest('hex'),
        sampledProjects: projects.length,
        scope: 'up-to-ten-existing-records-per-kind-and-project-repository-heads',
      };
    } finally {
      await session.close();
    }
  }
}
