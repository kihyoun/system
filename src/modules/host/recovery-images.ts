import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileSha } from './recovery-manifest';
import { imageId } from '../release/source-identity';
import path from 'node:path';
import { HostInstallService, requireValue } from './install';
import { canonicalDigest, type RecoveryManifest } from './recovery-manifest';
import { record } from '../release/source-identity';
interface Inspection {
  Id: string;
  RepoDigests?: string[];
}
const docker = ['--host=unix:///var/run/docker.sock'];
export class RecoveryImageService {
  constructor(readonly host = new HostInstallService()) {}

  inspect(reference: string): Inspection {
    const rows: unknown = JSON.parse(
      this.host.run('docker', [...docker, 'image', 'inspect', reference]),
    );
    requireValue(Array.isArray(rows) && rows.length === 1, 'unexpected-image-inspection');
    record(rows[0]);
    return rows[0] as Inspection;
  }

  async restoreRetained(
    directory: string,
    descriptors: Record<string, unknown>,
    expected: Record<string, Record<string, unknown>>,
    command: (args: string[], timeout: number) => Promise<string>,
  ): Promise<Record<string, Record<string, unknown>>> {
    requireValue(
      Object.keys(descriptors).sort().join(',') === Object.keys(expected).sort().join(','),
      'retained-image-role-set-mismatch',
    );
    const selections: Record<string, Record<string, unknown>> = {};
    const inspect = async (reference: string) => {
      const rows: unknown = JSON.parse(await command(['image', 'inspect', reference], 300));
      requireValue(Array.isArray(rows) && rows.length === 1, 'unexpected-image-inspection');
      return record(rows[0]);
    };
    for (const [role, selected] of Object.entries(expected)) {
      const row = record(descriptors[role]),
        relative = String(row.file),
        filename = path.join(directory, relative);
      requireValue(
        /^images\/controller-[a-f0-9-]+\.tar\.gz$/.test(relative) &&
          path.isAbsolute(directory) &&
          fs.realpathSync(filename) === filename,
        'previous-image-archive-changed',
      );
      const stat = fs.lstatSync(filename);
      requireValue(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          !fs.lstatSync(path.dirname(filename)).isSymbolicLink() &&
          !(stat.mode & 0o077) &&
          typeof row.sha256 === 'string' &&
          /^[a-f0-9]{64}$/.test(row.sha256) &&
          row.imageId === selected.imageId &&
          imageId(row.imageId) &&
          fileSha(filename) === row.sha256,
        'previous-image-archive-changed',
      );
      await command(['image', 'load', '--input', filename], 600);
      requireValue(
        (await inspect(row.imageId)).Id === selected.imageId,
        'loaded-image-id-mismatch',
      );
      const reference = String(selected.originalReference ?? selected.reference);
      canonicalDigest(reference);
      const alias =
        'system-bootstrapper-recovery:' +
        crypto
          .createHash('sha256')
          .update(reference + row.imageId + row.sha256)
          .digest('hex');
      const found = (
        await command(['image', 'ls', '--filter', 'reference=' + alias, '--format', '{{.ID}}'], 300)
      ).trim();
      if (found)
        requireValue(
          (await inspect(alias)).Id === selected.imageId,
          'retained-image-alias-retargeted',
        );
      await command(['image', 'tag', row.imageId, alias], 300);
      requireValue((await inspect(alias)).Id === selected.imageId, 'retained-image-alias-mismatch');
      selections[role] = {
        reference: alias,
        originalReference: reference,
        imageId: selected.imageId,
        archiveSha256: row.sha256,
        file: relative,
      };
    }
    return selections;
  }

  restore(directory: string, manifest: RecoveryManifest): void {
    for (const archive of manifest.archives) {
      // Docker natively streams compressed save archives; no second uncompressed
      // archive is materialized and no shell pipeline can outlive the bounded call.
      this.host.run(
        'docker',
        [...docker, 'load', '--input', path.join(directory, archive.file)],
        undefined,
        900000,
      );
      requireValue(
        this.inspect(archive.imageId).Id === archive.imageId,
        'loaded-image-id-mismatch',
      );
    }
    for (const image of manifest.localImages) {
      this.host.run('docker', [...docker, 'tag', image.imageId!, image.tag]);
      requireValue(this.inspect(image.tag).Id === image.imageId, 'local-image-alias-mismatch');
    }
    for (const image of manifest.publicImages) {
      let loaded: Inspection;
      try {
        loaded = this.inspect(image.reference!);
      } catch {
        this.host.run('docker', [...docker, 'pull', image.reference!]);
        loaded = this.inspect(image.reference!);
      }
      requireValue(
        loaded.RepoDigests?.includes(canonicalDigest(image.reference!)),
        'public-image-digest-mismatch',
      );
      if (image.imageId) requireValue(loaded.Id === image.imageId, 'public-image-id-mismatch');
      this.host.run('docker', [...docker, 'tag', image.reference!, image.tag]);
    }
  }
}
