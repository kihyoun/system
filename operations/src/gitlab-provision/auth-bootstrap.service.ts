import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  GitlabAuthJournalService,
  validateAuthJournal,
  type GitlabAuthJournal,
} from './auth-journal.service';
import { GitlabNativeApiService, type GitlabNativeContext } from './native-api.service';
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('gitlab-auth-response-invalid');
  return value as Record<string, unknown>;
}
/** Bootstrap is a journalled one-shot operation, never an implicit retry after lost output. */
@Injectable()
export class GitlabAuthBootstrapService {
  constructor(
    private readonly journals: GitlabAuthJournalService,
    private readonly api: GitlabNativeApiService,
  ) {}
  async initial(context: GitlabNativeContext, configDirectory: string): Promise<GitlabAuthJournal> {
    return this.journals.withJournal(configDirectory, async (journal) => {
      const previous = journal.read();
      if (previous) {
        if (previous.phase === 'bootstrap-requested')
          throw Error('gitlab-auth-bootstrap-reconciliation-required');
        return previous;
      }
      const state: GitlabAuthJournal = {
        version: 1,
        operation: randomBytes(24).toString('hex'),
        phase: 'bootstrap-requested',
      };
      // A crash anywhere after this fsync must not mint another token automatically.
      journal.save(state);
      const bootstrap = await this.api.bootstrap(context, state.operation);
      const received = validateAuthJournal({ ...state, phase: 'bootstrap-received', bootstrap });
      journal.save(received);
      return received;
    });
  }
  async complete(
    context: GitlabNativeContext,
    configDirectory: string,
    replacement: NonNullable<GitlabAuthJournal['replacement']>,
  ): Promise<void> {
    await this.journals.withJournal(configDirectory, async (journal) => {
      const state = journal.read();
      if (!state || state.phase === 'bootstrap-requested')
        throw Error('gitlab-auth-bootstrap-reconciliation-required');
      validateAuthJournal({ ...state, replacement });
      const user = await this.api.request(context, replacement.token, 'GET', 'user');
      const token = await this.api.request(
        context,
        replacement.token,
        'GET',
        'personal_access_tokens/self',
      );
      const identity = row(user.value),
        proof = row(token.value);
      if (
        user.status !== 200 ||
        token.status !== 200 ||
        identity.id !== replacement.userId ||
        identity.is_admin !== true ||
        identity.state !== 'active' ||
        proof.id !== replacement.id ||
        proof.user_id !== replacement.userId ||
        proof.revoked !== false ||
        proof.active !== true ||
        proof.expires_at !== replacement.expiresAt ||
        !Array.isArray(proof.scopes) ||
        proof.scopes.length !== 1 ||
        proof.scopes[0] !== 'api' ||
        replacement.userId === state.bootstrap?.userId
      )
        throw Error('gitlab-auth-dedicated-administrator-proof-invalid');
      if (state.phase === 'ready') {
        if (JSON.stringify(state.replacement) !== JSON.stringify(replacement))
          throw Error('gitlab-auth-replacement-mismatch');
        return;
      }
      if (state.replacement && JSON.stringify(state.replacement) !== JSON.stringify(replacement))
        throw Error('gitlab-auth-replacement-mismatch');
      state.replacement = replacement;
      state.phase = 'replacement-verified';
      journal.save(state);
      const bootstrap = state.bootstrap!;
      const route = 'personal_access_tokens/' + bootstrap.id;
      const current = await this.api.request(context, replacement.token, 'GET', route);
      const found = row(current.value);
      if (
        current.status !== 200 ||
        found.id !== bootstrap.id ||
        found.user_id !== bootstrap.userId ||
        found.name !== bootstrap.name
      )
        throw Error('gitlab-auth-bootstrap-identity-mismatch');
      if (found.revoked !== true) {
        const deleted = await this.api.request(context, replacement.token, 'DELETE', route);
        if (deleted.status !== 204) throw Error('gitlab-auth-bootstrap-revocation-incomplete');
      }
      const revoked = await this.api.request(context, replacement.token, 'GET', route);
      const final = row(revoked.value);
      if (
        revoked.status !== 200 ||
        final.id !== bootstrap.id ||
        final.user_id !== bootstrap.userId ||
        final.name !== bootstrap.name ||
        final.revoked !== true
      )
        throw Error('gitlab-auth-bootstrap-revocation-incomplete');
      delete state.bootstrap;
      state.phase = 'ready';
      journal.save(state);
    });
  }
}
