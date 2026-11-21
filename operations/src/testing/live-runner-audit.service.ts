import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { RuntimeVerificationService } from '../host-bootstrap/runtime-verification.service';
import { readPrivateInput } from '../host/private-input';
import { writePrivate } from '../host/install';
import { environmentAssignments } from '../runtime/environment-assignments';
import { record, positive } from '../release/source-identity';
import { recoveryReference } from '../host/recovery-manifest';
import {
  LiveAuditAccessService,
  LiveAuditSession,
  requireAudit,
  type LiveAuditInput,
} from './live-audit-access.service';
import { auditCube } from './live-project-audit.service';
export interface RunnerAuditInput extends LiveAuditInput {
  allowDisposableProject: boolean;
  configuration: string;
  jobImage: string;
  timeout: number;
}
/** Explicit disposable-only acceptance. Existing controller credentials are never revoked. */
@Injectable()
export class LiveRunnerAuditService {
  constructor(
    readonly access: LiveAuditAccessService,
    readonly runtime: RuntimeVerificationService,
  ) {}
  async execute(input: RunnerAuditInput) {
    requireAudit(
      input.allowDisposableProject === true,
      'explicit-disposable-project-opt-in-required',
    );
    requireAudit(
      Number.isInteger(input.timeout) && input.timeout >= 1 && input.timeout <= 900,
      'bounded-timeout-required',
    );
    requireAudit(
      recoveryReference(input.jobImage) && /@sha256:[a-f0-9]{64}$/.test(input.jobImage),
      'immutable-job-image-required',
    );
    requireAudit(path.isAbsolute(input.configuration), 'absolute-configuration-required');
    const session = await this.access.open(input),
      deadline = Date.now() + input.timeout * 1000;
    await session.setupRevoked('runner');
    let runner: Record<string, unknown>;
    while (true) {
      const pools = (await session.pages('runners/all')).filter(
        (value) => value.description === 'System Bootstrapper Docker pool',
      );
      requireAudit(
        pools.length === 1 && positive(pools[0].id) && pools[0].runner_type === 'instance_type',
        'unique-instance-runner-required',
      );
      runner = record(await session.json('GET', 'runners/' + pools[0].id));
      requireAudit(
        runner.id === pools[0].id && runner.runner_type === 'instance_type',
        'runner-identity-changed',
      );
      if (runner.status === 'online') break;
      await this.wait(deadline, input.signal);
    }
    await this.fetch(input, session.authority.credential.token);
    const operation = randomBytes(16).toString('hex'),
      name = 'runner-automation-smoke-' + operation,
      projectPath = session.authority.account.username + '/' + name,
      marker = 'system-bootstrapper-live-runner:' + operation,
      tokenName = 'live-runner-' + operation;
    let attempted = false,
      projectId: number | undefined,
      scopedToken: string | undefined;
    const receiptFile = path.join(
      path.dirname(input.configuration),
      'live-runner-audit-' + operation + '.json',
    );
    const receipt: Record<string, unknown> = {
      format: 'system-live-runner-audit-v1',
      operation,
      projectPath,
      marker,
      tokenName,
    };
    const save = (phase: string) => {
      receipt.phase = phase;
      writePrivate(receiptFile, Buffer.from(JSON.stringify(receipt) + '\n'));
    };
    save('prepared');
    // Cancellation must not skip the cleanup of this exact disposable project and its tokens.
    const cleanup = new LiveAuditSession(session.api, {
      ...session.authority,
      context: { ...session.authority.context, signal: undefined },
    });
    const owned = (value: unknown) => this.ownedProject(value, receipt);
    try {
      requireAudit(
        (await session.call('GET', 'projects/' + encodeURIComponent(projectPath))).status === 404,
        'disposable-project-path-occupied',
      );
      attempted = true;
      save('project-create-requested');
      const project = owned(
        await session.json(
          'POST',
          'projects',
          {
            name,
            path: name,
            description: marker,
            visibility: 'private',
            auto_devops_enabled: false,
            initialize_with_readme: true,
          },
          [201],
        ),
      );
      projectId = Number(project.id);
      receipt.projectId = projectId;
      save('project-created');
      requireAudit(
        typeof project.default_branch === 'string' && project.default_branch.length > 0,
        'default-branch-required',
      );
      const expiresAt = new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        token = record(
          await session.json(
            'POST',
            `projects/${projectId}/access_tokens`,
            { name: tokenName, scopes: ['api'], access_level: 40, expires_at: expiresAt },
            [201],
          ),
        );
      requireAudit(
        positive(token.id) &&
          token.name === tokenName &&
          token.expires_at === expiresAt &&
          token.access_level === 40 &&
          token.active === true &&
          token.revoked === false &&
          Array.isArray(token.scopes) &&
          token.scopes.length === 1 &&
          token.scopes[0] === 'api' &&
          typeof token.token === 'string' &&
          token.token.length > 0 &&
          !/[\r\n\0]/.test(token.token),
        'scoped-project-token-invalid',
      );
      scopedToken = token.token;
      receipt.scopedTokenId = token.id;
      save('scoped-token-created');
      const pipeline = `stages: [test]\nrunner-smoke:\n  image: ${JSON.stringify(input.jobImage)}\n  tags: [docker]\n  script:\n    - echo runner-automation-ok > runner-result.txt\n    - test -n "$CI_RUNNER_ID"\n  artifacts:\n    paths: [runner-result.txt]\n`;
      await session.json(
        'POST',
        `projects/${projectId}/repository/files/.gitlab-ci.yml`,
        {
          branch: project.default_branch,
          content: pipeline,
          commit_message: 'Verify automatically registered instance runner',
        },
        [201],
        scopedToken,
      );
      let pipelineId: number;
      while (true) {
        const pipelines = await session.pages(`projects/${projectId}/pipelines`, scopedToken);
        requireAudit(pipelines.length <= 1, 'duplicate-smoke-pipeline');
        if (pipelines.length) {
          requireAudit(positive(pipelines[0].id), 'pipeline-identity-invalid');
          const value = record(
            await session.json(
              'GET',
              `projects/${projectId}/pipelines/${pipelines[0].id}`,
              undefined,
              [200],
              scopedToken,
            ),
          );
          requireAudit(value.id === pipelines[0].id, 'pipeline-identity-changed');
          if (value.status === 'success') {
            pipelineId = Number(value.id);
            break;
          }
          requireAudit(
            !['failed', 'canceled', 'skipped', 'manual'].includes(String(value.status)),
            'runner-pipeline-not-successful',
          );
        }
        await this.wait(deadline, input.signal);
      }
      const jobs = await session.pages(
        `projects/${projectId}/pipelines/${pipelineId}/jobs`,
        scopedToken,
      );
      requireAudit(
        jobs.length === 1 &&
          jobs[0].name === 'runner-smoke' &&
          jobs[0].status === 'success' &&
          positive(jobs[0].id) &&
          record(jobs[0].runner).id === runner.id,
        'smoke-job-runner-mismatch',
      );
      const artifact = await session.api.readBytes(
        session.authority.context,
        scopedToken,
        `projects/${projectId}/jobs/${jobs[0].id}/artifacts/runner-result.txt`,
      );
      requireAudit(
        artifact.status === 200 && artifact.bytes.toString().trim() === 'runner-automation-ok',
        'smoke-artifact-mismatch',
      );
      await session.setupRevoked('runner');
      receipt.acceptancePassed = true;
      save('acceptance-passed');
      return {
        operationRecord: receiptFile,
        uniqueOnlineInstanceRunner: true,
        setupCredentialsRevoked: true,
        authenticatedFetchVerified: true,
        pipelineSucceeded: true,
        runnerMatched: true,
        artifactVerified: true,
        disposableProjectDeletionRequested: true,
        scopedCredentialRevoked: true,
      };
    } finally {
      if (attempted) {
        save('cleanup-started');
        await this.performCleanup(cleanup, receipt, scopedToken);
        save('cleanup-complete');
      }
    }
  }
  /** Reconcile only the resources named by a retained private audit record. */
  async cleanup(input: LiveAuditInput & { allowDisposableProject: boolean; recordFile: string }) {
    requireAudit(
      input.allowDisposableProject === true,
      'explicit-disposable-project-opt-in-required',
    );
    requireAudit(path.isAbsolute(input.recordFile), 'absolute-cleanup-record-required');
    const receipt = record(JSON.parse(readPrivateInput(input.recordFile).toString())),
      operation = receipt.operation;
    requireAudit(
      receipt.format === 'system-live-runner-audit-v1' &&
        typeof operation === 'string' &&
        /^[a-f0-9]{32}$/.test(operation),
      'cleanup-record-invalid',
    );
    const session = await this.access.open(input),
      projectPath = session.authority.account.username + '/runner-automation-smoke-' + operation;
    requireAudit(
      receipt.projectPath === projectPath &&
        receipt.marker === 'system-bootstrapper-live-runner:' + operation &&
        receipt.tokenName === 'live-runner-' + operation,
      'cleanup-record-binding-changed',
    );
    await this.performCleanup(session, receipt);
    receipt.phase = 'cleanup-complete';
    writePrivate(input.recordFile, Buffer.from(JSON.stringify(receipt) + '\n'));
    return { scopedCredentialRevocationRequested: true, disposableProjectDeletionRequested: true };
  }
  private ownedProject(value: unknown, receipt: Record<string, unknown>) {
    const project = record(value);
    requireAudit(
      positive(project.id) &&
        project.path_with_namespace === receipt.projectPath &&
        project.description === receipt.marker &&
        project.visibility === 'private' &&
        (receipt.projectId === undefined || project.id === receipt.projectId),
      'disposable-project-ownership-changed',
    );
    return project;
  }
  private async performCleanup(
    session: LiveAuditSession,
    receipt: Record<string, unknown>,
    scopedToken?: string,
  ) {
    const found = await session.call(
      'GET',
      'projects/' + encodeURIComponent(String(receipt.projectPath)),
    );
    requireAudit(found.status === 200 || found.status === 404, 'disposable-cleanup-lookup-failed');
    if (found.status === 404) {
      if (scopedToken)
        requireAudit(
          (await session.call('GET', 'user', undefined, scopedToken)).status === 401,
          'scoped-project-token-still-active',
        );
      return;
    }
    const project = this.ownedProject(found.value, receipt),
      id = project.id;
    const tokens = (await session.pages(`projects/${id}/access_tokens`)).filter(
      (value) => value.name === receipt.tokenName,
    );
    requireAudit(tokens.length <= 1, 'ambiguous-scoped-project-token');
    for (const token of tokens) {
      requireAudit(positive(token.id), 'scoped-project-token-invalid');
      if (token.revoked !== true)
        await session.json('DELETE', `projects/${id}/access_tokens/${token.id}`, undefined, [204]);
    }
    if (scopedToken)
      requireAudit(
        (await session.call('GET', 'user', undefined, scopedToken)).status === 401,
        'scoped-project-token-still-active',
      );
    // Compare the exact path, marker and immutable ID immediately before deleting.
    const current = this.ownedProject(await session.json('GET', 'projects/' + id), receipt);
    requireAudit(current.id === id, 'disposable-project-ownership-changed');
    await session.json('DELETE', 'projects/' + id, undefined, [202, 204]);
  }
  private async fetch(input: RunnerAuditInput, administrator: string) {
    const raw = readPrivateInput(input.configuration),
      values = environmentAssignments(raw.toString());
    const auth = path.join(path.dirname(input.configuration), 'sync-auth.env');
    const credentials = {
      ...(fs.existsSync(auth) ? environmentAssignments(readPrivateInput(auth).toString()) : {}),
      ...values,
    };
    requireAudit(
      typeof credentials.GITLAB_RUNNER_TOKEN === 'string' &&
        credentials.GITLAB_RUNNER_TOKEN.startsWith('glrt-'),
      'runner-token-required',
    );
    const response = await this.runtime.http('http://127.0.0.1:8071/login', input.signal, {
      username: credentials.SYNC_USER,
      password: credentials.SYNC_PASS,
    });
    requireAudit(response.status === 200, 'Sync-authentication-failed');
    const token = record(JSON.parse(response.body.toString())).accessToken;
    requireAudit(typeof token === 'string' && token.length > 0, 'Sync-token-unavailable');
    const fetched = await this.runtime.http(
      'http://127.0.0.1:8071/config/main',
      input.signal,
      undefined,
      { Authorization: 'Bearer ' + token },
    );
    const content = record(JSON.parse(fetched.body.toString())).data;
    requireAudit(
      fetched.status === 200 && typeof content === 'string',
      'authenticated-Fetch-failed',
    );
    auditCube(Buffer.from(content));
    requireAudit(content === raw.toString(), 'Fetch-configuration-changed');
    requireAudit(
      content.includes(credentials.GITLAB_RUNNER_TOKEN) && !content.includes(administrator),
      'Fetch-token-isolation-failed',
    );
  }
  private async wait(deadline: number, signal?: AbortSignal) {
    requireAudit(!signal?.aborted, 'interrupted');
    requireAudit(Date.now() < deadline, 'pipeline-timeout');
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000, deadline - Date.now())));
    requireAudit(!signal?.aborted, 'interrupted');
  }
}
