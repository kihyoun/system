import {
  SourceTransferService,
  SOURCE_TRANSFER_PORT,
  nativeSourceTransferPort,
} from './source-transfer.service';
import { Module } from '@nestjs/common';
import { ProjectLifecycleService } from './project-lifecycle.service';
@Module({
  providers: [
    ProjectLifecycleService,
    SourceTransferService,
    { provide: SOURCE_TRANSFER_PORT, useValue: nativeSourceTransferPort },
  ],
  exports: [ProjectLifecycleService, SourceTransferService],
})
export class ProjectLifecycleModule {}
