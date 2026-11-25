import { Module } from '@nestjs/common';
import { GitlabProvisionModule } from '../gitlab-provision/gitlabProvision.module';
import { HostModule } from '../host/host.module';
import { LiveAuditAccessService } from './liveAuditAccess.service';
import { LiveProjectAuditService } from './liveProjectAudit.service';
import { LiveRunnerAuditService } from './liveRunnerAudit.service';
@Module({
  imports: [GitlabProvisionModule, HostModule.register()],
  providers: [LiveAuditAccessService, LiveProjectAuditService, LiveRunnerAuditService],
  exports: [LiveAuditAccessService, LiveProjectAuditService, LiveRunnerAuditService],
})
export class LiveAuditModule {}
