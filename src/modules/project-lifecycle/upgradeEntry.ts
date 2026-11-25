import 'reflect-metadata';
import fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { UpgradeModule } from './upgrade.module';
import { UpgradeService } from './upgrade.service';
import { UpgradeOptions } from './upgradeTypes';
export async function upgradeMain(args: string[]) {
  const [action, optionsFile, confirmation] = args;

  if (!action || !optionsFile || args.length > 3) {
    throw Error('Unknown operator option.');
  }

  const input: unknown = JSON.parse(fs.readFileSync(optionsFile, 'utf8'));
  const keys = [
    'credentialFile',
    'helperImage',
    'config',
    'mainConfig',
    'directory',
    'buildProfile',
  ];

  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.entries(input).some(
      ([key, value]) => !keys.includes(key) || typeof value !== 'string',
    ) ||
    !('helperImage' in input) ||
    typeof input.helperImage !== 'string'
  ) {
    throw Error('Unknown operator option.');
  }

  const app = await NestFactory.createApplicationContext(
    UpgradeModule.register(input as UpgradeOptions),
    { logger: false, abortOnError: false },
  );
  try {
    return await app.get(UpgradeService).run(action, confirmation);
  } finally {
    await app.close();
  }
}
