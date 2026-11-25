import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MirrorModule } from './mirror.module';
import { WizardSourcePublicationService } from './wizardSourcePublication.service';
import type { MirrorContext } from './ports';
export async function wizardSourceMain(
  mode: string = '',
  context: MirrorContext = { cwd: process.cwd(), env: process.env },
): Promise<unknown> {
  if (mode && mode !== '--source-kind') {
    throw Error('wizard-source-mode-invalid');
  }

  const app = await NestFactory.createApplicationContext(MirrorModule, { logger: false });
  try {
    const service = app.get(WizardSourcePublicationService);
    return mode === '--source-kind' ? service.sourceKind(context) : await service.publish(context);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void wizardSourceMain(process.argv[2])
    .then((result) =>
      console.log(
        typeof result === 'string'
          ? result
          : result
            ? 'Exact Wizard source publicly verified.'
            : 'Wizard source is included in the shared System tree; no separate publication.',
      ),
    )
    .catch(() => {
      console.error('Wizard source publication failed; inspect approved mappings and access.');
      process.exitCode = 1;
    });
}
