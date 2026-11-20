import { UPGRADE_PROCESS, NativeUpgradeProcess } from './native-process';
import { Module } from '@nestjs/common';
import { GitLabUpgradeService } from './gitlab-upgrade.service';
import { UpgradeGuardianService } from './guardian.service';
import { UpgradeRuntimeService } from './runtime.service';
import { UpgradeRunnerService } from './runner.service';
import { UpgradeCheckpointService } from './checkpoint.service';
import { UpgradeWorkflowService } from './workflow.service';
@Module({
  providers: [
    { provide: UPGRADE_PROCESS, useClass: NativeUpgradeProcess },
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
