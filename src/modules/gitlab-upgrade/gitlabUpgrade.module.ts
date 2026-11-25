import { GitlabPreflightModule } from '../gitlab-preflight/gitlabPreflight.module';
import { upgradeProcess, NativeUpgradeProcess } from './nativeProcess';
import { Module } from '@nestjs/common';
import { GitLabUpgradeService } from './gitlabUpgrade.service';
import { UpgradeGuardianService } from './guardian.service';
import { UpgradeRuntimeService } from './runtime.service';
import { UpgradeRunnerService } from './runner.service';
import { UpgradeCheckpointService } from './checkpoint.service';
import { UpgradeWorkflowService } from './workflow.service';
@Module({
  imports: [GitlabPreflightModule],
  providers: [
    { provide: upgradeProcess, useClass: NativeUpgradeProcess },
    GitLabUpgradeService,
    UpgradeGuardianService,
    UpgradeRuntimeService,
    UpgradeRunnerService,
    UpgradeCheckpointService,
    UpgradeWorkflowService,
  ],
  exports: [GitLabUpgradeService],
})
export class GitLabUpgradeModule {}
