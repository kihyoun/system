import { Module } from '@nestjs/common';
import { GitlabProvisionModule } from '../gitlab-provision/gitlab-provision.module';
import { DeploymentEvidenceService } from './deployment-evidence.service';
@Module({
  imports: [GitlabProvisionModule],
  providers: [DeploymentEvidenceService],
  exports: [DeploymentEvidenceService],
})
export class DeploymentEvidenceModule {}
