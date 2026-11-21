import type { RenovateReader } from './verification.service';

/** Operator-selected GitLab API; redirects never receive the private token. */
export class RenovateApi implements RenovateReader {
  private readonly endpoint: string;
  constructor(
    endpoint: unknown,
    private readonly token: string,
  ) {
    if (typeof endpoint !== 'string' || !token || /[\r\n]/.test(token))
      throw Error('Private GitLab API credentials required.');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw Error('Use an HTTPS GitLab API endpoint.');
    this.endpoint = endpoint.replace(/\/$/, '');
  }

  async get(route: string): Promise<unknown> {
    return this.call('GET', route);
  }

  async call(method: string, route: string, data?: unknown, missing = false): Promise<unknown> {
    if (!/^\/(?!\/)/.test(route) || /[\r\n#]/.test(route)) throw Error('Invalid GitLab API route.');
    const signal = AbortSignal.timeout(60_000);
    let response: Response;
    try {
      response = await fetch(this.endpoint + route, {
        method,
        signal,
        redirect: 'error',
        headers: { 'PRIVATE-TOKEN': this.token, 'Content-Type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    } catch {
      throw Error('GitLab API connection failed.');
    }
    if (missing && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(`GitLab API rejected request: HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      if (reader)
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > 4 * 1024 * 1024) throw Error('GitLab API response exceeds its limit.');
          chunks.push(next.value);
        }
      const body = Buffer.concat(chunks).toString('utf8');
      return body ? JSON.parse(body) : null;
    } catch {
      throw Error('Invalid or incomplete bounded GitLab API response.');
    } finally {
      await reader?.cancel();
    }
  }

  async all(route: string): Promise<unknown[]> {
    const result: unknown[] = [];
    for (let page = 1; page <= 10000; page++) {
      const items = await this.get(
        route + (route.includes('?') ? '&' : '?') + `per_page=100&page=${page}`,
      );
      if (!Array.isArray(items) || items.length > 100) throw Error('Invalid GitLab API page.');
      result.push(...items);
      if (items.length < 100) return result;
    }
    throw Error('GitLab API pagination exceeds its limit.');
  }
}
