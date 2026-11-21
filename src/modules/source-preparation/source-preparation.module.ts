import { WizardSourcePreparationService } from './wizard-source-preparation.service';
import { Module } from '@nestjs/common';
import { NativeProcessRunner } from '../../common/runtime/process';
import { WizardSourceService } from './wizard-source.service';
import { SOURCE_PROCESS, SourcePreparationService } from './source-preparation.service';
@Module({
  providers: [
    { provide: SOURCE_PROCESS, useClass: NativeProcessRunner },
    WizardSourceService,
    WizardSourcePreparationService,
    SourcePreparationService,
  ],
  exports: [SourcePreparationService, WizardSourceService, WizardSourcePreparationService],
})
export class SourcePreparationModule {}
