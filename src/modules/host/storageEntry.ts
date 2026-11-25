import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { HostModule } from './host.module';
import { HostStorageService, type HostStorageCommand } from './hostStorage.service';
export function storageArguments(
  argv: string[],
  environment: NodeJS.ProcessEnv,
  checkout: string,
): HostStorageCommand {
  const operation = argv[0];

  if (operation !== 'harvest' && operation !== 'restore') {
    throw Error('invalid-host-storage-operation');
  }

  const result: HostStorageCommand = {
    operation,
    image: '',
    checkout,
    persistenceEnv: environment.PERSISTENCE_ENV_FILE ?? '',
  };
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];

    if (key === '--check-only') {
      result.checkOnly = true;
      continue;
    }

    if (
      !['--image', '--configuration-backup', '--checkout'].includes(key) ||
      !argv[i + 1] ||
      argv[i + 1].startsWith('--')
    ) {
      throw Error('invalid-host-storage-arguments');
    }

    const value = argv[++i];

    if (key === '--image') {
      result.image = value;
    } else if (key === '--checkout') {
      result.checkout = value;
    } else {
      result.configurationBackup = value;
    }
  }
  return result;
}
export async function hostStorageMain(argv: string[], environment = process.env): Promise<void> {
  const command = storageArguments(argv, environment, path.resolve(__dirname, '../../..'));
  const app = await NestFactory.createApplicationContext(HostModule.register({ environment }), {
    logger: false,
  });
  try {
    await app.get(HostStorageService).execute(command);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void hostStorageMain(process.argv.slice(2)).catch(() => {
    process.stderr.write(
      'Host storage failed or its outcome is uncertain. Retain the owned launcher and storage lease; inspect operation state before retrying.\n',
    );
    process.exitCode = 1;
  });
}
