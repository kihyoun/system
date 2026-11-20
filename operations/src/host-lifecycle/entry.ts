import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { HostLifecycleModule } from './host-lifecycle.module';
import { HostPersistenceService } from './persistence.service';
import { HostLifecycleService } from './lifecycle.service';
async function main() {
  const action = process.argv[2];
  if (!['start', 'stop', 'persistence'].includes(action))
    throw new Error('Unsupported host lifecycle action.');
  const app = await NestFactory.createApplicationContext(HostLifecycleModule, { logger: false });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    if (action === 'persistence') {
      await app.get(HostPersistenceService).prepare(process.env, undefined, abort.signal);
      console.log('Persistent storage verified.');
    } else
      await app
        .get(HostLifecycleService)
        .execute(
          action as 'start' | 'stop',
          path.resolve(process.argv[3] || '.'),
          process.env,
          abort.signal,
        );
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await app.close();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Host lifecycle failed.');
  process.exitCode = 1;
});
