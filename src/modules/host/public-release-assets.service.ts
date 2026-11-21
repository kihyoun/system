import { boundedResponse } from '../release/github-transport';
import { requireValue as ensure } from './install';
/** Anonymous publisher transport; no operator GitLab credentials cross this boundary. */
export class PublicReleaseAssetsService {
  constructor(readonly request: typeof fetch = fetch) {}

  async load(repository: string, tag: string, filename: string): Promise<Buffer> {
    ensure(
      typeof repository === 'string' &&
        /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository) &&
        repository.split('/').every((part) => !['.', '..'].includes(part)) &&
        typeof tag === 'string' &&
        /^v\d+\.\d+\.\d+$/.test(tag) &&
        typeof filename === 'string' &&
        /^[A-Za-z0-9._-]+$/.test(filename) &&
        !['.', '..'].includes(filename),
      'invalid-public-release-location',
    );
    let url = new URL(`https://github.com/${repository}/releases/download/${tag}/${filename}`);
    const signal = AbortSignal.timeout(30000);
    for (let redirects = 0; redirects <= 5; redirects++) {
      ensure(
        url.protocol === 'https:' &&
          [
            'github.com',
            'release-assets.githubusercontent.com',
            'objects.githubusercontent.com',
          ].includes(url.hostname) &&
          !url.username &&
          !url.password &&
          (!url.port || url.port === '443'),
        'unapproved-public-release-redirect',
      );
      const response = await this.request(url, { redirect: 'manual', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        ensure(location && redirects < 5, 'public-release-redirect-limit');
        url = new URL(location, url);
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        throw Error('public-release-asset-unavailable');
      }
      return boundedResponse(response);
    }
    throw Error('public-release-redirect-limit');
  }
}
