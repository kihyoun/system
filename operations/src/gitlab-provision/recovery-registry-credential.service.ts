import { Injectable } from '@nestjs/common';
import { GitlabNativeApiService, type GitlabNativeContext } from './native-api.service';

type Row = Record<string, unknown>;
const name = 'system-bootstrapper-wizard-image-recovery';
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('registry-recovery-response-invalid');
  return value as Row;
}
function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw Error('registry-recovery-token-identity-invalid');
  return Number(value);
}
function readOnly(value: Row): boolean {
  return (
    Array.isArray(value.scopes) && value.scopes.length === 1 && value.scopes[0] === 'read_registry'
  );
}

/** Short-lived project deploy credentials use only the local documented GitLab API. */
@Injectable()
export class RecoveryRegistryCredentialService {
  constructor(private readonly api: GitlabNativeApiService) {}

  async execute(
    context: GitlabNativeContext,
    administrator: string,
    inputValue: unknown,
    now = new Date(),
  ): Promise<Row> {
    const input = row(inputValue),
      projectId = positive(input.projectId);
    if (
      typeof input.projectPath !== 'string' ||
      !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(input.projectPath) ||
      input.projectPath.split('/').some((part) => part === '.' || part === '..') ||
      !['create', 'cleanup', 'revoke'].includes(String(input.action)) ||
      !Number.isFinite(now.getTime())
    )
      throw Error('registry-recovery-input-invalid');
    const base = `projects/${projectId}`;
    const call = async (
      method: 'GET' | 'POST' | 'DELETE',
      route: string,
      body?: unknown,
      accepted = [200],
    ) => {
      const result = await this.api.request(context, administrator, method, route, body);
      if (!accepted.includes(result.status)) throw Error('registry-recovery-api-refused');
      return result.value;
    };
    const project = row(await call('GET', base)),
      user = row(await call('GET', 'user'));
    if (
      project.id !== projectId ||
      project.path_with_namespace !== input.projectPath ||
      user.is_admin !== true ||
      user.state !== 'active'
    )
      throw Error('registry-recovery-project-or-administrator-mismatch');

    const remove = async (value: Row, createdHere = false) => {
      const id = positive(value.id);
      if (value.name !== name || (!createdHere && !readOnly(value)))
        throw Error('registry-recovery-token-ownership-mismatch');
      const response = await this.api.request(
        context,
        administrator,
        'GET',
        `${base}/deploy_tokens/${id}`,
      );
      if (response.status === 404) return;
      const proof = row(response.value);
      if (
        response.status !== 200 ||
        proof.id !== id ||
        proof.name !== name ||
        (!createdHere && !readOnly(proof))
      )
        throw Error('registry-recovery-token-ownership-mismatch');
      await call('DELETE', `${base}/deploy_tokens/${id}`, undefined, [204]);
      const absent = await this.api.request(
        context,
        administrator,
        'GET',
        `${base}/deploy_tokens/${id}`,
      );
      if (absent.status !== 404) throw Error('registry-recovery-token-revocation-incomplete');
    };
    if (input.action === 'revoke') {
      const id = positive(input.tokenId),
        result = await this.api.request(
          context,
          administrator,
          'GET',
          `${base}/deploy_tokens/${id}`,
        );
      if (result.status === 404) return { revoked: true };
      if (result.status !== 200) throw Error('registry-recovery-api-refused');
      const found = row(result.value);
      if (found.id !== id) throw Error('registry-recovery-token-ownership-mismatch');
      await remove(found);
      return { revoked: true };
    }
    const owned: Row[] = [],
      seen = new Set<number>();
    for (let page = 1; ; page++) {
      if (page > 100) throw Error('registry-recovery-token-inventory-limit');
      const values = await call('GET', `${base}/deploy_tokens?per_page=100&page=${page}`);
      if (!Array.isArray(values) || values.length > 100)
        throw Error('registry-recovery-token-inventory-invalid');
      for (const value of values) {
        const token = row(value),
          id = positive(token.id);
        if (seen.has(id)) throw Error('registry-recovery-token-inventory-ambiguous');
        seen.add(id);
        if (token.name === name && token.revoked !== true) {
          if (!readOnly(token)) throw Error('registry-recovery-token-ownership-mismatch');
          owned.push(token);
        }
      }
      if (values.length < 100) break;
    }
    // Finish and validate the full inventory before invalidating any credential.
    for (const token of owned) await remove(token);
    if (input.action === 'cleanup') return { revoked: true };
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const expires = tomorrow.toISOString().slice(0, 10) + 'T00:00:00Z';
    const credential = row(
      await call(
        'POST',
        `${base}/deploy_tokens`,
        { name, scopes: ['read_registry'], expires_at: expires },
        [201],
      ),
    );
    const id = positive(credential.id);
    try {
      if (
        credential.name !== name ||
        !readOnly(credential) ||
        credential.revoked !== false ||
        credential.expired !== false ||
        credential.username !== `gitlab+deploy-token-${id}` ||
        typeof credential.token !== 'string' ||
        !credential.token ||
        credential.token.length > 4096 ||
        /[\r\n\0]/.test(credential.token) ||
        typeof credential.expires_at !== 'string' ||
        Date.parse(credential.expires_at) !== Date.parse(expires)
      )
        throw Error('registry-recovery-created-token-invalid');
      return { id, username: credential.username, token: credential.token };
    } catch (error) {
      // A malformed response must not leave the credential just created by this call active.
      if (credential.name === name) await remove(credential, true);
      throw error;
    }
  }
}
