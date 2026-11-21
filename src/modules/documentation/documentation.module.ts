import { DocumentationSourceCheckService } from './documentation-source-check.service';
import { Module } from '@nestjs/common';
import { DocumentationExportService } from './documentation-export.service';

@Module({
  providers: [DocumentationExportService, DocumentationSourceCheckService],
  exports: [DocumentationExportService, DocumentationSourceCheckService],
})
export class DocumentationModule {}
