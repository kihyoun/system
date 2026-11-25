import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PreviewOperatorModule } from './previewOperator.module';
import { PreviewOperatorService } from './previewOperator.service';
export async function main(args: string[]) {
  const app = await NestFactory.createApplicationContext(PreviewOperatorModule.register(), {
    logger: false,
    abortOnError: false,
  });
  try {
    return await app.get(PreviewOperatorService).run(args);
  } finally {
    await app.close();
  }
}
