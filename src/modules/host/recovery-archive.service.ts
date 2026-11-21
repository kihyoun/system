import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { ArchiveProcess } from '../../common/runtime/archive-process';
import { imageId } from '../release/source-identity';
import { recoverySource } from './recovery-publication.service';
import { fileSha, recoveryReference } from './recovery-manifest';
import { requireValue } from './install';

/** Publish a complete private image archive only after export and durable file writes succeed. */
export class RecoveryArchiveService {
  constructor(private readonly process: ArchiveProcess) {}

  async save(
    directory: string,
    reference: string,
    image: string,
    sourceValue: unknown,
    signal?: AbortSignal,
  ) {
    requireValue(
      path.isAbsolute(directory) && recoveryReference(reference) && imageId(image),
      'invalid-recovery-archive-input',
    );
    const source = recoverySource(sourceValue),
      images = path.join(directory, 'images');
    for (const pathname of [directory, images]) {
      const stat = fs.lstatSync(pathname);
      requireValue(
        stat.isDirectory() && !stat.isSymbolicLink(),
        'recovery-archive-directory-required',
      );
    }
    const relative = `images/controller-${source.sourceCommit.slice(0, 12)}-${image.slice(7, 19)}-${randomUUID()}.tar.gz`;
    const target = path.join(directory, relative),
      temporary = target + '.tmp';
    const fd = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
      0o600,
    );
    const cancellation = new AbortController();
    const cancel = () => cancellation.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, 300000);
    try {
      await this.process.save(
        image,
        new Writable({
          write(chunk: Buffer, _encoding, callback) {
            try {
              let offset = 0;
              while (offset < chunk.length) {
                const written = fs.writeSync(fd, chunk, offset, chunk.length - offset);
                requireValue(written > 0, 'recovery-archive-write-failed');
                offset += written;
              }
              callback();
            } catch (error) {
              callback(error as Error);
            }
          },
        }),
        cancellation.signal,
      );
      if (cancellation.signal.aborted) throw Error('controller-image-archive-cancelled');
      fs.fsyncSync(fd);
      const bytes = fs.fstatSync(fd).size;
      requireValue(bytes > 0, 'empty-recovery-archive');
      const sha256 = fileSha(temporary);
      // Exclusive publication never replaces an archive belonging to another operation.
      fs.linkSync(temporary, target);
      fs.unlinkSync(temporary);
      const parent = fs.openSync(images, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try {
        fs.fsyncSync(parent);
      } finally {
        fs.closeSync(parent);
      }
      return { file: relative, sha256, bytes, imageId: image, ...source };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      fs.closeSync(fd);
      fs.rmSync(temporary, { force: true });
    }
  }
}
