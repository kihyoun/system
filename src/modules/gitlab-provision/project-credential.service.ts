import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { GitlabAuthJournalService } from './auth-journal.service';
import {
  GitlabNativeApiService,
  type GitlabNativeContext,
  type GitlabMethod,
} from './native-api.service';
type Row = Record<string, unknown>;
interface Token {
  id: number;
  userId: number;
  name: string;
  expiresAt: string;
  token: string;
}
interface State {
  version: 1;
  projectId: number;
  projectPath: string;
  pending?: { name: string; expiresAt: string };
  current?: Token;
  replacement?: Token;
  retiring?: Token;
}
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('gitlab-project-credential-invalid');
  return value as Row;
}
function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function validate(value: unknown): State {
  const state = row(value);
  if (
    state.version !== 1 ||
    !positive(state.projectId) ||
    typeof state.projectPath !== 'string' ||
    !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(state.projectPath)
  )
    throw Error('gitlab-project-credential-invalid');
  for (const key of ['current', 'replacement', 'retiring', 'pending']) {
    if (state[key] === undefined) continue;
    const token = row(state[key]);
    if (
      typeof token.name !== 'string' ||
      !/^system-bootstrapper-project-[a-f0-9]{48}$/.test(token.name) ||
      typeof token.expiresAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(token.expiresAt) ||
      (key !== 'pending' &&
        (!positive(token.id) ||
          !positive(token.userId) ||
          typeof token.token !== 'string' ||
          !token.token ||
          token.token.length > 4096 ||
          /[\r\n\0]/.test(token.token)))
    )
      throw Error('gitlab-project-credential-invalid');
  }
  return state as unknown as State;
}
/** Maintainer api authority is confined to one exact project; administrator authority only provisions it. */
@Injectable()
export class GitlabProjectCredentialService {
  constructor(
    private readonly journals: GitlabAuthJournalService,
    private readonly api: GitlabNativeApiService,
  ) {}

