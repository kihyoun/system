import { Module } from '@nestjs/common';
import { ManagedChildProcess } from '../../common/runtime/managedChild';
import { ProjectsRoutingModule } from '../projects-routing/projectsRouting.module';
import { GitlabProvisionModule } from '../gitlab-provision/gitlabProvision.module';
import { WizardRecoveryService } from './wizardRecovery.service';
import { WizardRecoveryRegistryService } from './registry.service';
import { WizardRecoveryReadinessService } from './readiness.service';
import { syncDirectory } from './identity';
import {
  wizardRecoveryProcess,
  wizardRecoveryRegistry,
  wizardRecoveryReady,
  wizardRecoveryDurability,
} from './ports';
@Module({
  imports: [ProjectsRoutingModule, GitlabProvisionModule],
  providers: [
    WizardRecoveryService,
    { provide: wizardRecoveryProcess, useClass: ManagedChildProcess },
    { provide: wizardRecoveryRegistry, useClass: WizardRecoveryRegistryService },
    { provide: wizardRecoveryReady, useClass: WizardRecoveryReadinessService },
    { provide: wizardRecoveryDurability, useValue: { syncDirectory } },
  ],
  exports: [WizardRecoveryService],
})
export class WizardRecoveryModule {}
