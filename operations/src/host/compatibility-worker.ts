import fs from 'node:fs';
const limit = 16 * 1024 * 1024;
/** Sequential private channel: one request owns the mutable operation deadline. */
export async function compatibilityWorker(
  handle: (
    request: { operation: string; arguments: unknown[]; deadline?: number },
    retain: boolean,
  ) => Promise<unknown>,
  close: () => Promise<void>,
): Promise<void> {
  let pending = Buffer.alloc(0);
  const chunk = Buffer.alloc(65536);
  try {
    while (true) {
      const newline = pending.indexOf(10);
      if (newline < 0) {
        const size = fs.readSync(0, chunk, 0, chunk.length, null);
        if (!size) {
          if (pending.length) throw Error('incomplete-host-request');
          break;
        }
        pending = Buffer.concat([pending, chunk.subarray(0, size)]);
        if (pending.length > limit) throw Error('bounded-host-request-required');
        continue;
      }
      const bytes = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      const request = JSON.parse(bytes.toString('utf8')) as {
        id: unknown;
        operation: string;
        arguments: unknown[];
        deadline?: number;
      };
      if (!Number.isSafeInteger(request.id) || !Array.isArray(request.arguments))
        throw Error('invalid-host-request');
      let response: unknown;
      try {
        response = { id: request.id, value: (await handle(request, true)) ?? null };
      } catch (error) {
        response = {
          id: request.id,
          error:
            error instanceof Error && /^[a-z][a-zA-Z0-9:-]+$/.test(error.message)
              ? error.message
              : 'invalid-private-input-or-filesystem',
        };
      }
      const output = Buffer.from(JSON.stringify(response) + '\n');
      if (output.length > limit) throw Error('bounded-host-response-required');
      let offset = 0;
      while (offset < output.length) offset += fs.writeSync(1, output, offset);
    }
  } finally {
    await close();
  }
}
