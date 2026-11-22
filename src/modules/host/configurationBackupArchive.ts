import { crc32, inflateRawSync } from 'node:zlib';
import { requireValue as ensure } from './install';
/** Bounded store/deflate ZIP reader for the platform's configuration export format. */
export class ConfigurationBackupArchive {
  private readonly entries = new Map<
    string,
    { method: number; flags: number; crc: number; compressed: number; size: number; offset: number }
  >();
  constructor(private readonly bytes: Buffer) {
    let end = -1;
    for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
      if (
        bytes.readUInt32LE(index) === 0x06054b50 &&
        index + 22 + bytes.readUInt16LE(index + 20) === bytes.length
      ) {
        end = index;
        break;
      }
    }
    ensure(end >= 0, 'invalid-configuration-backup-archive');
    const count = bytes.readUInt16LE(end + 10),
      size = bytes.readUInt32LE(end + 12),
      start = bytes.readUInt32LE(end + 16);
    ensure(
      bytes.readUInt16LE(end + 4) === 0 &&
        bytes.readUInt16LE(end + 6) === 0 &&
        bytes.readUInt16LE(end + 8) === count &&
        count < 65535 &&
        start + size === end,
      'unsupported-configuration-backup-archive',
    );
    let at = start;
    for (let index = 0; index < count; index++) {
      ensure(
        at + 46 <= end && bytes.readUInt32LE(at) === 0x02014b50,
        'invalid-configuration-backup-directory',
      );
      const flags = bytes.readUInt16LE(at + 8),
        method = bytes.readUInt16LE(at + 10),
        compressed = bytes.readUInt32LE(at + 20),
        size = bytes.readUInt32LE(at + 24),
        length = bytes.readUInt16LE(at + 28),
        extra = bytes.readUInt16LE(at + 30),
        comment = bytes.readUInt16LE(at + 32),
        offset = bytes.readUInt32LE(at + 42);
      ensure(
        at + 46 + length + extra + comment <= end &&
          !(flags & 1) &&
          [0, 8].includes(method) &&
          bytes.readUInt16LE(at + 34) === 0,
        'unsupported-configuration-backup-entry',
      );
      const raw = bytes.subarray(at + 46, at + 46 + length),
        name = raw.toString('utf8');
      ensure(
        Buffer.from(name).equals(raw) && !name.includes('\0'),
        'invalid-configuration-backup-name',
      );
      ensure(!this.entries.has(name), 'duplicate-configuration-backup-entries');
      ensure(size <= 50 * 1024 ** 2, 'configuration-backup-entry-too-large');
      this.entries.set(name, {
        method,
        flags,
        crc: bytes.readUInt32LE(at + 16),
        compressed,
        size,
        offset,
      });
      at += 46 + length + extra + comment;
    }
    ensure(at === end, 'invalid-configuration-backup-directory');
  }

  read(name: string): Buffer {
    const entry = this.entries.get(name);
    ensure(entry, 'configuration-backup-entry-missing');
    const { offset, compressed, method, size, crc } = entry;
    ensure(
      offset + 30 <= this.bytes.length && this.bytes.readUInt32LE(offset) === 0x04034b50,
      'invalid-configuration-backup-entry',
    );
    const length = this.bytes.readUInt16LE(offset + 26),
      extra = this.bytes.readUInt16LE(offset + 28),
      start = offset + 30 + length + extra;
    ensure(
      start + compressed <= this.bytes.length &&
        this.bytes.subarray(offset + 30, offset + 30 + length).toString('utf8') === name &&
        this.bytes.readUInt16LE(offset + 8) === method,
      'invalid-configuration-backup-entry',
    );
    const raw = this.bytes.subarray(start, start + compressed),
      result =
        method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: 50 * 1024 ** 2 });
    ensure(
      result.length === size && crc32(result) === crc,
      'configuration-backup-entry-checksum-mismatch',
    );
    return result;
  }
}
