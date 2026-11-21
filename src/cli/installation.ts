import { parseArgs } from 'node:util';
import type {
  CliInstallationService,
  CliHostSelection,
} from '../modules/host-bootstrap/cli-installation.service';

export async function withCliInstallation<T>(
  action: (service: CliInstallationService) => T,
): Promise<T> {
  const { NestFactory } = await import('@nestjs/core');
  const { CliInstallationModule } = await import('./installation.module.js');
  const { CliInstallationService } =
    await import('../modules/host-bootstrap/cli-installation.service.js');
  const app = await NestFactory.createApplicationContext(CliInstallationModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    return await action(app.get(CliInstallationService));
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
