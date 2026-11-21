import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SourcePreparationModule } from './source-preparation.module';
import { WizardSourcePreparationService } from './wizard-source-preparation.service';
export async function wizardSourcePreparationMain(
  environment = process.env,
  directory = process.cwd(),
): Promise<string> {
  const app = await NestFactory.createApplicationContext(SourcePreparationModule, {
    logger: false,
  });
  try {
    return app.get(WizardSourcePreparationService).prepare(environment, directory);
  } finally {
    await app.close();
  }
}
if (require.main === module)
  void wizardSourcePreparationMain()
    .then(() => console.log('Wizard source checkout verified at the committed source layout.'))
    .catch(() => {
      console.error(
        'Wizard source checkout failed; inspect the configured primary, access and gitlink availability.',
      );
      process.exitCode = 1;
    });
