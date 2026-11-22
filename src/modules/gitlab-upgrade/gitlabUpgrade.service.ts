import { Injectable } from '@nestjs/common';
import { UpgradeGuardianService } from './guardian.service';
import { UpgradeRuntimeService } from './runtime.service';
import { UpgradeRunnerService } from './runner.service';
import { UpgradeCheckpointService } from './checkpoint.service';
import { UpgradeWorkflowService } from './workflow.service';
import { UpgradeSession } from './session';
import type { UpgradeDependencies } from './types';
/** Each command gets an isolated owner/session; durable locks serialize processes. */
@Injectable()
export class GitLabUpgradeService {
  constructor(
    private readonly guardian: UpgradeGuardianService,
    private readonly runtime: UpgradeRuntimeService,
    private readonly runner: UpgradeRunnerService,
    private readonly checkpoint: UpgradeCheckpointService,
    private readonly workflow: UpgradeWorkflowService,
  ) {}

  create(input: unknown, dependencies: UpgradeDependencies = {}): UpgradeSession {
    return new UpgradeSession(input, dependencies, {
      guardian: this.guardian,
      runtime: this.runtime,
      runner: this.runner,
      checkpoint: this.checkpoint,
      workflow: this.workflow,
    });
  }
}
