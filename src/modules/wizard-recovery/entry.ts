import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WizardRecoveryModule } from './wizard-recovery.module';
import { WizardRecoveryService } from './wizard-recovery.service';
import type { RecoveryOptions } from './ports';
export async function recoverImage(options: RecoveryOptions) {
  const app = await NestFactory.createApplicationContext(WizardRecoveryModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    return await app.get(WizardRecoveryService).recover(options);
  } finally {
    await app.close();
  }
}
export async function main(checkout: string) {
  const abort = new AbortController(),
    cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const result = await recoverImage({ checkout, settings: process.env, signal: abort.signal });
    console.log('Wizard image recovery: ' + result.state);
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}
if (require.main === module)
  void main(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Wizard image recovery failed.');
    process.exitCode = 1;
  });
