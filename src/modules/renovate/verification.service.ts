import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';

export interface RenovateReader {
  get(route: string): Promise<unknown>;
  all(route: string): Promise<unknown[]>;
}
export function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('Invalid Renovate API or private record.');
  }

  return value as Record<string, unknown>;
}
export function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw Error('Expected positive GitLab identity.');
  }

  return value;
}
export function projectIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw Error('Select System and optionally the legacy Wizard.');
  }

  const ids = value.map(positive);

  if (new Set(ids).size !== ids.length) {
    throw Error('Distinct project identities required.');
  }

  return ids;
}

/** Read-only first-discovery acceptance shared by CLI and application callers. */
@Injectable()
export class RenovateVerificationService {
  async inventory(api: RenovateReader, selection: unknown) {
    const inventory: Record<string, { branches: string[]; merge_requests: number[] }> = {};
    for (const id of projectIds(selection)) {
      const branches = (await api.all(`/projects/${id}/repository/branches`)).map((value) => {
        const name = row(value).name;

        if (typeof name !== 'string' || !name) {
          throw Error('Malformed branch inventory.');
        }

        return name;
      });
      const requests = (await api.all(`/projects/${id}/merge_requests?state=all`)).map((value) =>
        positive(row(value).iid),
      );
      inventory[String(id)] = {
        branches: branches.sort(),
        merge_requests: requests.sort((a, b) => a - b),
      };
    }
    return inventory;
  }

  async verify(api: RenovateReader, input: unknown, saved: unknown, initial: unknown) {
    const config = row(input),
      state = row(saved),
      baseline = row(initial);
    const ids = projectIds(config.project_ids),
      user = positive(state.user_id);
    const scheduleId = positive(state.schedule_id);

    if (!isDeepStrictEqual(baseline.project_ids, ids) || baseline.user_id !== user) {
      throw Error('Baseline belongs to another bot/project selection.');
    }

    if (!isDeepStrictEqual(await this.inventory(api, ids), baseline.inventory)) {
      throw Error('Branch or MR inventories changed; investigate before approving anything.');
    }

    const dashboards: { project_id: number; issue_iid: number }[] = [];
    for (const id of ids) {
      const issues = await api.all(
        `/projects/${id}/issues?state=opened&search=Dependency%20Dashboard`,
      );
      const matching = issues
        .map(row)
        .filter((issue) => issue.title === 'Dependency Dashboard' && row(issue.author).id === user);

      if (matching.length !== 1) {
        throw Error('Expected exactly one bot-owned open Dashboard in each source project.');
      }

      dashboards.push({ project_id: id, issue_iid: positive(matching[0].iid) });
    }
    const schedule = row(await api.get(`/projects/${ids[0]}/pipeline_schedules/${scheduleId}`));
    const pipeline = row(schedule.last_pipeline);

    if (pipeline.status !== 'success') {
      throw Error('Owned schedule has no successful latest discovery pipeline.');
    }

    const jobs = await api.all(`/projects/${ids[0]}/pipelines/${positive(pipeline.id)}/jobs`);

    if (
      !jobs.length ||
      jobs.some((value) => {
        const job = row(value);
        return job.name !== 'renovate:discover' || job.status !== 'success';
      })
    ) {
      throw Error('Scheduled pipeline selected unexpected or unsuccessful jobs.');
    }

    return { discovery: 'dashboard-only', dashboards, scheduled_jobs: ['renovate:discover'] };
  }
}
