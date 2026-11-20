import { Module } from '@nestjs/common';
import { NativeProcessRunner } from '../runtime/process';
import { ManagedChildProcess } from '../runtime/managed-child';
import { ShellConfiguration } from '../projects-routing/ports';
import { ProjectsRoutingModule } from '../projects-routing/projects-routing.module';
import { LifecycleService, LIFECYCLE_PATHS, lifecyclePaths } from './lifecycle.service';
import { RunnerLifecycleService } from './runner.service';
import { LIFECYCLE_CHILD, LIFECYCLE_CONFIGURATION } from './types';
@Module({
  imports: [ProjectsRoutingModule],
  providers: [
    { provide: LIFECYCLE_PATHS, useValue: lifecyclePaths },
    { provide: LIFECYCLE_CHILD, useClass: ManagedChildProcess },
    {
      provide: LIFECYCLE_CONFIGURATION,
      useFactory: () => new ShellConfiguration(new NativeProcessRunner()),
    },
    LifecycleService,
    RunnerLifecycleService,
  ],
  exports: [LifecycleService, RunnerLifecycleService],
})
export class LifecycleModule {}
