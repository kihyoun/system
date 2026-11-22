import { Module } from '@nestjs/common';
import { GitlabProvisionModule } from '../gitlab-provision/gitlabProvision.module';
import { DeploymentEvidenceService } from './deploymentEvidence.service';
@Module({
  imports: [GitlabProvisionModule],
  providers: [DeploymentEvidenceService],
  exports: [DeploymentEvidenceService],
})
export class DeploymentEvidenceModule {}
