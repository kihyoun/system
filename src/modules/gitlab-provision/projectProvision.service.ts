import { Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { GitlabCredentialService } from './credential.service';
import {
  GitlabNativeApiService,
  type GitlabMethod,
  type GitlabApiResult,
} from './nativeApi.service';
type Row = Record<string, unknown>;
type Request = (method: GitlabMethod, route: string, body?: unknown) => Promise<GitlabApiResult>;
class ProjectProvisionError extends Error {}
function ensure(value: unknown, message: string): asserts value {
  if (!value) {
    throw new ProjectProvisionError(message);
  }
}
function row(value: unknown): Row {
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'Invalid project operation');
  return value as Row;
}
function text(value: unknown): string {
  ensure(typeof value === 'string', 'Invalid project operation');
  return value;
}
const ciPath = '.system-bootstrapper/ci.yml';
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
  );
/** Own-project creation and receipt reconciliation through GitLab's documented local API. */
@Injectable()
export class ProjectProvisionService {
  constructor(
    private readonly credentials: GitlabCredentialService,
    private readonly api: GitlabNativeApiService,
  ) {}

  async execute(checkout: string, value: unknown, signal?: AbortSignal): Promise<Row> {
    let mutated = false;
    try {
      const input = row(value),
        action = text(input.action);
      ensure(
        ['namespaces', 'availability', 'create', 'pipeline'].includes(action),
        'Invalid project operation',
      );

      if (action !== 'namespaces') {
        ensure(
          typeof input.projectKey === 'string' &&
            /^[a-z0-9]+$/.test(input.projectKey) &&
            !/[\r\n]/.test(input.projectKey),
          'Invalid Project Key',
        );
        ensure(
          /^[1-9][0-9]*$/.test(String(input.namespaceId)) &&
            Number.isSafeInteger(Number(input.namespaceId)),
          'Namespace lookup failed',
        );
      }

      if (action === 'create' || action === 'pipeline') {
        ensure(
          typeof input.operation === 'string' &&
            input.operation.length > 0 &&
            input.operation.length <= 256 &&
            !/[\r\n\0]/.test(input.operation),
          'Invalid project operation',
        );
      }

      if (action === 'create' && !input.resumeRepository) {
        text(input.ci);

        if (input.files !== undefined) {
          ensure(
            Array.isArray(input.files) &&
              input.files.every((value) => {
                const file = row(value);
                return (
                  file.action === 'create' &&
                  typeof file.file_path === 'string' &&
                  !file.file_path.startsWith('/') &&
                  !file.file_path.split('/').some((part) => ['', '.', '..'].includes(part)) &&
                  !/[\r\n\0]/.test(file.file_path) &&
                  typeof file.content === 'string'
                );
              }),
            'Invalid application template files',
          );
        }
      }

      const authorization = await this.credentials.ensure({ checkout, signal });
      const request: Request = async (method, route, body) => {
        signal?.throwIfAborted();

        if (method !== 'GET') {
          mutated = true;
        }

        return this.api.request(
          authorization.context,
          authorization.credential.token,
          method,
          route,
          body,
        );
      };

      if (action === 'namespaces') {
        const namespaces: Row[] = [];
        for (let page = 1; page <= 10000; page++) {
          const result = await request('GET', `namespaces?per_page=100&page=${page}`);
          ensure(result.status === 200 && Array.isArray(result.value), 'Namespace lookup failed');
          namespaces.push(
            ...result.value.map((value) => {
              const item = row(value);
              ensure(
                Number.isSafeInteger(item.id) && typeof item.full_path === 'string',
                'Namespace lookup failed',
              );
              return { id: item.id, path: item.full_path };
            }),
          );

          if (result.value.length < 100) {
            return { namespaces };
          }
        }
        throw new ProjectProvisionError('Namespace lookup failed');
      }

      const namespaceId = Number(input.namespaceId),
        namespace = await request('GET', `namespaces/${namespaceId}`);
      ensure(namespace.status === 200, 'Namespace lookup failed');
      const fullPath = text(row(namespace.value).full_path) + '/' + input.projectKey;
      let lookup = await request('GET', 'projects/' + encode(fullPath));
      ensure([200, 404].includes(lookup.status), 'Project lookup failed');

      if (action === 'availability') {
        return { availability: lookup.status === 404 ? 'available' : 'occupied', path: fullPath };
      }

      const marker = 'System Bootstrapper operation ' + input.operation;

      if (action === 'pipeline') {
        return await this.pipeline(request, lookup, marker);
      }

      if (input.resumeRepository) {
        return await this.resume(request, input, lookup, namespaceId, fullPath, marker);
      }

      if (lookup.status === 200 && row(lookup.value).description !== marker) {
        return {
          state: 'failed',
          conflict: true,
          message: 'Repository already exists in the selected namespace.',
        };
      }

      if (lookup.status === 404) {
        lookup = await request('POST', 'projects', {
          name: input.projectKey,
          path: input.projectKey,
          namespace_id: namespaceId,
          visibility: 'private',
          description: marker,
          initialize_with_readme: true,
        });

        if (lookup.status !== 201) {
          return {
            state: 'failed',
            conflict: [400, 409].includes(lookup.status),
            message: `GitLab rejected project creation (HTTP ${lookup.status}); check namespace permissions, reserved names or a competing creation.`,
          };
        }
      }

      const project = row(lookup.value);
      ensure(
        project.path_with_namespace === fullPath &&
          project.visibility === 'private' &&
          project.description === marker &&
          row(project.namespace).id === namespaceId,
        'Unexpected project identity',
      );
      const branch = project.default_branch;
      ensure(
        typeof branch === 'string' && branch.length > 0,
        'Default branch not ready; retry Save',
      );
      ensure(
        Number.isSafeInteger(project.id) && Number(project.id) > 0,
        'Unexpected project identity',
      );
      const file = await request(
        'GET',
        `projects/${project.id}/repository/files/${encode(ciPath)}?ref=${encode(branch)}`,
      );
      ensure([200, 404].includes(file.status), 'CI lookup failed');

      if (file.status === 404) {
        // Administrative API access does not grant push rights on a protected branch.
        // Only the exact owned project's missing CI installation needs membership.
        await this.controllerMembership(request, Number(project.id), authorization.account.id);
        await this.controllerPushReadiness(
          (readSignal) =>
            this.api.request(
              { ...authorization.context, signal: readSignal },
              authorization.credential.token,
              'GET',
              `projects/${project.id}/repository/branches/${encode(branch)}`,
            ),
          branch,
          signal,
        );
        const commit = await request('POST', `projects/${project.id}/repository/commits`, {
          branch,
          commit_message: input.files
            ? 'Install application template and managed CI'
            : 'Install managed application CI [skip ci]',
          actions: [
            { action: 'create', file_path: ciPath, content: input.ci },
            ...((input.files as unknown[]) || []),
          ],
        });

        if (commit.status !== 201) {
          return {
            state: 'failed',
            message: 'CI installation failed; retry Save',
            ...(Number.isInteger(commit.status) && commit.status >= 100 && commit.status <= 599
              ? { diagnostic: { phase: 'managed-ci-commit', httpStatus: commit.status } }
              : {}),
          };
        }
      } else {
        ensure(
          Buffer.from(text(row(file.value).content), 'base64').toString('utf8') === input.ci,
          'Managed CI changed; refusing to overwrite repository content',
        );
      }

      const update = await request('PUT', `projects/${project.id}`, { ci_config_path: ciPath });
      ensure(update.status === 200, 'CI activation failed; retry Save');
      return {
        repository: {
          id: project.id,
          namespaceId,
          path: fullPath,
          webUrl: text(project.web_url),
          defaultBranch: branch,
          pipelineUrl: text(project.web_url) + '/-/pipelines',
          ciPath,
          template: input.template || 'empty',
          templateVersion: input.templateVersion ?? null,
          generatedCi: input.files ? input.ci : null,
          deploymentState: input.files ? 'awaiting-pipeline' : 'awaiting-source',
        },
      };
    } catch (error) {
      if (error instanceof ProjectProvisionError) {
        return { state: 'failed', message: error.message };
      }

      if (
        mutated ||
        (error && typeof error === 'object' && 'uncertain' in error && error.uncertain === true)
      ) {
        throw Object.assign(
          Error('GitLab operation completion was not confirmed; inspect the recorded operation.'),
          { uncertain: true },
        );
      }

      return {
        state: 'failed',
        message:
          'GitLab operation failed. Check readiness and namespace permissions, then retry Save.',
      };
    }
  }

