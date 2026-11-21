import { savedSyncEnvironment } from './helper';
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';
import { StorageCommandDto, StorageAction } from './storage-command.dto';
import { normalizePreview } from '../../common/runtime/preview-settings';
import { directory, writeStatus } from './coordinated-backup';

export async function main(args = process.argv.slice(2), environment = process.env): Promise<void> {
  const [action, operation, ...flags] = args;
  if (action === 'sync-status') environment = savedSyncEnvironment(environment);
  const application = await NestFactory.createApplicationContext(
    StorageModule.register({ normalizePreview }),
    { logger: false },
  );
  try {
    const command: StorageCommandDto = {
      action: action as StorageAction,
      environment,
      operation: operation as 'harvest' | 'restore',
      ownerPid: operation,
      exitCode: operation === undefined ? undefined : Number(operation),
      checkOnly: flags.includes('--check-only'),
      backup: environment.SYSTEM_SEED_CONFIGURATION_BACKUP,
    };
    const result = await application.get(StorageService).run(command);
    if (action === 'startup-begin') console.log(result);
    else if (action === 'sync-status') console.log(JSON.stringify(result));
  } finally {
    await application.close();
  }
}
export function reportFailure(error: unknown, args: string[] = process.argv.slice(2)) {
  const message = error instanceof Error ? error.message : '';
  const code = /^[a-z][a-z0-9-]+$/.test(message) ? message : 'seed-operation-failed';
  try {
    const inside = args[0] === 'inside';
    const id =
      process.env.SYSTEM_COORDINATED_BACKUP ||
      (inside && JSON.parse(process.env.SYSTEM_STORAGE_SPEC || '{}').coordinatedBackup);
    if (id) {
      const root = directory(
        inside ? '/live/configuration' : process.env.SYSTEM_CONFIG_DIR || '/state',
        id,
      );
      const status = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8'));
      if (status.state === 'working' && status.phase === 'preflight')
        writeStatus(root, {
          ...status,
          state: 'failed',
          phase: 'preflight-failed',
          error: code,
          completedAt: new Date().toISOString(),
          configuration: { status: 'unavailable' },
        });
    }
  } catch {
    /* Preserve controlled diagnostics when the status artifact is unavailable. */
  }
  console.error('Seed operation failed: ' + code + '.');
  process.exitCode = args[0] === 'startup-begin' && code === 'storage-operation-busy' ? 75 : 1;
}
if (require.main === module) main().catch(reportFailure);
