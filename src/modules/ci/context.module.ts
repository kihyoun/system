import { Module } from '@nestjs/common';
import { SourcePreparationModule } from '../source-preparation/sourcePreparation.module';
import { contextProcess, NativeContextProcess } from './contextProcess';
import { CommittedContextService } from './committedContext.service';
import { ContextPreparationService } from './contextPreparation.service';
import { WizardBrowserContextService } from './wizardBrowserContext.service';
import { CodeqlContextService } from './codeqlContext.service';
@Module({
  imports: [SourcePreparationModule],
  providers: [
    { provide: contextProcess, useClass: NativeContextProcess },
    CommittedContextService,
    ContextPreparationService,
    WizardBrowserContextService,
    CodeqlContextService,
  ],
  exports: [ContextPreparationService, WizardBrowserContextService, CodeqlContextService],
})
export class ContextModule {}
