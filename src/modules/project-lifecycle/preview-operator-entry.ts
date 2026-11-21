import 'reflect-metadata';
import * as setup from '../../api/projects/preview-setup';
import { NestFactory } from '@nestjs/core';
import { PreviewOperatorModule } from './preview-operator.module';
import { PreviewOperatorService } from './preview-operator.service';
export async function main(args: string[]) {
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
