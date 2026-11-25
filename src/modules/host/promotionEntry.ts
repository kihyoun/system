import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { lifecyclePolicy } from '../release/lifecyclePolicy';
import { HostModule } from './host.module';
import { PromotionService, type PromotionInput } from './promotion.service';
import { operationSignals } from './operationCancellation';
import { requireValue as ensure } from './install';
export async function promotionMain(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      operation: { type: 'string', default: 'promote' },
      checkout: { type: 'string' },
      'persistence-env': { type: 'string' },
      'checkpoint-dir': { type: 'string' },
      release: { type: 'string' },
      evidence: { type: 'string' },
      'gitlab-url': { type: 'string' },
      'token-file': { type: 'string' },
      'staged-promotion': { type: 'string' },
      timeout: { type: 'string', default: '1200' },
      'cold-maintenance': { type: 'boolean', default: false },
      'check-only': { type: 'boolean', default: false },
    },
  });
  for (const key of ['checkout', 'persistence-env', 'checkpoint-dir'] as const) {
    ensure(values[key], 'missing-' + key);
  }
  const app = await NestFactory.createApplicationContext(
    HostModule.register({ lifecycleEvidence: lifecyclePolicy() }),
    { logger: false },
  );
  const cancellation = operationSignals();
  try {
    const result = await app.get(PromotionService).execute({
      signal: cancellation.signal,
      operation: values.operation as PromotionInput['operation'],
      checkout: values.checkout!,
      persistenceEnv: values['persistence-env']!,
      checkpoint: values['checkpoint-dir']!,
      timeout: Number(values.timeout),
      cold: values['cold-maintenance'],
      checkOnly: values['check-only'],
      stagedPromotion: values['staged-promotion'],
      releaseFile: values.release,
      evidenceFile: values.evidence,
      gitlabUrl: values['gitlab-url'],
      tokenFile: values['token-file'],
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    cancellation.close();
    await app.close();
  }
}

if (require.main === module) {
  void promotionMain().catch(() => {
    process.stderr.write(
      'Controller promotion stopped; inspect retained checkpoints and owned leases before recovery.\n',
    );
    process.exitCode = 1;
  });
}
