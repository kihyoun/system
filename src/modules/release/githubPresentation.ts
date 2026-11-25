import type { GithubContext } from './githubAcceptance';
import {
  publicationHash as hash,
  publicationRecord as record,
  requirePublication as requireValue,
  type PublicationApi,
} from './githubTransport';
export type ReleaseAssets = Record<string, Buffer>;
function assets(release: Record<string, unknown>, name: string) {
  const rows = release.assets ?? [];
  requireValue(Array.isArray(rows), 'Release assets unavailable.');
  return rows
    .map(record)
    .filter((asset) => asset.name === name)
    .map((asset) => {
      requireValue(
        Number.isSafeInteger(asset.id) && Number(asset.id) > 0,
        'Release asset identity required.',
      );
      return { id: Number(asset.id) };
    });
}
/** Immutable publication, resumable drafts, and independent anonymous readback. */
export async function presentGithubRelease(
  ci: GithubContext,
  contents: ReleaseAssets,
  github: PublicationApi,
  anonymous: PublicationApi = github,
): Promise<Record<string, unknown>> {
  const prefix = '/repos/' + ci.repository;
  const commit = record(await anonymous(prefix + '/git/commits/' + ci.sourceRevision));
  requireValue(
    commit.sha === ci.sourceRevision && record(commit.tree).sha === ci.sourceTree,
    'Exact source commit/tree must be public before presentation.',
  );
  let tag = await github(prefix + '/git/ref/tags/' + ci.tag);

  if (!tag) {
    await github(prefix + '/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: 'refs/tags/' + ci.tag, sha: ci.sourceRevision }),
    });
    tag = await github(prefix + '/git/ref/tags/' + ci.tag);
  }

  const target = record(record(tag).object);
  requireValue(
    target.type === 'commit' && target.sha === ci.sourceRevision,
    'Public version tag is owned by another source.',
  );
  const expected = {
    tag_name: ci.tag,
    target_commitish: ci.sourceRevision,
    name: 'System Bootstrapper ' + ci.version,
    body: contents['release-notes.md'].toString(),
    prerelease: false,
  };
  let found = await github(prefix + '/releases/tags/' + ci.tag);

  if (!found) {
    for (let page = 1; page <= 20; page++) {
      const rows = await github(prefix + '/releases?per_page=100&page=' + page);
      requireValue(Array.isArray(rows), 'Release enumeration unavailable.');
      const matching = rows.map(record).filter((row) => row.tag_name === ci.tag);
      requireValue(matching.length <= 1, 'Duplicate version releases.');

      if (matching.length) {
        found = matching[0];
        break;
      }

      if (rows.length < 100) {
        break;
      }

      requireValue(page < 20, 'Release enumeration too large.');
    }
  }

  if (!found) {
    found = await github(prefix + '/releases', {
      method: 'POST',
      body: JSON.stringify({ ...expected, draft: true }),
    });
  }

  const release = record(found);
  requireValue(
    Object.entries(expected).every(([key, value]) => release[key] === value),
    'Public version release is immutable.',
  );
  requireValue(
    Number.isSafeInteger(release.id) && Number(release.id) > 0,
    'Release identity required.',
  );
  for (const [name, bytes] of Object.entries(contents)) {
    const entries = assets(release, name);
    requireValue(entries.length <= 1, 'Duplicate release asset.');

    if (entries.length) {
      const existing = await github(prefix + '/releases/assets/' + entries[0].id, {
        raw: true,
        headers: { Accept: 'application/octet-stream' },
      });
      requireValue(
        Buffer.isBuffer(existing) && hash(existing) === hash(bytes),
        'Public version asset already has different contents.',
      );
    } else {
      requireValue(release.draft === true, 'Published releases cannot gain replacement assets.');
      await github(
        '/uploads' +
          prefix +
          '/releases/' +
          release.id +
          '/assets?name=' +
          encodeURIComponent(name),
        { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } },
      );
    }
  }

  if (release.draft) {
    await github(prefix + '/releases/' + release.id, {
      method: 'PATCH',
      body: JSON.stringify({ draft: false, make_latest: 'true' }),
    });
  }

  const publicRelease = record(await anonymous(prefix + '/releases/tags/' + ci.tag));
  requireValue(
    publicRelease.draft === false &&
      Object.entries(expected).every(([key, value]) => publicRelease[key] === value),
    'Published release must be anonymously retrievable.',
  );
  for (const [name, bytes] of Object.entries(contents)) {
    const entries = assets(publicRelease, name);
    requireValue(entries.length === 1, 'Public release asset missing.');
    const downloaded = await anonymous(prefix + '/releases/assets/' + entries[0].id, {
      raw: true,
      headers: { Accept: 'application/octet-stream' },
    });
    requireValue(
      Buffer.isBuffer(downloaded) && hash(downloaded) === hash(bytes),
      'Public asset retrieval mismatch.',
    );
  }
  return publicRelease;
}
