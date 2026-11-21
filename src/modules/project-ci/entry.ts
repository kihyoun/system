import { ApplicationService } from './application.service';
import { DeliveryService } from './delivery.service';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ProjectCiModule } from './project-ci.module';
import { EnvironmentLauncherService } from './environment-launcher.service';
import { BrowserCheckService } from './browser-check.service';
export async function main(
  args: string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<void> {
  const app = await NestFactory.createApplicationContext(ProjectCiModule, { logger: false });
  try {
    if (args[0] === 'application' && (args.length === 3 || args.length === 4))
      await app.get(ApplicationService).run(args[1], args[2], args[3], env, signal);
    else if (args[0] === 'build' && args.length === 2)
      await app.get(DeliveryService).build(args[1], env, signal);
    else if (args[0] === 'verify' && args.length === 2)
      await app.get(DeliveryService).verify(args[1], env, signal);
    else if (args[0] === 'environment' && args.length === 3)
      await app.get(EnvironmentLauncherService).run(args[1], args[2], env, signal);
    else if (args[0] === 'browser' && args.length === 2)
      await app.get(BrowserCheckService).run(args[1], env, signal);
    else throw Error('Use environment deploy|stop review|beta or browser ABSOLUTE_CHECKOUT');
  } finally {
    await app.close();
  }
}
if (require.main === module) {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(s, cancel);
  main(process.argv.slice(2), process.env, abort.signal)
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Project CI failed');
      process.exitCode = 1;
    })
    .finally(() => {
      for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(s, cancel);
    });
}
