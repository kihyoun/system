import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { CiModule } from './ci.module';
import { PlatformCheckService } from './platform.service';
export async function ciMain(args = process.argv.slice(2)) {
  if (
    args[0] !== 'platform' ||
    !args[1]?.startsWith('/') ||
    args.length > 3 ||
    (args[2] && args[2] !== 'cleanup')
  )
    throw new Error('usage-ci-platform-absolute-checkout-cleanup');
  const app = await NestFactory.createApplicationContext(CiModule, { logger: false });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    await app
      .get(PlatformCheckService)
      .execute(path.resolve(args[1]), process.env, args[2] === 'cleanup', abort.signal);
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await app.close();
  }
}
if (require.main === module)
  void ciMain().catch((error) => {
    console.error(error instanceof Error ? error.message : 'ci-platform-failed');
    process.exitCode = 1;
  });
