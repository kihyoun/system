import { BuildToolsService } from '../host-bootstrap/build-tools.service';
import path from 'node:path';
import { DeliveryService } from './delivery.service';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ProjectCiModule } from './project-ci.module';
import { BrowserCheckService } from './browser-check.service';
import { EnvironmentLauncherService } from './environment-launcher.service';
import { MirrorCiService } from '../mirror/ci.service';
/** Portable source jobs use the same service graph as repository and API callers. */
async function main(args: string[], signal: AbortSignal): Promise<void> {
  const app = await NestFactory.createApplicationContext(ProjectCiModule, { logger: false });
  try {
    if (args[0] === 'prepare-runtime' && args.length === 2)
      await app.get(BuildToolsService).installRuntime(path.resolve(args[1]), process.env, signal);
    else if (args[0] === 'refresh-ca' && args.length === 2)
      app.get(BuildToolsService).refreshCa(path.resolve(args[1]));
    else if (args[0] === 'build' && args.length === 1)
      await app.get(DeliveryService).build(process.cwd(), process.env, signal);
    else if (args[0] === 'verify' && args.length === 1)
      await app.get(DeliveryService).verify(process.cwd(), process.env, signal);
    else if (args[0] === 'browser' && args.length === 1)
      await app.get(BrowserCheckService).run(process.cwd(), process.env, signal);
    else if (args[0] === 'environment' && args.length === 3)
      await app.get(EnvironmentLauncherService).run(args[1], args[2], process.env, signal);
    else if (args[0] === 'mirror' && args.length === 1)
      console.log(
        await app
          .get(MirrorCiService)
          .publish({ cwd: process.cwd(), env: process.env, signal }, false),
      );
    else throw Error('Use browser, mirror or environment deploy|stop review|beta');
  } finally {
    await app.close();
  }
}
const controller = new AbortController();
const cancel = () => controller.abort();
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, cancel);
main(process.argv.slice(2), controller.signal)
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Project CI failed');
    process.exitCode = 1;
  })
  .finally(() => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, cancel);
  });
