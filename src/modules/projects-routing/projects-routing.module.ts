import { ProxyReloadService } from './proxy-reload.service';
import { Module } from '@nestjs/common';
import { NativeProcessRunner } from '../../common/runtime/process';
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
    ProxyReloadService,
    ProjectsRoutingService,
  ],
  exports: [ProjectsRoutingService],
})
export class ProjectsRoutingModule {}
