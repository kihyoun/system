import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { CanonicalModule } from './canonical.module';
import { CanonicalService } from './canonical.service';
import { CanonicalPayload } from './canonical-session';
export async function run(action: string, payload: CanonicalPayload) {
  const app = await NestFactory.createApplicationContext(
    CanonicalModule.register({ configDirectory: process.env.SYSTEM_CONFIG_DIR }),
    { logger: false },
  );
  try {
    return await app.get(CanonicalService).run(action, payload);
  } finally {
    await app.close();
  }
}
export function canonicalStdin() {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
    if (input.length > 300000) process.exit(2);
  });
  process.stdin.on('end', async () => {
    try {
      const args: unknown = JSON.parse(input);
      if (
        !args ||
        typeof args !== 'object' ||
        !('action' in args) ||
        typeof args.action !== 'string' ||
        !('payload' in args) ||
        !args.payload ||
        typeof args.payload !== 'object' ||
        Array.isArray(args.payload)
      )
        throw Error('input');
      console.log(JSON.stringify(await run(args.action, args.payload as CanonicalPayload)));
    } catch (_) {
      console.log(
        JSON.stringify({
          ok: false,
          message: 'Canonical Wizard ownership, reservation, lock, DNS, or receipt check failed.',
        }),
      );
      process.exitCode = 1;
    }
  });
}
