import { WizardRecoveryModule } from '../wizard-recovery/wizard-recovery.module';
import { GitlabProvisionModule } from '../gitlab-provision/gitlab-provision.module';
import { Module } from '@nestjs/common';
import { ManagedChildProcess } from '../../common/runtime/managed-child';
import { LiteralConfiguration } from '../projects-routing/ports';
import { ProjectsRoutingModule } from '../projects-routing/projects-routing.module';
import { LifecycleService, LIFECYCLE_PATHS, lifecyclePaths } from './lifecycle.service';
import { RunnerLifecycleService } from './runner.service';
import { RootPasswordService } from './root-password.service';
import { RunnerComposeService } from './runner-compose.service';
import { WizardPublicSettingsModule } from './public-settings.module';
import { LIFECYCLE_CHILD, LIFECYCLE_CONFIGURATION } from './types';
@Module({
  imports: [
    ProjectsRoutingModule,
    WizardRecoveryModule,
    GitlabProvisionModule,
    WizardPublicSettingsModule,
  ],
  providers: [
    { provide: LIFECYCLE_PATHS, useValue: lifecyclePaths },
    { provide: LIFECYCLE_CHILD, useClass: ManagedChildProcess },
    {
      provide: LIFECYCLE_CONFIGURATION,
      useFactory: () => new LiteralConfiguration(),
    },
    LifecycleService,
    RunnerLifecycleService,
    RootPasswordService,
    RunnerComposeService,
  ],
  exports: [
    LifecycleService,
    RunnerLifecycleService,
    RootPasswordService,
    RunnerComposeService,
    WizardPublicSettingsModule,
  ],
})
export class LifecycleModule {}
