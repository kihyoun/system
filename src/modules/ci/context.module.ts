import { Module } from '@nestjs/common';
import { SourcePreparationModule } from '../source-preparation/source-preparation.module';
import { CONTEXT_PROCESS, NativeContextProcess } from './context-process';
import { CommittedContextService } from './committed-context.service';
import { ContextPreparationService } from './context-preparation.service';
import { WizardBrowserContextService } from './wizard-browser-context.service';
import { CodeqlContextService } from './codeql-context.service';
@Module({
  imports: [SourcePreparationModule],
  providers: [
    { provide: CONTEXT_PROCESS, useClass: NativeContextProcess },
    CommittedContextService,
    ContextPreparationService,
    WizardBrowserContextService,
    CodeqlContextService,
  ],
  exports: [ContextPreparationService, WizardBrowserContextService, CodeqlContextService],
})
export class ContextModule {}
