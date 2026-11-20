import 'reflect-metadata';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { HostModule } from './host.module';
import { requireValue as ensure } from './install';

import { RecoveryExportService } from './recovery-export.service';
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
  ] as const)
    ensure(values[name], 'missing-' + name);
  const checkout = path.resolve(values.checkout!);
  const app = await NestFactory.createApplicationContext(
    HostModule.register({ lifecycleEvidence: require('../../../gitlab/guided-preview-evidence') }),
    { logger: false },
  );
  try {
    await app.get(RecoveryExportService).execute({
      checkout,
      persistenceEnv: values['persistence-env']!,
      release: values.release!,
      evidence: values.evidence!,
      gitlabUrl: values['gitlab-url']!,
      tokenFile: values['token-file']!,
      output: values.output!,
    });
    process.stdout.write('Accepted successor recovery images and source identities recorded.\n');
  } finally {
    await app.close();
  }
}
if (require.main === module)
  void recoveryExportMain().catch(() => {
    process.stderr.write('Recovery export stopped; retained state requires inspection.\n');
    process.exitCode = 1;
  });
