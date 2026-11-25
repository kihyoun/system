import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { HostModule } from './host.module';
import { requireValue as ensure } from './install';
import { RecoveryOperationService, type RecoveryOperationInput } from './recoveryOperation.service';

export function parseRecoveryInput(args: string[]): RecoveryOperationInput {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      directory: { type: 'string' },
      checkout: { type: 'string' },
      'expected-manifest-sha256': { type: 'string' },
      configuration: { type: 'string' },
      'checksums-only': { type: 'boolean', default: false },
    },
  });
  ensure(
    positionals.length === 1 && ['verify', 'load'].includes(positionals[0]!),
    'invalid-recovery-operation',
  );
  ensure(values.directory, 'missing-directory');
  ensure(values.checkout, 'missing-checkout');
  return {
    operation: positionals[0] as RecoveryOperationInput['operation'],
    directory: values.directory,
    checkout: values.checkout,
    expectedManifestSha256: values['expected-manifest-sha256'],
    configuration: values.configuration,
    checksumsOnly: values['checksums-only'],
  };
}
export async function recoveryMain(args = process.argv.slice(2)): Promise<void> {
  const input = parseRecoveryInput(args);
  const app = await NestFactory.createApplicationContext(HostModule.register(), { logger: false });
  try {
    const result = app.get(RecoveryOperationService).execute(input);
    process.stdout.write('Recovery manifest ' + result + '.\n');
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void recoveryMain().catch(() => {
    process.stderr.write('Recovery failed; retained archives were not accepted.\n');
    process.exitCode = 1;
  });
}
