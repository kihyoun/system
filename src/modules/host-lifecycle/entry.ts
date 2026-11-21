import 'reflect-metadata';
import path from 'node:path';
import fs from 'node:fs';
import { environmentAssignments } from '../../common/runtime/environment-assignments';
import { NestFactory } from '@nestjs/core';
import { HostLifecycleModule } from './host-lifecycle.module';
import { HostPersistenceService } from './persistence.service';
import { HostLifecycleService } from './lifecycle.service';
export async function hostLifecycle(action: string, checkout: string) {
  if (!['start', 'stop', 'persistence'].includes(action))
    throw new Error('Unsupported host lifecycle action.');
  const app = await NestFactory.createApplicationContext(HostLifecycleModule, { logger: false });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    if (action === 'persistence') {
      const environment = { ...process.env };
      if (environment.PERSISTENCE_ENV_FILE)
        Object.assign(
          environment,
          environmentAssignments(fs.readFileSync(environment.PERSISTENCE_ENV_FILE, 'utf8')),
        );
      await app.get(HostPersistenceService).prepare(environment, undefined, abort.signal);
      console.log('Persistent storage verified.');
    } else
      await app
        .get(HostLifecycleService)
        .execute(action as 'start' | 'stop', path.resolve(checkout), process.env, abort.signal);
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await app.close();
  }
}
if (require.main === module)
  void hostLifecycle(process.argv[2], process.argv[3] || '.').catch((error) => {
    console.error(error instanceof Error ? error.message : 'Host lifecycle failed.');
    process.exitCode = 1;
  });
