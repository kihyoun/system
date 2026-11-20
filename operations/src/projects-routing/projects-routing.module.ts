import { Module } from '@nestjs/common';
import { NativeProcessRunner } from '../runtime/process';
import { LiteralConfiguration } from './ports';
import {
  ProjectsRoutingService,
  ROUTING_PROCESS,
  ROUTING_CONFIGURATION,
} from './projects-routing.service';
@Module({
  providers: [
    { provide: ROUTING_PROCESS, useClass: NativeProcessRunner },
    {
      provide: ROUTING_CONFIGURATION,
      useClass: LiteralConfiguration,
    },
    ProjectsRoutingService,
  ],
  exports: [ProjectsRoutingService],
})
export class ProjectsRoutingModule {}
