import { Module } from '@nestjs/common';
import { GitlabProvisionModule } from '../gitlab-provision/gitlab-provision.module';
import { HostModule } from '../host/host.module';
import { LiveAuditAccessService } from './live-audit-access.service';
import { LiveProjectAuditService } from './live-project-audit.service';
import { LiveRunnerAuditService } from './live-runner-audit.service';
@Module({
  imports: [GitlabProvisionModule, HostModule.register()],
  providers: [LiveAuditAccessService, LiveProjectAuditService, LiveRunnerAuditService],
  exports: [LiveAuditAccessService, LiveProjectAuditService, LiveRunnerAuditService],
})
export class LiveAuditModule {}
