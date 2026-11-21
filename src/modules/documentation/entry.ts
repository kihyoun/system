import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentationModule } from './documentation.module';
import { DocumentationExportService } from './documentation-export.service';

export async function main(args: string[], root: string): Promise<number> {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check'))
    throw Error('Usage: system-bootstrapper docs export [--check]');
  const app = await NestFactory.createApplicationContext(DocumentationModule, { logger: false });
  try {
    return app.get(DocumentationExportService).export(root, args[0] === '--check');
  } finally {
    await app.close();
  }
}
