import { Module } from '@nestjs/common';
import { NativeProcessRunner } from '../runtime/process';
import { SOURCE_PROCESS, SourcePreparationService } from './source-preparation.service';
@Module({
  providers: [{ provide: SOURCE_PROCESS, useClass: NativeProcessRunner }, SourcePreparationService],
  exports: [SourcePreparationService],
})
export class SourcePreparationModule {}
