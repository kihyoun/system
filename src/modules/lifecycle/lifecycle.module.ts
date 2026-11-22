import { WizardRecoveryModule } from '../wizard-recovery/wizardRecovery.module';
import { GitlabProvisionModule } from '../gitlab-provision/gitlabProvision.module';
import { Module } from '@nestjs/common';
import { ManagedChildProcess } from '../../common/runtime/managedChild';
import { LiteralConfiguration } from '../projects-routing/ports';
import { ProjectsRoutingModule } from '../projects-routing/projectsRouting.module';
import { LifecycleService, lifecyclePathsToken, lifecyclePaths } from './lifecycle.service';
import { RunnerLifecycleService } from './runner.service';
import { RootPasswordService } from './rootPassword.service';
import { RunnerComposeService } from './runnerCompose.service';
import { WizardPublicSettingsModule } from './publicSettings.module';
import { lifecycleChild, lifecycleConfiguration } from './types';
@Module({
  imports: [
    ProjectsRoutingModule,
    WizardRecoveryModule,
    GitlabProvisionModule,
    WizardPublicSettingsModule,
  ],
  providers: [
    { provide: lifecyclePathsToken, useValue: lifecyclePaths },
    { provide: lifecycleChild, useClass: ManagedChildProcess },
    {
      provide: lifecycleConfiguration,
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
