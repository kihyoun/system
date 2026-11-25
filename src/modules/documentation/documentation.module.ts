import { DocumentationSourceCheckService } from './documentationSourceCheck.service';
import { Module } from '@nestjs/common';
import { DocumentationExportService } from './documentationExport.service';

@Module({
  providers: [DocumentationExportService, DocumentationSourceCheckService],
  exports: [DocumentationExportService, DocumentationSourceCheckService],
})
export class DocumentationModule {}
