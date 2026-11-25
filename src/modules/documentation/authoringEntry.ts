import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentationModule } from './documentation.module';
import { DocumentationSourceCheckService } from './documentationSourceCheck.service';
import { DocumentationExportService } from './documentationExport.service';
export async function documentationMain(args: string[], root = process.cwd()): Promise<number> {
  const [action, ...options] = args;

  if (
    !['check', 'export'].includes(action) ||
    (action === 'check'
      ? options.length !== 0
      : options.length > 1 || (options.length === 1 && options[0] !== '--check'))
  ) {
    throw Error('usage-docs-check-or-export-check');
  }

  const app = await NestFactory.createApplicationContext(DocumentationModule, { logger: false });
  try {
    return action === 'check'
      ? app.get(DocumentationSourceCheckService).check(root)
      : app.get(DocumentationExportService).export(root, options[0] === '--check');
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void documentationMain(process.argv.slice(2))
    .then((count) => console.log('Wizard documentation verified: ' + count + ' chapters.'))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'documentation-authoring-failed');
      process.exitCode = 1;
    });
}
