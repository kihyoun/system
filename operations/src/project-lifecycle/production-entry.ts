import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ProductionModule } from './production.module';
import { ProductionService } from './production.service';
export async function productionMain(args: string[]) {
  const app = await NestFactory.createApplicationContext(ProductionModule.register(), {
    logger: false,
  });
  try {
    return await app.get(ProductionService).run(args);
  } finally {
    await app.close();
  }
}
