import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { GitlabAuthJournalService, type GitlabAuthJournal } from './auth-journal.service';
import {
  GitlabNativeApiService,
  type GitlabNativeContext,
  type GitlabMethod,
} from './native-api.service';
const marker = 'System Bootstrapper controller';
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('gitlab-controller-credential-response-invalid');
  return value as Row;
}
function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw Error('gitlab-controller-credential-response-invalid');
  return Number(value);
}
/** Dedicated broad administrator for instance operations, distinct from project access tokens. */
@Injectable()
export class GitlabControllerCredentialService {
  constructor(
    private readonly journals: GitlabAuthJournalService,
    private readonly api: GitlabNativeApiService,
  ) {}
  async prepare(
    context: GitlabNativeContext,
    configDirectory: string,
    identity: { username: string; email: string },
    now = new Date(),
  ): Promise<NonNullable<GitlabAuthJournal['replacement']>> {
    if (
      !/^[a-z][a-z0-9_.-]{2,63}$/.test(identity.username) ||
      !/^[^\s@]+@[^\s@]+$/.test(identity.email) ||
      !Number.isFinite(now.getTime())
    )
      throw Error('gitlab-controller-identity-invalid');
    return this.journals.withJournal(configDirectory, async (journal) => {
      const state = journal.read();
      if (!state || !state.bootstrap || state.phase !== 'bootstrap-received')
        throw Error('gitlab-controller-bootstrap-required');
      if (
        state.account &&
        (state.account.username !== identity.username || state.account.email !== identity.email)
      )
        throw Error('gitlab-controller-identity-binding-mismatch');
      state.account ??= { ...identity, nonce: randomBytes(24).toString('hex') };
      journal.save(state);
      const call = async (
        method: GitlabMethod,
        route: string,
        body?: unknown,
        accepted = [200],
      ) => {
        const response = await this.api.request(
          context,
          state.bootstrap!.token,
          method,
          route,
          body,
        );
        if (!accepted.includes(response.status))
          throw Error('gitlab-controller-credential-api-refused');
        return response.value;
      };
      const administrator = row(await call('GET', 'user'));
      const bootstrapProof = row(await call('GET', 'personal_access_tokens/self'));
      if (
        administrator.id !== state.bootstrap.userId ||
        administrator.is_admin !== true ||
        administrator.state !== 'active' ||
        bootstrapProof.id !== state.bootstrap.id ||
        bootstrapProof.user_id !== administrator.id ||
        bootstrapProof.active !== true ||
        bootstrapProof.revoked !== false
      )
        throw Error('gitlab-controller-bootstrap-identity-mismatch');
      const users = await call('GET', 'users?username=' + encodeURIComponent(identity.username));
      if (!Array.isArray(users) || users.length > 1)
        throw Error('gitlab-controller-identity-ambiguous');
      let user: Row;
      if (!users.length) {
        if (state.account.userId) throw Error('gitlab-controller-owned-account-missing');
        user = row(
          await call(
            'POST',
            'users',
            {
              username: identity.username,
              email: identity.email,
              name: marker,
              note: marker + ': ' + state.account.nonce,
              admin: true,
              external: false,
              force_random_password: true,
              reset_password: false,
              skip_confirmation: true,
              private_profile: true,
            },
            [201],
          ),
        );
      } else user = row(await call('GET', 'users/' + positive(row(users[0]).id)));
      if (
        user.name !== marker ||
        user.note !== marker + ': ' + state.account.nonce ||
        user.username !== identity.username ||
        user.email !== identity.email ||
        user.is_admin !== true ||
        user.state !== 'active' ||
        user.external !== false ||
        (state.account.userId !== undefined && user.id !== state.account.userId)
      )
        throw Error('gitlab-controller-owned-account-mismatch');
      const uid = positive(user.id);
      if (uid === state.bootstrap.userId) throw Error('gitlab-controller-root-reuse-refused');
      state.account.userId = uid;
      journal.save(state);
      if (state.replacement) {
        if (state.replacement.userId !== uid) throw Error('gitlab-controller-token-owner-mismatch');
        return state.replacement;
      }
      if (state.pendingToken) {
        const matches: Row[] = [];
        for (let page = 1; ; page++) {
          if (page > 100) throw Error('gitlab-controller-token-collection-limit');
          const tokens = await call(
            'GET',
            `personal_access_tokens?user_id=${uid}&search=${state.pendingToken.name}&per_page=100&page=${page}`,
          );
          if (!Array.isArray(tokens)) throw Error('gitlab-controller-credential-response-invalid');
          matches.push(
            ...tokens.map(row).filter((token) => token.name === state.pendingToken!.name),
          );
          if (tokens.length < 100) break;
        }
        // Absence is not proof that a delayed HTTP request cannot still commit.
        if (matches.length !== 1) throw Error('gitlab-controller-token-reconciliation-required');
        const token = matches[0],
          id = positive(token.id);
        if (
          token.user_id !== uid ||
          token.expires_at !== state.pendingToken.expiresAt ||
          !Array.isArray(token.scopes) ||
          token.scopes.length !== 1 ||
          token.scopes[0] !== 'api'
        )
          throw Error('gitlab-controller-token-owner-mismatch');
        if (token.revoked !== true)
          await call('DELETE', 'personal_access_tokens/' + id, undefined, [204]);
        const revoked = row(await call('GET', 'personal_access_tokens/' + id));
        if (
          revoked.id !== id ||
          revoked.user_id !== uid ||
          revoked.name !== state.pendingToken.name ||
          revoked.revoked !== true
        )
          throw Error('gitlab-controller-token-revocation-incomplete');
        delete state.pendingToken;
        journal.save(state);
      }
      const expiresAt = new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10);
      state.pendingToken = {
        name: 'system-bootstrapper-controller-' + randomBytes(24).toString('hex'),
        expiresAt,
      };
      journal.save(state);
      const token = row(
        await call(
          'POST',
          `users/${uid}/personal_access_tokens`,
          { name: state.pendingToken.name, scopes: ['api'], expires_at: expiresAt },
          [201],
        ),
      );
      if (
        token.user_id !== uid ||
        token.name !== state.pendingToken.name ||
        token.expires_at !== expiresAt ||
        !Array.isArray(token.scopes) ||
        token.scopes.length !== 1 ||
        token.scopes[0] !== 'api' ||
        typeof token.token !== 'string' ||
        !token.token ||
        /[\r\n\0]/.test(token.token)
      )
        throw Error('gitlab-controller-token-response-invalid');
      state.replacement = { id: positive(token.id), userId: uid, token: token.token, expiresAt };
      delete state.pendingToken;
      journal.save(state);
      return state.replacement;
    });
  }
}
