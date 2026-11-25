import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { HostModule } from './host.module';
import { PromotionRecoveryService } from './promotionRecovery.service';
import { requireValue } from './install';
import type { PromotionNativeInput } from './promotionNativePort.service';
export function promotionRecoveryArguments(args: string[]): PromotionNativeInput {
  const values: Record<string, string> = {};
  const allowed = ['--checkout', '--checkpoint-dir', '--persistence-env', '--timeout'];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    requireValue(
      allowed.includes(key) && value && !value.startsWith('--') && !values[key],
      'invalid-promotion-recovery-arguments',
    );
    values[key] = value;
  }
  requireValue(
    values['--checkpoint-dir'] && values['--persistence-env'],
    'promotion-checkpoint-and-persistence-required',
  );
  requireValue(
    !values['--timeout'] || /^\d+$/.test(values['--timeout']),
    'bounded-promotion-readiness-timeout-required',
  );
  return {
    checkout: path.resolve(values['--checkout'] ?? process.cwd()),
    checkpoint: path.resolve(values['--checkpoint-dir']),
    persistenceEnv: path.resolve(values['--persistence-env']),
    timeout: Number(values['--timeout'] ?? 1200),
  };
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  const input = promotionRecoveryArguments(args);
  const app = await NestFactory.createApplicationContext(HostModule.register(), { logger: false });
  try {
    await app.get(PromotionRecoveryService).abort(input);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(
      'promotion-recovery-failed: retain the checkpoint and owned leases for recovery\n',
    );
    process.exitCode = 1;
  });
}
