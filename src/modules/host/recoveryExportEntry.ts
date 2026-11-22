import 'reflect-metadata';
import { lifecyclePolicy } from '../release/lifecyclePolicy';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { HostModule } from './host.module';
import { requireValue as ensure } from './install';

import { RecoveryExportService } from './recoveryExport.service';
export async function recoveryExportMain(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      checkout: { type: 'string' },
      'persistence-env': { type: 'string' },
      release: { type: 'string' },
      evidence: { type: 'string' },
      'gitlab-url': { type: 'string' },
      'token-file': { type: 'string' },
      output: { type: 'string' },
    },
  });
  for (const name of [
    'checkout',
    'persistence-env',
    'release',
    'evidence',
    'gitlab-url',
    'token-file',
    'output',
  ] as const) {
    ensure(values[name], 'missing-' + name);
  }
  const checkout = path.resolve(values.checkout!);
  const app = await NestFactory.createApplicationContext(
    HostModule.register({ lifecycleEvidence: lifecyclePolicy() }),
    { logger: false },
  );
  const cancellation = new AbortController(),
    cancel = () => cancellation.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    await app.get(RecoveryExportService).execute({
      checkout,
      persistenceEnv: values['persistence-env']!,
      release: values.release!,
      evidence: values.evidence!,
      gitlabUrl: values['gitlab-url']!,
      tokenFile: values['token-file']!,
      output: values.output!,
      signal: cancellation.signal,
    });
    process.stdout.write('Accepted successor recovery images and source identities recorded.\n');
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    await app.close();
  }
}

if (require.main === module) {
  void recoveryExportMain().catch(() => {
    process.stderr.write('Recovery export stopped; retained state requires inspection.\n');
    process.exitCode = 1;
  });
}
