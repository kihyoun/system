import { parseArgs } from 'node:util';
import type {
  CliInstallationService,
  CliHostSelection,
} from '../modules/host-bootstrap/cliInstallation.service';

export async function withCliInstallation<T>(
  action: (service: CliInstallationService) => T,
): Promise<T> {
  const { NestFactory: nestFactory } = await import('@nestjs/core');
  const { CliInstallationModule: cliInstallationModule } = await import('./installation.module.js');
  const { CliInstallationService: cliInstallationService } =
    await import('../modules/host-bootstrap/cliInstallation.service.js');
  const app = await nestFactory.createApplicationContext(cliInstallationModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    return await action(app.get(cliInstallationService));
  } finally {
    await app.close();
  }
}

export function installCli(service: CliInstallationService, args: string[]): void {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      checkout: { type: 'string' },
      runtime: { type: 'string' },
      'persistence-env': { type: 'string' },
      'release-metadata': { type: 'string' },
      artifact: { type: 'string' },
    },
  });
  service.install({
    checkout: values.checkout,
    runtime: values.runtime,
    persistenceEnv: values['persistence-env'],
    releaseMetadata: values['release-metadata'],
    artifact: values.artifact,
  });
}

export async function installedHost(storage: boolean): Promise<CliHostSelection> {
  return withCliInstallation((service) => service.resolve(storage));
}
