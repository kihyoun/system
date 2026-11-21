import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import Helper from '../common/configuration-signature';
import { installMiddleware } from './http/middleware';
import { SyncExceptionFilter } from './http/sync-http-error';
import { RuntimeService } from './runtime/runtime.service';

/** Construct a native Nest application without binding a port or starting jobs. */
export async function createSyncApplication(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: false,
  });
  installMiddleware(app, app.get(RuntimeService));
  app.useGlobalFilters(new SyncExceptionFilter());
  return app;
}

export async function bootstrap(options: { port?: number; host?: string } = {}) {
  const app = await createSyncApplication();
  const port = options.port ?? 8071;
  if (options.host) await app.listen(port, options.host);
  else await app.listen(port);
  console.log(Helper.textLogo);
  if (process.env.SYNC_ENABLE !== 'true')
    console.log(`server listening on http://${process.env.BOOTSTRAPPER_IP}:8071`);
  else
    console.log(
      `server listening on ${parseInt(process.env.SYNC_DOMAIN_MODE || '', 10) > 1 ? 'https://' : 'http://'}${process.env.SYNC_HOST}`,
    );
  console.log('Sync authentication is configured.');
  app.get(RuntimeService).startDefaultWizard();
  return app;
}