  private async controllerPushReadiness(
    read: (signal: AbortSignal) => Promise<GitlabApiResult>,
    branch: string,
    signal?: AbortSignal,
  ) {
    const deadline = new AbortController();
    const readSignal = AbortSignal.any([deadline.signal, ...(signal ? [signal] : [])]);
    // Leave the native process adapter its existing five-second cancellation reap window.
    const timer = setTimeout(() => deadline.abort(), 5000);
    try {
      while (!readSignal.aborted) {
        const response = await read(readSignal);
        readSignal.throwIfAborted();
        ensure(response.status === 200, 'CI installation failed; retry Save');
        const proof = row(response.value),
          commit = row(proof.commit);
        ensure(
          proof.name === branch &&
            proof.default === true &&
            typeof proof.can_push === 'boolean' &&
            typeof commit.id === 'string' &&
            /^[a-f0-9]{40}$/.test(commit.id),
          'CI installation failed; retry Save',
        );

        if (proof.can_push) {
          return;
        }

        // Membership and its effective protected-branch authorization settle separately.
        // Only a valid negative observation can be polled; writes are never retried.
        await delay(200, undefined, { signal: readSignal });
      }
      throw new ProjectProvisionError('CI installation failed; retry Save');
    } catch {
      signal?.throwIfAborted();
      throw new ProjectProvisionError('CI installation failed; retry Save');
    } finally {
      clearTimeout(timer);
    }
  }

