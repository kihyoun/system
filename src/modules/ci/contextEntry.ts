import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ContextModule } from './context.module';
import { ContextPreparationService } from './contextPreparation.service';
import { WizardBrowserContextService } from './wizardBrowserContext.service';
import { CodeqlContextService } from './codeqlContext.service';
export async function contextMain(
  action: string,
  root: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  if (
    !['prepare-context', 'prepare-candidate', 'prepare-wizard-browser', 'prepare-codeql'].includes(
      action,
    ) ||
    !path.isAbsolute(root)
  ) {
    throw Error('context-action-and-absolute-checkout-required');
  }

  const app = await NestFactory.createApplicationContext(ContextModule, { logger: false });
  try {
    if (action === 'prepare-context') {
      return app.get(ContextPreparationService).prepareContext(root, environment);
    }

    if (action === 'prepare-candidate') {
      return app.get(ContextPreparationService).prepareCandidate(root, environment);
    }

    if (action === 'prepare-wizard-browser') {
      return app.get(WizardBrowserContextService).prepareWizardBrowser(root, environment);
    }

    return app.get(CodeqlContextService).prepare(root, environment);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void contextMain(process.argv[2] || '', path.resolve(process.argv[3] || '.'))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'context-preparation-failed');
      process.exitCode = 1;
    });
}
