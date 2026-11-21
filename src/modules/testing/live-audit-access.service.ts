import { Injectable } from '@nestjs/common';
import { GitlabCredentialService } from '../gitlab-provision/credential.service';
import { GitlabNativeApiService, type GitlabMethod } from '../gitlab-provision/native-api.service';
import { record, positive } from '../release/source-identity';
export interface LiveAuditInput {
  checkout: string;
  configDirectory: string;
  signal?: AbortSignal;
}
export function requireAudit(condition: unknown, code: string): asserts condition {
  if (!condition) throw Error('live-audit-' + code);
}
export class LiveAuditSession {
  constructor(
    readonly api: GitlabNativeApiService,
    readonly authority: Awaited<ReturnType<GitlabCredentialService['existing']>>,
  ) {}

  async call(
    method: GitlabMethod,
    route: string,
    body?: unknown,
    token = this.authority.credential.token,
  ) {
    return this.api.request(this.authority.context, token, method, route, body);
  }

  async json(
    method: GitlabMethod,
    route: string,
    body?: unknown,
    accepted = [200],
    token = this.authority.credential.token,
  ): Promise<unknown> {
    const response = await this.call(method, route, body, token);
    requireAudit(accepted.includes(response.status), 'API-request-refused');
    return response.value;
  }

  async pages(
    route: string,
    token = this.authority.credential.token,
  ): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = [];
    for (let page = 1; page <= 100; page++) {
      const value = await this.json(
        'GET',
        route + (route.includes('?') ? '&' : '?') + 'per_page=100&page=' + page,
        undefined,
        [200],
        token,
      );
      requireAudit(Array.isArray(value) && value.length <= 100, 'bounded-collection-required');
      result.push(...value.map(record));
      if (value.length < 100) return result;
    }
    throw Error('live-audit-collection-limit');
  }

  async setupRevoked(purpose: 'project' | 'runner'): Promise<void> {
    const name = `system-bootstrapper-${purpose}-setup`;
    const values = await this.pages('personal_access_tokens?revoked=false&search=' + name);
    requireAudit(
      !values.some((value) => value.name === name && value.revoked !== true),
      'setup-credential-not-revoked',
    );
  }
}
/** Uses already provisioned private authority. Audits never bootstrap or renew credentials. */
@Injectable()
export class LiveAuditAccessService {
  constructor(
    readonly credentials: GitlabCredentialService,
    readonly api: GitlabNativeApiService,
  ) {}

  async open(input: LiveAuditInput): Promise<LiveAuditSession> {
    const authority = await this.credentials.existing(input),
      session = new LiveAuditSession(this.api, authority);
    const self = record(await session.json('GET', 'personal_access_tokens/self'));
    requireAudit(
      positive(self.id) &&
        self.id === authority.credential.id &&
        self.user_id === authority.account.id &&
        self.revoked === false &&
        self.active === true,
      'existing-controller-credential-required',
    );
    return session;
  }
}
