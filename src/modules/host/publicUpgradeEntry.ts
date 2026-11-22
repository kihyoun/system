import { operationSignals } from './operationCancellation';
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { lifecyclePolicy } from '../release/lifecyclePolicy';
import { HostModule } from './host.module';
import { PublicUpgradeService, type PublicUpgradeInput } from './publicUpgrade.service';
import { requireValue as ensure } from './install';
export function parsePublicUpgradeInput(args: string[]): PublicUpgradeInput {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      operation: { type: 'string', default: 'plan' },
      checkout: { type: 'string' },
      'persistence-env': { type: 'string' },
      'plan-dir': { type: 'string' },
      repository: { type: 'string', default: 'kihyoun/system' },
      target: { type: 'string' },
      'backup-file': { type: 'string' },
      'token-file': { type: 'string' },
      'gitlab-checkpoint': { type: 'string' },
      'confirm-plan': { type: 'string' },
      timeout: { type: 'string', default: '1200' },
      'backup-timeout': { type: 'string', default: '3600' },
    },
  });
  ensure(
    ['plan', 'apply', 'status', 'recover'].includes(values.operation),
    'invalid-public-upgrade-operation',
  );
  for (const name of ['checkout', 'persistence-env', 'plan-dir'] as const) {
    ensure(values[name], 'missing-' + name);
  }
  return {
    operation: values.operation as PublicUpgradeInput['operation'],
    checkout: values.checkout!,
    persistenceEnv: values['persistence-env']!,
    directory: values['plan-dir']!,
    repository: values.repository,
    target: values.target,
    backupFile: values['backup-file'],
    tokenFile: values['token-file'],
    gitlabCheckpoint: values['gitlab-checkpoint'],
    confirmation: values['confirm-plan'],
    timeout: Number(values.timeout),
    backupTimeout: Number(values['backup-timeout']),
  };
}
export async function publicUpgradeMain(args = process.argv.slice(2)): Promise<void> {
  const input = parsePublicUpgradeInput(args);
  const app = await NestFactory.createApplicationContext(
    HostModule.register({ lifecycleEvidence: lifecyclePolicy() }),
    { logger: false },
  );
  const cancellation = operationSignals();
  try {
    const result = await app
      .get(PublicUpgradeService)
      .execute({ ...input, signal: cancellation.signal });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    cancellation.close();
    await app.close();
  }
}

if (require.main === module) {
  void publicUpgradeMain().catch(() => {
    process.stderr.write(
      'Public upgrade refused; inspect status and retained leases before recovery.\n',
    );
    process.exitCode = 1;
  });
}
