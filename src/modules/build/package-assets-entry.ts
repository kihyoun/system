import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { BuildModule } from './build.module';
import { PackageAssetsService } from './package-assets.service';
export async function packageAssetsMain(root = path.resolve(__dirname, '../../..')): Promise<void> {
  const app = await NestFactory.createApplicationContext(BuildModule, { logger: false });
  try {
    app.get(PackageAssetsService).package(root);
  } finally {
    await app.close();
  }
}
if (require.main === module)
  void packageAssetsMain().catch(() => {
    console.error('Package asset preparation failed.');
    process.exitCode = 1;
  });
