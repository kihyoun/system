import { Module } from '@nestjs/common';
import { NativeProcessRunner, ProcessRunner } from '../runtime/process';
import { ShellConfiguration } from './ports';
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
      useFactory: (process: ProcessRunner) => new ShellConfiguration(process),
      inject: [ROUTING_PROCESS],
    },
    ProjectsRoutingService,
  ],
  exports: [ProjectsRoutingService],
})
export class ProjectsRoutingModule {}
