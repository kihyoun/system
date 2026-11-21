import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { BuildModule } from './build.module';
import { ProjectCiBundleService } from './project-ci-bundle.service';
export async function bundleProjectCiMain(
  root = path.resolve(__dirname, '../../..'),
  check = process.argv.includes('--check'),
): Promise<void> {
  const app = await NestFactory.createApplicationContext(BuildModule, { logger: false });
  try {
    await app.get(ProjectCiBundleService).bundle(root, check);
  } finally {
    await app.close();
  }
}
if (require.main === module)
  void bundleProjectCiMain().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'project-ci-bundle-failed');
    process.exitCode = 1;
  });
