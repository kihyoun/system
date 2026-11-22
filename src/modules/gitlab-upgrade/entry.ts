import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { GitLabUpgradeModule } from './gitlabUpgrade.module';
import { GitLabUpgradeService } from './gitlabUpgrade.service';
import { json } from './policy';
import { syncStatus } from './syncStatus';
export async function main(args = process.argv.slice(2)): Promise<void> {
  const [action, filename, confirmation] = args;

  if (action === 'sync-status' && !filename) {
    console.log(JSON.stringify(await syncStatus()));
    return;
  }

  if (
    !['plan', 'promote', 'rollback', 'abort', 'status'].includes(action) ||
    !filename ||
    (['plan', 'status'].includes(action)
      ? confirmation !== undefined
      : !/^[a-f0-9]{64}$/.test(confirmation || ''))
  ) {
    throw Error('upgrade-usage-invalid');
  }

  const input = json(filename);
  const app = await NestFactory.createApplicationContext(GitLabUpgradeModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const session = app.get(GitLabUpgradeService).create(input);
    const result =
      action === 'plan'
        ? await session.plan()
        : action === 'status'
          ? session.status()
          : action === 'promote'
            ? await session.promote(confirmation)
            : action === 'rollback'
              ? await session.rollback(confirmation)
              : await session.abort(confirmation);
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}
export function reportFailure(): void {
  console.error(
    'GitLab upgrade stopped. Inspect the private operation/checkpoint; do not retry an uncertain migration or start an old image on migrated data.',
  );
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch(reportFailure);
}
