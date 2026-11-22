import { ApplicationService } from './application.service';
import { DeliveryService } from './delivery.service';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ProjectCiModule } from './projectCi.module';
import { EnvironmentLauncherService } from './environmentLauncher.service';
import { BrowserCheckService } from './browserCheck.service';
import path from 'node:path';
import { BuildToolsService } from '../host-bootstrap/buildTools.service';
import { MirrorCiService } from '../mirror/ci.service';
import { createCliArtifact, readCliArtifact } from './cliArtifact';
import { BrowserSmokeService } from './browserSmoke.service';
export async function main(
  args: string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<void> {
  if (args[0] === 'package' && args.length === 3) {
    console.log(
      JSON.stringify(createCliArtifact(path.resolve(args[1]), path.resolve(args[2]), env)),
    );
    return;
  }

  if (args[0] === 'artifact-check' && args.length === 2) {
    const artifact = readCliArtifact(path.resolve(args[1]));
    console.log(
      JSON.stringify({
        version: artifact.version,
        sourceRevision: artifact.sourceRevision,
        sha256: artifact.sha256,
      }),
    );
    return;
  }

  const app = await NestFactory.createApplicationContext(ProjectCiModule, { logger: false });
  try {
    if (args[0] === 'prepare-runtime' && args.length === 2) {
      await app
        .get(BuildToolsService)
        .installRuntime(path.resolve(args[1]), env, signal, 'project');
    } else if (args[0] === 'refresh-ca' && args.length === 2) {
      app.get(BuildToolsService).refreshCa(path.resolve(args[1]), 'project');
    } else if (args[0] === 'mirror' && args.length === 1) {
      console.log(
        await app.get(MirrorCiService).publish({ cwd: process.cwd(), env, signal }, false),
      );
    } else if (args[0] === 'application' && (args.length === 3 || args.length === 4)) {
      await app.get(ApplicationService).run(args[1], args[2], args[3], env, signal);
    } else if (args[0] === 'build' && args.length === 2) {
      await app.get(DeliveryService).build(args[1], env, signal);
    } else if (args[0] === 'verify' && args.length === 2) {
      await app.get(DeliveryService).verify(args[1], env, signal);
    } else if (args[0] === 'environment' && args.length === 3) {
      await app.get(EnvironmentLauncherService).run(args[1], args[2], env, signal);
    } else if (args[0] === 'browser' && args.length === 2) {
      await app.get(BrowserCheckService).run(args[1], env, signal);
    } else if (args[0] === 'browser-smoke' && args.length === 2) {
      await app.get(BrowserSmokeService).run(args[1], env, signal);
    } else if (args[0] === 'browser-suite' && args.length >= 2) {
      await app.get(BrowserCheckService).suite(args[1], env, signal, args.slice(2));
    } else {
      throw Error('Use environment deploy|stop review|beta or browser ABSOLUTE_CHECKOUT');
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(s, cancel);
  }
  main(process.argv.slice(2), process.env, abort.signal)
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Project CI failed');
      process.exitCode = 1;
    })
    .finally(() => {
      for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.off(s, cancel);
      }
    });
}
