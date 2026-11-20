import fs from 'node:fs';
import { boundedResponse } from '../release/github-transport';
import { requireValue as ensure } from './install';
import type { CandidateGitLabApi } from './candidate-authority.service';
/** Credentialed, fixed-origin read-only GitLab transport with bounded pagination. */
export class CandidateGitLabService {
  constructor(readonly request: typeof fetch = fetch) {}
  connect(origin: string, tokenFile: string): CandidateGitLabApi {
    const parsed = new URL(origin);
    ensure(
      parsed.protocol === 'https:' &&
        parsed.hostname &&
        !parsed.username &&
        !parsed.password &&
        ['', '/'].includes(parsed.pathname) &&
        !parsed.search &&
        !parsed.hash,
      'GitLab-HTTPS-origin-required',
    );
    const descriptor = fs.openSync(tokenFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let credential: string;
    try {
      const stat = fs.fstatSync(descriptor);
      ensure(
        stat.isFile() && !(stat.mode & 0o077) && stat.size <= 8 * 1024 ** 2,
        'private-GitLab-token-required',
      );
      credential = fs.readFileSync(descriptor, 'utf8').trim();
    } finally {
      fs.closeSync(descriptor);
    }
    ensure(credential.length > 0 && !/[\r\n]/.test(credential), 'invalid-GitLab-token-file');
    const raw = async (endpoint: string) => {
      ensure(
        endpoint.startsWith('/') && !endpoint.startsWith('//') && !endpoint.includes('\\'),
        'invalid-GitLab-endpoint',
      );
      try {
        const response = await this.request(parsed.origin + '/api/v4' + endpoint, {
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
          headers: { 'PRIVATE-TOKEN': credential, Accept: 'application/json' },
        });
        ensure(response.status === 200, 'GitLab-API-request-failed');
        return {
          bytes: await boundedResponse(response),
          next: response.headers.get('x-next-page'),
        };
      } catch {
        throw Error('GitLab-API-request-failed');
      }
    };
    const decode = (bytes: Buffer): unknown => {
      try {
        return JSON.parse(bytes.toString());
      } catch {
        throw Error('GitLab-API-response-invalid');
      }
    };
    return {
      raw: async (endpoint) => (await raw(endpoint)).bytes,
      get: async (endpoint) => decode((await raw(endpoint)).bytes),
      pages: async (endpoint) => {
        const result: unknown[] = [];
        for (let page = 1; page <= 100; page++) {
          const response = await raw(
              endpoint + (endpoint.includes('?') ? '&' : '?') + 'per_page=100&page=' + page,
            ),
            rows = decode(response.bytes);
          ensure(Array.isArray(rows), 'GitLab-API-array-required');
          result.push(...rows);
          if (!response.next) return result;
        }
        throw Error('GitLab-API-pagination-limit');
      },
    };
  }
}
