import fs from 'node:fs';
import { record } from '../release/sourceIdentity';
export class NativePortChannel {
  private pending: Buffer = Buffer.alloc(0);
  read(): unknown {
    while (!this.pending.includes(10)) {
      const buffer = Buffer.alloc(65536),
        count = fs.readSync(0, buffer, 0, buffer.length, null);

      if (!count) {
        throw Error('host-native-port-disconnected');
      }

      this.pending = Buffer.concat([this.pending, buffer.subarray(0, count)]);

      if (this.pending.length > 16 * 1024 ** 2) {
        throw Error('host-native-port-frame-too-large');
      }
    }
    const end = this.pending.indexOf(10),
      line = this.pending.slice(0, end);
    this.pending = this.pending.slice(end + 1);
    return JSON.parse(line.toString());
  }

  write(value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    for (let offset = 0; offset < bytes.length;) {
      offset += fs.writeSync(1, bytes, offset, bytes.length - offset);
    }
  }

  call(method: string, args: unknown[] = []): unknown {
    this.write({ method, args });
    const response = record(this.read());

    if (typeof response.error === 'string') {
      throw Error(response.error);
    }

    return response.value;
  }
}
