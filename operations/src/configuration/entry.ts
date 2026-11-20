import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ConfigurationModule } from './configuration.module';
import { ConfigurationService } from './configuration.service';
export async function main(args = process.argv.slice(2), environment = process.env): Promise<void> {
  const [action, root, state, archive] = args;
  if (action !== 'push') throw Error('Unknown configuration action.');
  const app = await NestFactory.createApplicationContext(ConfigurationModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const mode = app.get(ConfigurationService).push({
      root: path.resolve(root),
      state: path.resolve(state),
      archive: path.resolve(archive),
      fingerprint: environment.SYSTEM_PUSH_IMPACT,
      parentStorage: environment.SYSTEM_STORAGE_SPEC
        ? (JSON.parse(environment.SYSTEM_STORAGE_SPEC) as unknown)
        : undefined,
    });
    console.log('APPLY_MODE=' + mode);
    console.log('Ready.');
  } finally {
    await app.close();
  }
}
if (require.main === module)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Configuration failed.');
    process.exitCode = 1;
  });