  async current(
    context: GitlabNativeContext,
    directory: string,
    projectId: number,
    projectPath: string,
    administrator: string,
    now = new Date(),
    forceRenew = false,
  ): Promise<Token> {
    const initial = validate({ version: 1, projectId, projectPath });
    if (!Number.isFinite(now.getTime())) throw Error('gitlab-project-credential-clock-invalid');
    const route = `projects/${projectId}`;
    const call = async (method: GitlabMethod, suffix: string, body?: unknown, accepted = [200]) => {
      const result = await this.api.request(context, administrator, method, route + suffix, body);
      if (!accepted.includes(result.status)) throw Error('gitlab-project-credential-api-refused');
      return result;
    };
    const project = row((await call('GET', '')).value);
    if (project.id !== projectId || project.path_with_namespace !== projectPath)
      throw Error('gitlab-project-credential-project-mismatch');
    return this.journals.withFile(
      directory,
      `project-credentials-${projectId}`,
      validate,
      async (journal) => {
        const state = journal.read() ?? initial;
        if (state.projectId !== projectId || state.projectPath !== projectPath)
          throw Error('gitlab-project-credential-binding-mismatch');
        const owned = (
          value: unknown,
          token: { id?: number; userId?: number; name: string; expiresAt: string },
        ) => {
          const proof = row(value);
          if (
            !positive(proof.id) ||
            !positive(proof.user_id) ||
            (token.id !== undefined && token.id !== proof.id) ||
            (token.userId !== undefined && token.userId !== proof.user_id) ||
            proof.name !== token.name ||
            proof.expires_at !== token.expiresAt ||
            proof.access_level !== 40 ||
            !Array.isArray(proof.scopes) ||
            proof.scopes.length !== 1 ||
            proof.scopes[0] !== 'api'
          )
            throw Error('gitlab-project-credential-owner-mismatch');
          return proof;
        };
        const revoke = async (token: {
          id: number;
          userId: number;
          name: string;
          expiresAt: string;
        }) => {
          const suffix = '/access_tokens/' + token.id;
          const result = await call('GET', suffix, undefined, [200, 404]);
          if (result.status === 404) return;
          if (owned(result.value, token).revoked !== true)
            await call('DELETE', suffix, undefined, [204]);
          const final = await call('GET', suffix, undefined, [200, 404]);
          if (final.status !== 404 && owned(final.value, token).revoked !== true)
            throw Error('gitlab-project-credential-revocation-incomplete');
        };
        const bot = async (token: Token) => {
          const result = await this.api.request(
            context,
            administrator,
            'GET',
            'users/' + token.userId,
          );
          const user = row(result.value);
          if (
            result.status !== 200 ||
            user.id !== token.userId ||
            user.bot !== true ||
            user.is_admin !== false ||
            user.state !== 'active' ||
            typeof user.username !== 'string' ||
            !new RegExp('^project_' + projectId + '_bot(?:_|$)').test(user.username)
          )
            throw Error('gitlab-project-credential-bot-ownership-invalid');
          return user;
        };
        const verify = async (token: Token) => {
          if ((await bot(token)).external !== true)
            throw Error('gitlab-project-credential-external-required');
          const proof = owned((await call('GET', '/access_tokens/' + token.id)).value, token);
          if (proof.active !== true || proof.revoked !== false)
            throw Error('gitlab-project-credential-inactive');
          const access = await this.api.request(context, token.token, 'GET', route);
          const user = await this.api.request(context, token.token, 'GET', 'user');
          if (
            access.status !== 200 ||
            row(access.value).id !== projectId ||
            row(access.value).path_with_namespace !== projectPath ||
            user.status !== 200 ||
            row(user.value).id !== token.userId ||
            row(user.value).is_admin === true ||
            row(user.value).state !== 'active'
          )
            throw Error('gitlab-project-credential-proof-invalid');
        };
        if (state.retiring) {
          if (!state.current || state.current.id === state.retiring.id)
            throw Error('gitlab-project-credential-retirement-invalid');
          await verify(state.current);
          await revoke(state.retiring);
          delete state.retiring;
          journal.save(state);
        }
        if (
          state.current &&
          !forceRenew &&
          !state.pending &&
          !state.replacement &&
          Date.parse(state.current.expiresAt + 'T00:00:00Z') > now.getTime() + 14 * 86400000
        ) {
          await verify(state.current);
          return state.current;
        }
        if (!state.replacement) {
          if (state.pending) {
            const matches: Row[] = [];
            for (let page = 1; ; page++) {
              if (page > 100) throw Error('gitlab-project-credential-collection-limit');
              const values = (
                await call(
                  'GET',
                  `/access_tokens?search=${state.pending.name}&per_page=100&page=${page}`,
                )
              ).value;
              if (!Array.isArray(values)) throw Error('gitlab-project-credential-response-invalid');
              matches.push(
                ...values.map(row).filter((token) => token.name === state.pending!.name),
              );
              if (values.length < 100) break;
            }
            if (matches.length !== 1)
              throw Error('gitlab-project-credential-issuance-reconciliation-required');
            const found = owned(matches[0], state.pending);
            await revoke({ id: Number(found.id), userId: Number(found.user_id), ...state.pending });
            delete state.pending;
            journal.save(state);
          }
          state.pending = {
            name: 'system-bootstrapper-project-' + randomBytes(24).toString('hex'),
            expiresAt: new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10),
          };
          journal.save(state);
          const created = (
            await call(
              'POST',
              '/access_tokens',
              {
                name: state.pending.name,
                expires_at: state.pending.expiresAt,
                access_level: 40,
                scopes: ['api'],
              },
              [201],
            )
          ).value;
          const proof = owned(created, state.pending);
          const replacement = {
            id: Number(proof.id),
            userId: Number(proof.user_id),
            name: state.pending.name,
            expiresAt: state.pending.expiresAt,
            token: row(created).token,
          };
          state.replacement = validate({ ...state, replacement }).replacement!;
          delete state.pending;
          journal.save(state);
        }
        if ((await bot(state.replacement)).external !== true) {
          const restricted = await this.api.request(
            context,
            administrator,
            'PUT',
            'users/' + state.replacement.userId,
            { external: true },
          );
          if (restricted.status !== 200)
            throw Error('gitlab-project-credential-external-update-incomplete');
        }
        await verify(state.replacement);
        state.retiring = state.current;
        state.current = state.replacement;
        delete state.replacement;
        journal.save(state);
        if (state.retiring) {
          await revoke(state.retiring);
          delete state.retiring;
          journal.save(state);
        }
        return state.current;
      },
    );
  }
}
