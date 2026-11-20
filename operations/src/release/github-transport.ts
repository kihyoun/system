import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Environment } from './types';

export function requirePublication(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error(message);
}
export const publicationHash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
export function publicationRecord(value: unknown): Record<string, unknown> {
  requirePublication(
    value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value),
    'Release object required.',
  );
  return value as Record<string, unknown>;
}
export function boundedReleaseInput(file: string): Buffer {
  const stat = fs.lstatSync(file);
  requirePublication(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 ** 2,
    'Regular bounded release inputs required.',
  );
  return fs.readFileSync(file);
}
export function publicationToken(env: Environment, name: string): string {
  const filename = env[name + '_FILE'];
  if (filename) {
    const stat = fs.lstatSync(filename);
    requirePublication(
      stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.size <= 16384,
      'Private scoped publication credential file required.',
    );
    const value = boundedReleaseInput(filename).toString().trim();
    requirePublication(value && !/[\r\n]/.test(value), 'A single scoped credential required.');
    return value;
  }
  const value = env[name];
  requirePublication(
    typeof value === 'string' && value.length > 0 && value.length < 16384 && !/[\r\n]/.test(value),
    'Scoped publication credential required.',
  );
  return value;
}
export interface PublicationRequest {
  method?: string;
  body?: string | Buffer;
  headers?: Record<string, string>;
  raw?: boolean;
}
export type PublicationApi = (route: string, options?: PublicationRequest) => Promise<unknown>;
async function boundedResponse(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 8 * 1024 ** 2) {
        await reader.cancel();
        throw Error('Release API response too large.');
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
}
/** Fixed-origin transport; signed public asset downloads never carry credentials. */
export function publicationApi(
  origin: string,
  credential: string,
  header: string,
  request: typeof fetch = fetch,
): PublicationApi {
  return async (route, options = {}) => {
    requirePublication(
      route.startsWith('/') && !route.startsWith('//'),
      'Fixed API origin required.',
    );
    const headers = {
      [header]: credential,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    };
    let response = await request(origin + route, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
      method: options.method,
      body: Buffer.isBuffer(options.body) ? new Uint8Array(options.body) : options.body,
      headers,
    });
    if (response.status === 302 && options.raw && origin === 'https://api.github.com') {
      const location = response.headers.get('location');
      requirePublication(location, 'Unapproved release-asset download redirect.');
      const destination = new URL(location);
      requirePublication(
        destination.protocol === 'https:' &&
          !destination.username &&
          !destination.password &&
          !destination.port &&
          ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(
            destination.hostname,
          ),
        'Unapproved release-asset download redirect.',
      );
      response = await request(destination.href, {
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
    }
    if (response.status === 404) return null;
    requirePublication(response.ok, 'Release API request failed.');
    const bytes = await boundedResponse(response);
    requirePublication(bytes.length <= 8 * 1024 ** 2, 'Release API response too large.');
    return options.raw ? bytes : bytes.length ? (JSON.parse(bytes.toString()) as unknown) : {};
  };
}
