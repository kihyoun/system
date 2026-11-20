import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GitlabDatabaseService } from '../gitlab-preflight/gitlab-database.service';
import type { LifecycleProcess } from '../runtime/managed-child';
import { GitlabNativeContextService } from './native-context.service';
import { GitlabAuthJournalService } from './auth-journal.service';
import { GitlabNativeApiService, GITLAB_PROVISION_PROCESS } from './native-api.service';
const purposes: Record<string, [string, string]> = {
  RENOVATE_TOKEN: ['Renovate', 'GitLab'],
  SYSTEM_RELEASE_GITLAB_TOKEN: ['Release metadata access', 'GitLab'],
  GITHUB_RELEASE_TOKEN: ['GitHub release publication', 'GitHub'],
  DOCKERHUB_TOKEN: ['Container publication', 'Docker Hub'],
};
function rows(value: string): unknown[] {
  const result: unknown = JSON.parse(value);
  if (!Array.isArray(result)) throw Error('gitlab-token-metadata-invalid');
  return result;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('gitlab-token-metadata-invalid');
  return value as Record<string, unknown>;
}
/** Read-only metadata: no PAT creation/renewal and no external-provider value decryption. */
@Injectable()
export class GitlabTokenMetadataService {
  constructor(
    private readonly contexts: GitlabNativeContextService,
    private readonly databases: GitlabDatabaseService,
    private readonly journals: GitlabAuthJournalService,
    private readonly api: GitlabNativeApiService,
    @Inject(GITLAB_PROVISION_PROCESS) private readonly child: LifecycleProcess,
  ) {}
  async status(
    checkout: string,
    input: unknown,
    signal?: AbortSignal,
    configDirectory = '/srv/gitlab/config',
  ) {
    const projects = row(input).projects;
    if (
      !Array.isArray(projects) ||
      projects.length > 8 ||
      projects.some(
        (value) =>
          typeof value !== 'string' ||
          value.length > 255 ||
          !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(value) ||
          value.split('/').some((part) => part === '.' || part === '..'),
      )
    )
      throw Error('Invalid credential project selection');
    const context = await this.contexts.resolve(checkout, configDirectory, signal);
    // Reading the saved credential does not initialize or renew it. Missing/expired
    // credentials yield unavailable GitLab metadata while key presence stays observable.
    const administrator = await this.journals.withJournal(configDirectory, async (journal) => {
      const state = journal.read();
      return state?.phase === 'ready' ? state.replacement?.token : undefined;
    });
    const database = await this.databases.open(context.containerId, {
      command: (args, seconds, input) =>
        this.child.run('docker', ['--host=unix:///var/run/docker.sock', ...args], {
          cwd: checkout,
          env: process.env,
          signal,
          input,
          timeout: seconds * 1000,
          maxBuffer: 2 * 1024 * 1024,
        }),
    });
    const credentials: Record<string, unknown>[] = [];
    try {
      for (const projectPath of new Set(projects as string[])) {
        // The validated path alphabet excludes SQL delimiters; values never contain secrets.
        const matches = rows(
          await database.query(
            database.main,
            `SELECT COALESCE(json_agg(source_id), '[]'::json)::text FROM public.routes WHERE source_type = 'Project' AND lower(path) = lower('${projectPath}')`,
          ),
        );
        if (
          matches.length > 1 ||
          matches.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)
        )
          throw Error('gitlab-token-project-identity-invalid');
        const projectId = matches[0];
        const keys = projectId
          ? rows(
              await database.query(
                database.ci,
                `SELECT COALESCE(json_agg(key), '[]'::json)::text FROM public.ci_variables WHERE project_id = ${projectId} AND environment_scope = '*' AND key IN ('RENOVATE_TOKEN','SYSTEM_RELEASE_GITLAB_TOKEN','GITHUB_RELEASE_TOKEN','DOCKERHUB_TOKEN')`,
              ),
            )
          : [];
        for (const [key, [purpose, provider]] of Object.entries(purposes)) {
          const result: Record<string, unknown> = {
            projectPath,
            key,
            purpose,
            provider,
            expiresAt: null,
            revoked: null,
            expirySource: 'unavailable',
            configured: keys.includes(key),
          };
          credentials.push(result);
          if (!result.configured || provider !== 'GitLab') continue;
          try {
            if (!administrator) throw Error('metadata-unavailable');
            const variable = await this.api.request(
              context,
              administrator,
              'GET',
              `projects/${projectId}/variables/${key}?filter%5Benvironment_scope%5D=*`,
            );
            const value = row(variable.value);
            if (
              variable.status !== 200 ||
              value.key !== key ||
              value.environment_scope !== '*' ||
              typeof value.value !== 'string' ||
              value.value.length > 4096
            )
              throw Error('metadata-unavailable');
            // GitLab Authn::TokenField::Digest encodes PATs with CryptoHelper.sha256.
            // This lookup also reports revoked/expired tokens, unlike authenticating /self.
            const digest = createHash('sha256').update(value.value).digest('hex');
            const tokens = rows(
              await database.query(
                database.main,
                `SELECT COALESCE(json_agg(json_build_object('id', id, 'expiresAt', expires_at, 'revoked', COALESCE(revoked, false))), '[]'::json)::text FROM public.personal_access_tokens WHERE token_digest = '${digest}'`,
              ),
            );
            if (tokens.length === 0) continue;
            if (tokens.length !== 1) throw Error('metadata-unavailable');
            const token = row(tokens[0]);
            if (
              !Number.isSafeInteger(token.id) ||
              Number(token.id) <= 0 ||
              typeof token.revoked !== 'boolean' ||
              (token.expiresAt !== null &&
                (typeof token.expiresAt !== 'string' ||
                  !/^\d{4}-\d{2}-\d{2}$/.test(token.expiresAt)))
            )
              throw Error('metadata-unavailable');
            Object.assign(result, {
              tokenId: token.id,
              expiresAt: token.expiresAt,
              revoked: token.revoked,
              expirySource: 'gitlab',
            });
          } catch {
            result.error = 'metadata-unavailable';
          }
        }
      }
      return { credentials };
    } finally {
      await database.close();
    }
  }
}
