import { Module } from '@nestjs/common';
import { DocumentationExportService } from './documentation-export.service';

@Module({ providers: [DocumentationExportService], exports: [DocumentationExportService] })
export class DocumentationModule {}
