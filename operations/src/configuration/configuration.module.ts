import { Module } from '@nestjs/common';
import { NativeProcessRunner } from '../runtime/process';
import { ProjectsRoutingModule } from '../projects-routing/projects-routing.module';
import { CONFIGURATION_PROCESS, ConfigurationService } from './configuration.service';
@Module({
  imports: [ProjectsRoutingModule],
  providers: [
    { provide: CONFIGURATION_PROCESS, useClass: NativeProcessRunner },
    ConfigurationService,
  ],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}
