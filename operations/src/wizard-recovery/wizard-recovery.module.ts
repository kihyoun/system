import { Module } from '@nestjs/common';
import { ManagedChildProcess } from '../runtime/managed-child';
import { ProjectsRoutingModule } from '../projects-routing/projects-routing.module';
import { GitlabProvisionModule } from '../gitlab-provision/gitlab-provision.module';
import { WizardRecoveryService } from './wizard-recovery.service';
import { WizardRecoveryRegistryService } from './registry.service';
import { WizardRecoveryReadinessService } from './readiness.service';
import { syncDirectory } from './identity';
import {
  WIZARD_RECOVERY_PROCESS,
  WIZARD_RECOVERY_REGISTRY,
  WIZARD_RECOVERY_READY,
  WIZARD_RECOVERY_DURABILITY,
} from './ports';
@Module({
  imports: [ProjectsRoutingModule, GitlabProvisionModule],
  providers: [
    WizardRecoveryService,
    { provide: WIZARD_RECOVERY_PROCESS, useClass: ManagedChildProcess },
    { provide: WIZARD_RECOVERY_REGISTRY, useClass: WizardRecoveryRegistryService },
    { provide: WIZARD_RECOVERY_READY, useClass: WizardRecoveryReadinessService },
    { provide: WIZARD_RECOVERY_DURABILITY, useValue: { syncDirectory } },
  ],
  exports: [WizardRecoveryService],
})
export class WizardRecoveryModule {}
