import { NativeUpgradeProcess } from './native-process';
import 'reflect-metadata';
import { UpgradeSession } from './session';
import { UpgradeGuardianService } from './guardian.service';
import { UpgradeRuntimeService } from './runtime.service';
import { UpgradeRunnerService } from './runner.service';
import { UpgradeCheckpointService } from './checkpoint.service';
import { UpgradeWorkflowService } from './workflow.service';
import type { UpgradeDependencies } from './types';
/** Synchronous legacy API only. HTTP/CLI composition uses GitLabUpgradeModule. */
export class Upgrade extends UpgradeSession {
  constructor(input: unknown, dependencies: UpgradeDependencies = {}) {
    super(input, dependencies, {
      guardian: new UpgradeGuardianService(new NativeUpgradeProcess()),
      runtime: new UpgradeRuntimeService(),
      runner: new UpgradeRunnerService(),
      checkpoint: new UpgradeCheckpointService(),
      workflow: new UpgradeWorkflowService(),
    });
  }
}
export * from './policy';
export { release } from './types';
