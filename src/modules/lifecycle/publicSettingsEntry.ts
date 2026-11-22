import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { WizardPublicSettingsModule } from './publicSettings.module';
import { WizardPublicSettingsService } from './publicSettings.service';

export async function publicSettingsMain(
  args = process.argv.slice(2),
  environment = process.env,
): Promise<void> {
  const [
    action = 'publish',
    state = environment.SYSTEM_CONFIG_DIR || '/state',
    directory = '/wizard-public',
  ] = args;

  if (
    args.length > 3 ||
    !['publish', 'verify'].includes(action) ||
    !path.isAbsolute(state) ||
    !path.isAbsolute(directory)
  ) {
    throw Error('public-settings-input-invalid');
  }

  const app = await NestFactory.createApplicationContext(WizardPublicSettingsModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const service = app.get(WizardPublicSettingsService);

    if (action === 'verify') {
      service.verifyPublication(state, directory);
    } else {
      service.publishMounted(state, directory);
    }

    process.stdout.write(JSON.stringify({ ok: true }) + '\n');
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void publicSettingsMain().catch(() => {
    process.stderr.write(
      'Public Wizard settings failed; inspect saved configuration and persistent mounts.\n',
    );
    process.exitCode = 1;
  });
}