  private async controllerMembership(request: Request, projectId: number, accountId: number) {
    ensure(
      Number.isSafeInteger(accountId) && accountId > 0,
      'Controller project member identity is invalid',
    );
    const members = `projects/${projectId}/members`,
      memberPath = `${members}/${accountId}`;
    const access = (value: unknown): number => {
      const member = row(value);
      ensure(member.id === accountId, 'Controller project member identity changed');
      ensure(
        member.state === 'active' &&
          (member.membership_state === undefined || member.membership_state === 'active') &&
          member.expires_at === null,
        'Controller project membership must be active and permanent',
      );
      ensure(
        Number.isSafeInteger(member.access_level) &&
          Number(member.access_level) >= 0 &&
          Number(member.access_level) <= 50,
        'Controller project member access is invalid',
      );
      return Number(member.access_level);
    };
    const current = await request('GET', memberPath);
    ensure([200, 404].includes(current.status), 'Controller project membership lookup failed');

    if (current.status === 200 && access(current.value) >= 40) {
      return;
    }

    const update =
      current.status === 404
        ? await request('POST', members, { user_id: accountId, access_level: 40 })
        : await request('PUT', memberPath, { access_level: 40 });
    ensure(
      update.status === (current.status === 404 ? 201 : 200) || update.status === 409,
      'Controller project membership update failed',
    );
    const verified = await request('GET', memberPath);
    ensure(
      verified.status === 200 && access(verified.value) >= 40,
      'Controller project Maintainer membership was not confirmed',
    );
  }

  private async resume(
    request: Request,
    input: Row,
    lookup: GitlabApiResult,
    namespaceId: number,
    fullPath: string,
    marker: string,
  ): Promise<Row> {
    const repository = row(input.resumeRepository),
      project = lookup.status === 200 ? row(lookup.value) : {};
    ensure(
      lookup.status === 200 &&
        Number.isSafeInteger(repository.id) &&
        Number(repository.id) > 0 &&
        project.id === repository.id &&
        repository.path === fullPath &&
        project.path_with_namespace === fullPath &&
        Number.isSafeInteger(repository.namespaceId) &&
        repository.namespaceId === namespaceId &&
        row(project.namespace).id === namespaceId &&
        project.visibility === 'private' &&
        project.description === marker &&
        typeof repository.defaultBranch === 'string' &&
        repository.defaultBranch.length > 0 &&
        project.default_branch === repository.defaultBranch &&
        repository.ciPath === ciPath &&
        project.ci_config_path === ciPath,
      'Pending repository identity changed; inspect the saved operation',
    );
    const file = await request(
      'GET',
      `projects/${repository.id}/repository/files/${encode(ciPath)}?ref=${encode(repository.defaultBranch)}`,
    );
    ensure(
      file.status === 200,
      'Pending repository managed CI is missing; inspect the saved operation',
    );
    return { repository };
  }

  private async pipeline(request: Request, lookup: GitlabApiResult, marker: string): Promise<Row> {
    const project = lookup.status === 200 ? row(lookup.value) : {};
    ensure(
      lookup.status === 200 && project.description === marker,
      'Cannot start pipeline for an unrelated project',
    );
    const branch = text(project.default_branch),
      id = project.id;
    ensure(Number.isSafeInteger(id) && Number(id) > 0, 'Unexpected project identity');
    const file = await request(
      'GET',
      `projects/${id}/repository/files/%2Esystem-bootstrapper%2Fci.yml?ref=${encode(branch)}`,
    );
    ensure(file.status === 200, 'Managed CI missing');
    const sha = text(row(file.value).last_commit_id),
      result = await request(
        'GET',
        `projects/${id}/pipelines?sha=${encode(sha)}&ref=${encode(branch)}`,
      );
    ensure(
      result.status === 200 && Array.isArray(result.value),
      'Pipeline lookup failed; retry Save',
    );
    let pipeline = result.value.map(row).find((item) => item.source === 'api');

    if (!pipeline) {
      const created = await request('POST', `projects/${id}/pipeline`, { ref: branch });
      ensure(created.status === 201, `Pipeline start failed (HTTP ${created.status}); retry Save`);
      pipeline = row(created.value);
    }

    ensure(
      Number.isSafeInteger(pipeline.id) &&
        Number(pipeline.id) > 0 &&
        typeof pipeline.web_url === 'string' &&
        typeof pipeline.status === 'string',
      'Pipeline lookup failed; retry Save',
    );
    return { pipeline: { id: pipeline.id, webUrl: pipeline.web_url, status: pipeline.status } };
  }
}
