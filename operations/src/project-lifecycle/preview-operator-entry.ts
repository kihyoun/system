import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { PreviewOperatorModule } from './preview-operator.module';
import { PreviewSetupPort, PreviewOperatorService } from './preview-operator.service';
export async function main(args: string[]) {
  const setup = require(
    path.resolve(__dirname, '../../../sync/dist/PreviewSetup'),
  ) as PreviewSetupPort;
  const app = await NestFactory.createApplicationContext(PreviewOperatorModule.register(setup), {
    logger: false,
    abortOnError: false,
  });
  try {
    return await app.get(PreviewOperatorService).run(args);
  } finally {
    await app.close();
  }
}
