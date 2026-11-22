import { WizardSourcePreparationService } from './wizardSourcePreparation.service';
import { Module } from '@nestjs/common';
import { NativeProcessRunner } from '../../common/runtime/process';
import { WizardSourceService } from './wizardSource.service';
import { sourceProcess, SourcePreparationService } from './sourcePreparation.service';
@Module({
  providers: [
    { provide: sourceProcess, useClass: NativeProcessRunner },
    WizardSourceService,
    WizardSourcePreparationService,
    SourcePreparationService,
  ],
  exports: [SourcePreparationService, WizardSourceService, WizardSourcePreparationService],
})
export class SourcePreparationModule {}
