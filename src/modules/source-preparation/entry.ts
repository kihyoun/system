import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SourcePreparationModule } from './sourcePreparation.module';
import { SourcePreparationService } from './sourcePreparation.service';
export async function main(root: string): Promise<void> {
  const app = await NestFactory.createApplicationContext(SourcePreparationModule, {
    logger: false,
  });
  try {
    app.get(SourcePreparationService).prepare(root);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main(process.argv[2] || '').catch(() => {
    console.error('Committed Wizard source preparation failed.');
    process.exitCode = 1;
  });
}
