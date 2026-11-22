import { Module } from '@nestjs/common';
import { NativeProcessRunner } from '../../common/runtime/process';
import { ProjectsRoutingModule } from '../projects-routing/projectsRouting.module';
import { configurationProcess, ConfigurationService } from './configuration.service';
@Module({
  imports: [ProjectsRoutingModule],
  providers: [
    { provide: configurationProcess, useClass: NativeProcessRunner },
    ConfigurationService,
  ],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}
